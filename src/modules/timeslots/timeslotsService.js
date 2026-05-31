import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';
import { parseListQuery, buildOrderBy, buildMeta } from '../../utils/queryParser.js';
import {
  findImpactedScheduleIds,
  removeAssignmentsForDependencyDelete,
  assertNoScheduleAssignmentsForDependency,
  synchronizeSchedules,
} from '../schedules/scheduleSyncService.js';

const timeSlotInclude = {
  assignments: {
    include: {
      schedule: true,
      exam: { include: { courseOffering: { include: { course: true, semester: true } } } },
      room: true,
      proctor: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  },
};

const toDateKey = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const minutesBetween = (start, end) => Math.round((end.getTime() - start.getTime()) / 60000);

const isDateWithinSemester = (slotDateKey, semester) => {
  const startKey = toDateKey(semester.startDate);
  const endKey = toDateKey(semester.endDate);
  if (!startKey || !endKey) return false;
  return slotDateKey >= startKey && slotDateKey <= endKey;
};

const normalizeTimeSlotPayload = async (data, current = null) => {
  const startTime = data.startTime ?? current?.startTime;
  const endTime = data.endTime ?? current?.endTime;
  const date = data.date ?? (data.startTime ? startTime : current?.date) ?? startTime;

  const start = new Date(startTime);
  const end = new Date(endTime);
  const slotDateKey = toDateKey(date ?? startTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !slotDateKey) {
    throw new AppError('Time slot date, start time, and end time must be valid dates.', 400);
  }

  if (end <= start) {
    throw new AppError('Time slot end time must be after start time.', 400);
  }

  const computedDuration = minutesBetween(start, end);
  if (computedDuration <= 0) {
    throw new AppError('Time slot duration must be greater than zero minutes.', 400);
  }

  if (data.duration !== undefined && data.duration !== computedDuration) {
    throw new AppError('Time slot duration must match the start and end time range.', 400);
  }

  const duplicate = await prisma.timeSlot.findFirst({
    where: {
      startTime: start,
      endTime: end,
      ...(current?.id ? { NOT: { id: current.id } } : {}),
    },
    select: { id: true },
  });

  if (duplicate) {
    throw new AppError('A time slot with the same date, start time, and end time already exists.', 409);
  }

  const semesters = await prisma.semester.findMany({
    select: { id: true, name: true, startDate: true, endDate: true },
  });

  if (semesters.length > 0 && !semesters.some((semester) => isDateWithinSemester(slotDateKey, semester))) {
    throw new AppError('Time slot date must fall within a configured semester range.', 400);
  }

  return {
    ...data,
    startTime: start,
    endTime: end,
    date: new Date(`${slotDateKey}T00:00:00.000Z`),
    duration: computedDuration,
  };
};

const buildTimeSlotWhere = (query = {}, availableOnly = false) => {
  const where = {};

  if (query.startFrom || query.endTo) {
    where.startTime = {
      ...(query.startFrom ? { gte: new Date(query.startFrom) } : {}),
      ...(query.endTo ? { lte: new Date(query.endTo) } : {}),
    };
  }

  if (query.scheduleId) {
    where.assignments = availableOnly
      ? { none: { scheduleId: query.scheduleId } }
      : { some: { scheduleId: query.scheduleId } };
  } else if (availableOnly) {
    where.assignments = { none: {} };
  }

  return where;
};

/**
 * Attempts to parse a search string as a date range:
 *   "YYYY"       → full year
 *   "YYYY-MM"    → full month
 *   "YYYY-MM-DD" → single day
 * Returns { gte, lte } Dates or null.
 */
const parseDateRange = (search) => {
  const s = search.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return { gte: new Date(`${s}T00:00:00.000Z`), lte: new Date(`${s}T23:59:59.999Z`) };
  }
  if (/^\d{4}-\d{2}$/.test(s)) {
    const [y, mo] = s.split('-').map(Number);
    const start = new Date(Date.UTC(y, mo - 1, 1));
    const end   = new Date(Date.UTC(y, mo, 0, 23, 59, 59, 999));
    return { gte: start, lte: end };
  }
  if (/^\d{4}$/.test(s)) {
    const y = parseInt(s, 10);
    return { gte: new Date(Date.UTC(y, 0, 1)), lte: new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999)) };
  }
  return null;
};

/**
 * Resolves IDs of time slots whose startTime or endTime (UTC) matches "HH:MM".
 * Uses a raw query because Prisma has no typed UTC-hour/minute extraction.
 * Returns an array of id strings, or null if search is not HH:MM format.
 */
const resolveTimeSearch = async (search) => {
  const m = search.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;

  const rows = await prisma.$queryRaw`
    SELECT id FROM "time_slots"
    WHERE EXTRACT(HOUR   FROM "startTime" AT TIME ZONE 'UTC') = ${h}
      AND EXTRACT(MINUTE FROM "startTime" AT TIME ZONE 'UTC') = ${min}
    UNION
    SELECT id FROM "time_slots"
    WHERE EXTRACT(HOUR   FROM "endTime" AT TIME ZONE 'UTC') = ${h}
      AND EXTRACT(MINUTE FROM "endTime" AT TIME ZONE 'UTC') = ${min}
  `;
  return rows.map((r) => r.id);
};

const TIMESLOT_SORT_FIELDS = {
  startTime: (dir) => ({ startTime: dir }),
  endTime:   (dir) => ({ endTime: dir }),
  date:      (dir) => ({ date: dir }),
  duration:  (dir) => ({ duration: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
};

export const getAll = async (query = {}) => {
  const { page, limit, skip, sortField, sortDirection, search } = parseListQuery(query);

  const where = buildTimeSlotWhere(query);

  // Server-side search: supports date patterns, duration (integer), and HH:MM time
  if (search) {
    const clauses = [];

    // Duration: exact integer match (e.g. "120" → 2-hour slots)
    const numMatch = parseInt(search, 10);
    if (!isNaN(numMatch) && String(numMatch) === search.trim()) {
      clauses.push({ duration: numMatch });
    }

    // Date range: "YYYY", "YYYY-MM", "YYYY-MM-DD"
    const dateRange = parseDateRange(search);
    if (dateRange) {
      // Prefer the dedicated `date` field; fall back to startTime for older slots
      clauses.push({ date: { gte: dateRange.gte, lte: dateRange.lte } });
      clauses.push({
        AND: [{ date: null }, { startTime: { gte: dateRange.gte, lte: dateRange.lte } }],
      });
    }

    // HH:MM time match: look up IDs via raw SQL
    const timeIds = await resolveTimeSearch(search);
    if (timeIds !== null) {
      if (timeIds.length > 0) clauses.push({ id: { in: timeIds } });
      // if timeIds is empty the time existed but matched nothing — leave clauses as-is
    }

    if (clauses.length > 0) where.OR = clauses;
  }

  const orderBy = buildOrderBy(sortField, sortDirection, TIMESLOT_SORT_FIELDS, [{ startTime: 'asc' }]);

  const [data, total] = await Promise.all([
    prisma.timeSlot.findMany({ where, skip, take: limit, orderBy, include: timeSlotInclude }),
    prisma.timeSlot.count({ where }),
  ]);

  return { data, meta: buildMeta(total, page, limit) };
};

export const getAvailable = async (query = {}) => {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 10;
  const skip = (page - 1) * limit;

  const where = buildTimeSlotWhere(query, true);

  const [data, total] = await Promise.all([
    prisma.timeSlot.findMany({
      where,
      skip,
      take: limit,
      orderBy: { startTime: 'asc' },
      include: timeSlotInclude,
    }),
    prisma.timeSlot.count({ where }),
  ]);

  return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const getById = async (id) => {
  const data = await prisma.timeSlot.findUnique({
    where: { id },
    include: timeSlotInclude,
  });
  if (!data) throw new AppError('Not found', 404);
  return data;
};

export const create = async (data) => {
  const payload = await normalizeTimeSlotPayload(data);
  return await prisma.timeSlot.create({ data: payload, include: timeSlotInclude });
};

export const update = async (id, data) => {
  const current = await prisma.timeSlot.findUnique({ where: { id } });
  if (!current) throw new AppError('Not found', 404);
  const payload = await normalizeTimeSlotPayload(data, current);
  return prisma.$transaction(async (tx) => {
    const scheduleIds = await findImpactedScheduleIds({ dependency: 'timeSlot', ids: [id] }, tx);
    const updated = await tx.timeSlot.update({ where: { id }, data: payload, include: timeSlotInclude });
    await synchronizeSchedules(scheduleIds, tx);
    return updated;
  });
};

export const remove = async (id) => {
  return prisma.$transaction(async (tx) => {
    const scheduleIds = await findImpactedScheduleIds({ dependency: 'timeSlot', ids: [id] }, tx);
    await assertNoScheduleAssignmentsForDependency({ dependency: 'timeSlot', ids: [id], entityLabel: 'TimeSlot' }, tx);
    await removeAssignmentsForDependencyDelete({ dependency: 'timeSlot', ids: [id] }, tx);
    const deleted = await tx.timeSlot.delete({ where: { id } });
    await synchronizeSchedules(scheduleIds, tx);
    return deleted;
  });
};
