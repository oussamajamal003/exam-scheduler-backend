import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

const DEFAULT_EXAM_DURATION = 120;

// ────────────────────────────────────────────────────────────────────────────
// Prisma include shape used by list/get endpoints
// ────────────────────────────────────────────────────────────────────────────
const conflictInclude = {
  schedule: {
    select: {
      id: true,
      name: true,
      isFinal: true,
      createdAt: true,
    },
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Load a schedule + all data required for full conflict detection
// ────────────────────────────────────────────────────────────────────────────
const loadScheduleForDetection = async (scheduleId) => {
  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    include: {
      assignments: {
        include: {
          exam: {
            include: {
              courseOffering: {
                include: {
                  course: true,
                  semester: true,
                  registrations: {
                    select: {
                      studentId: true,
                      student: {
                        select: {
                          universityId: true,
                          user: { select: { name: true, email: true } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          room: { include: { center: true } },
          supervisor: { include: { user: { select: { id: true, name: true, email: true } } } },
          timeSlot: true,
        },
      },
    },
  });

  if (!schedule) throw new AppError('Schedule not found', 404);
  return schedule;
};

// ────────────────────────────────────────────────────────────────────────────
// Human-readable label helpers — never expose raw UUIDs
// ────────────────────────────────────────────────────────────────────────────
const fmtSlot = (slot) => {
  if (!slot?.startTime) return 'an unknown time slot';
  const start = new Date(slot.startTime).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const end = slot.endTime
    ? new Date(slot.endTime).toLocaleTimeString('en-US', { timeStyle: 'short' })
    : null;
  return end ? `${start} – ${end}` : start;
};

const fmtDate = (d) =>
  new Date(d).toLocaleDateString('en-US', { dateStyle: 'medium' });

const examLabel = (a) => {
  const course = a.exam?.courseOffering?.course;
  return [course?.code, course?.title].filter(Boolean).join(' — ') || 'an exam';
};

const roomLabel = (a) => {
  const r = a.room;
  if (!r?.name) return 'an unknown room';
  return r.center?.name ? `${r.name} at ${r.center.name}` : r.name;
};

const supervisorLabel = (a) => {
  const u = a.supervisor?.user;
  if (!u?.name) return 'an unknown supervisor';
  return u.email ? `${u.name} (${u.email})` : u.name;
};

const studentLabel = (info) => {
  if (info?.name) return info.email ? `${info.name} (${info.email})` : info.name;
  if (info?.universityId) return `Student ${info.universityId}`;
  return null;
};

// ────────────────────────────────────────────────────────────────────────────
// Time helpers
// ────────────────────────────────────────────────────────────────────────────
const slotDurationMinutes = (slot) => {
  if (slot?.duration) return slot.duration;
  if (!slot?.startTime || !slot?.endTime) return 0;
  return Math.round((new Date(slot.endTime) - new Date(slot.startTime)) / 60000);
};

/** True when two half-open intervals [startA, endA) and [startB, endB) overlap */
const slotsOverlap = (slotA, slotB) => {
  if (!slotA?.startTime || !slotA?.endTime || !slotB?.startTime || !slotB?.endTime) return false;
  return new Date(slotA.startTime) < new Date(slotB.endTime)
      && new Date(slotB.startTime) < new Date(slotA.endTime);
};

/** ISO date string YYYY-MM-DD for a slot */
const slotDateKey = (slot) => {
  const d = slot?.date ?? slot?.startTime;
  return d ? new Date(d).toISOString().slice(0, 10) : null;
};

// ────────────────────────────────────────────────────────────────────────────
// Core detection engine
// ────────────────────────────────────────────────────────────────────────────
const computeConflicts = (schedule) => {
  const conflicts = [];
  const assignments = schedule.assignments;

  // ── Pre-build student info map (studentId → { name, email, universityId }) ──
  const studentInfoMap = new Map();
  for (const a of assignments) {
    for (const reg of a.exam?.courseOffering?.registrations ?? []) {
      if (!studentInfoMap.has(reg.studentId)) {
        studentInfoMap.set(reg.studentId, {
          name: reg.student?.user?.name ?? null,
          email: reg.student?.user?.email ?? null,
          universityId: reg.student?.universityId ?? null,
        });
      }
    }
  }

  // ── 1. TIME_CONSTRAINT_VIOLATION ─────────────────────────────────────────
  //   1a. Exam duration exceeds assigned time slot duration
  //   1b. Time slot falls outside its semester date range
  for (const a of assignments) {
    const slot = a.timeSlot;
    const examDuration = a.exam?.duration ?? DEFAULT_EXAM_DURATION;
    const slotDur = slotDurationMinutes(slot);

    if (slotDur > 0 && slotDur < examDuration) {
      conflicts.push({
        type: 'TIME_CONSTRAINT_VIOLATION',
        description:
          `"${examLabel(a)}" requires ${examDuration} min but the assigned time slot`
          + ` (${fmtSlot(slot)}) is only ${slotDur} min long.`,
      });
    }

    const semester = a.exam?.courseOffering?.semester;
    if (semester && slot?.startTime) {
      const slotStart = new Date(slot.startTime);
      const slotEnd   = slot.endTime ? new Date(slot.endTime) : null;
      const semStart  = new Date(semester.startDate);
      const semEnd    = new Date(semester.endDate);

      if (slotStart < semStart || (slotEnd && slotEnd > semEnd)) {
        conflicts.push({
          type: 'TIME_CONSTRAINT_VIOLATION',
          description:
            `"${examLabel(a)}" is scheduled at ${fmtSlot(slot)}, which is outside`
            + ` the semester "${semester.name}" date range`
            + ` (${fmtDate(semester.startDate)} – ${fmtDate(semester.endDate)}).`,
        });
      }
    }
  }

  // ── 2. STUDENT_OVERLAP ───────────────────────────────────────────────────
  //   Same student enrolled in two different exams whose slots overlap.
  //   Multi-supervisor rows for the same exam share the same student list
  //   so we check by examId to avoid false positives.
  const studentExamSlots = new Map(); // studentId → [{ examId, slot, a }]
  for (const a of assignments) {
    for (const reg of a.exam?.courseOffering?.registrations ?? []) {
      if (!studentExamSlots.has(reg.studentId)) studentExamSlots.set(reg.studentId, []);
      studentExamSlots.get(reg.studentId).push({ examId: a.examId, slot: a.timeSlot, a });
    }
  }

  const seenStudentOverlap = new Set();
  for (const [studentId, entries] of studentExamSlots.entries()) {
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        if (entries[i].examId === entries[j].examId) continue; // same exam, different rooms
        if (!slotsOverlap(entries[i].slot, entries[j].slot)) continue;

        const pairKey = `${studentId}:${[entries[i].examId, entries[j].examId].sort().join(':')}`;
        if (seenStudentOverlap.has(pairKey)) continue;
        seenStudentOverlap.add(pairKey);

        const sLabel = studentLabel(studentInfoMap.get(studentId)) ?? 'A student';
        conflicts.push({
          type: 'STUDENT_OVERLAP',
          description:
            `${sLabel} is enrolled in both "${examLabel(entries[i].a)}" (${fmtSlot(entries[i].slot)})`
            + ` and "${examLabel(entries[j].a)}" (${fmtSlot(entries[j].slot)})`
            + ` — these time slots overlap.`,
        });
      }
    }
  }

  // ── 3. SUPERVISOR_DOUBLE_BOOKED ──────────────────────────────────────────
  //   3a. Same supervisor assigned to two different exams in overlapping slots.
  //       (Same exam + same supervisor + different rooms is intentional — multi-room.)
  //   3b. Same supervisor assigned to more exams in one day than maxExamsPerDay.
  const supervisorExamSlots = new Map(); // supervisorId → [{ examId, slot, a }]
  for (const a of assignments) {
    if (!a.supervisorId) continue;
    if (!supervisorExamSlots.has(a.supervisorId)) supervisorExamSlots.set(a.supervisorId, []);
    supervisorExamSlots.get(a.supervisorId).push({ examId: a.examId, slot: a.timeSlot, a });
  }

  const seenSupervisorOverlap = new Set();
  for (const [, entries] of supervisorExamSlots.entries()) {
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        if (entries[i].examId === entries[j].examId) continue; // same exam, intentional
        if (!slotsOverlap(entries[i].slot, entries[j].slot)) continue;

        const pairKey = `${entries[i].a.supervisorId}:${[entries[i].examId, entries[j].examId].sort().join(':')}`;
        if (seenSupervisorOverlap.has(pairKey)) continue;
        seenSupervisorOverlap.add(pairKey);

        conflicts.push({
          type: 'SUPERVISOR_DOUBLE_BOOKED',
          description:
            `Supervisor "${supervisorLabel(entries[i].a)}" is double-booked — assigned to`
            + ` "${examLabel(entries[i].a)}" (${fmtSlot(entries[i].slot)})`
            + ` and "${examLabel(entries[j].a)}" (${fmtSlot(entries[j].slot)}).`,
        });
      }
    }
  }

  // 3b. Daily workload limit
  const supervisorDayExams = new Map(); // `supervisorId:dateKey` → { exams: Set, a }
  for (const a of assignments) {
    if (!a.supervisorId) continue;
    const dk = slotDateKey(a.timeSlot);
    if (!dk) continue;
    const key = `${a.supervisorId}:${dk}`;
    if (!supervisorDayExams.has(key)) supervisorDayExams.set(key, { exams: new Set(), a });
    supervisorDayExams.get(key).exams.add(a.examId);
  }

  for (const [, { exams, a }] of supervisorDayExams.entries()) {
    const maxPerDay = a.supervisor?.maxExamsPerDay ?? 2;
    if (exams.size > maxPerDay) {
      const dk = slotDateKey(a.timeSlot);
      const dateStr = dk
        ? new Date(dk).toLocaleDateString('en-US', { dateStyle: 'medium', timeZone: 'UTC' })
        : 'that day';
      conflicts.push({
        type: 'SUPERVISOR_DOUBLE_BOOKED',
        description:
          `Supervisor "${supervisorLabel(a)}" exceeds the daily exam limit`
          + ` (max ${maxPerDay}) on ${dateStr} with ${exams.size} assigned exams.`,
      });
    }
  }

  // ── 4. ROOM_OVERCAPACITY ─────────────────────────────────────────────────
  //   For each (examId, timeSlotId) group, count unique rooms only — multi-supervisor
  //   rows sharing the same room must not double-count capacity.
  const examSlotRooms = new Map(); // key → { roomIds: Set, totalCapacity, a }
  for (const a of assignments) {
    const key = `${a.examId}:${a.timeSlotId}`;
    if (!examSlotRooms.has(key)) examSlotRooms.set(key, { roomIds: new Set(), totalCapacity: 0, a });
    const group = examSlotRooms.get(key);
    if (!group.roomIds.has(a.roomId)) {
      group.roomIds.add(a.roomId);
      group.totalCapacity += a.room?.capacity ?? 0;
    }
  }

  for (const [, { totalCapacity, a }] of examSlotRooms.entries()) {
    const offering = a.exam?.courseOffering;
    const registered = offering?.registrations?.length ?? 0;
    const expected   = offering?.expectedStudents ?? 0;
    const needed     = Math.max(registered, expected, 1);
    if (totalCapacity < needed) {
      conflicts.push({
        type: 'ROOM_OVERCAPACITY',
        description:
          `"${examLabel(a)}" requires ${needed} seats at ${fmtSlot(a.timeSlot)},`
          + ` but the allocated room(s) only provide ${totalCapacity}.`,
      });
    }
  }

  // ── 5. RESOURCE_UNAVAILABLE ──────────────────────────────────────────────
  //   5a. Room status is not AVAILABLE (maintenance / offline)
  //   5b. Room double-booked by two different exams in overlapping time slots
  const seenRoomUnavailable = new Set();
  for (const a of assignments) {
    if (a.room?.status && a.room.status !== 'AVAILABLE') {
      const key = `${a.roomId}:${a.examId}`;
      if (seenRoomUnavailable.has(key)) continue;
      seenRoomUnavailable.add(key);
      conflicts.push({
        type: 'RESOURCE_UNAVAILABLE',
        description:
          `Room "${roomLabel(a)}" has status "${a.room.status}"`
          + ` but is assigned to "${examLabel(a)}".`,
      });
    }
  }

  const roomExamSlots = new Map(); // roomId → [{ examId, slot, a }]
  for (const a of assignments) {
    if (!roomExamSlots.has(a.roomId)) roomExamSlots.set(a.roomId, []);
    roomExamSlots.get(a.roomId).push({ examId: a.examId, slot: a.timeSlot, a });
  }

  const seenRoomDoubleBook = new Set();
  for (const [, entries] of roomExamSlots.entries()) {
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        if (entries[i].examId === entries[j].examId) continue; // same exam, multi-supervisor = ok
        if (!slotsOverlap(entries[i].slot, entries[j].slot)) continue;

        const pairKey = `${entries[i].a.roomId}:${[entries[i].examId, entries[j].examId].sort().join(':')}`;
        if (seenRoomDoubleBook.has(pairKey)) continue;
        seenRoomDoubleBook.add(pairKey);

        conflicts.push({
          type: 'RESOURCE_UNAVAILABLE',
          description:
            `Room "${roomLabel(entries[i].a)}" is double-booked —`
            + ` assigned to "${examLabel(entries[i].a)}" (${fmtSlot(entries[i].slot)})`
            + ` and "${examLabel(entries[j].a)}" (${fmtSlot(entries[j].slot)}).`,
        });
      }
    }
  }

  return conflicts;
};

// ────────────────────────────────────────────────────────────────────────────
// Conflict type metadata (criticality + human labels)
// ────────────────────────────────────────────────────────────────────────────
const CONFLICT_META = {
  STUDENT_OVERLAP: {
    label: 'Student Overlap',
    critical: true,
    severity: 'high',
  },
  SUPERVISOR_DOUBLE_BOOKED: {
    label: 'Supervisor Double-Booked',
    critical: true,
    severity: 'high',
  },
  ROOM_OVERCAPACITY: {
    label: 'Room Overcapacity',
    critical: true,
    severity: 'high',
  },
  RESOURCE_UNAVAILABLE: {
    label: 'Resource Unavailable',
    critical: true,
    severity: 'high',
  },
  TIME_CONSTRAINT_VIOLATION: {
    label: 'Time Constraint Violation',
    critical: false,
    severity: 'medium',
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Description parser — extracts named entities from the stored description
// so that explanation/suggestion responses reference real names & numbers.
// Returns a structured `parsed` object (shape varies per type) or null.
// ────────────────────────────────────────────────────────────────────────────
const parseDescription = (type, description) => {
  const d = description ?? '';

  switch (type) {
    case 'STUDENT_OVERLAP': {
      // "Jane Doe (jane@uni.edu) is enrolled in both "CS101 — Intro" (slot A) and "CS202 — DS" (slot B) — these time slots overlap."
      const m = d.match(
        /^(.+?) is enrolled in both "(.+?)" \((.+?)\) and "(.+?)" \((.+?)\)/
      );
      if (m)
        return { student: m[1], exam1: m[2], slot1: m[3], exam2: m[4], slot2: m[5] };
      return null;
    }

    case 'SUPERVISOR_DOUBLE_BOOKED': {
      // overlap: Supervisor "Name" is double-booked — assigned to "Exam A" (slot) and "Exam B" (slot).
      const mOverlap = d.match(
        /^Supervisor "(.+?)" is double-booked — assigned to "(.+?)" \((.+?)\) and "(.+?)" \((.+?)\)/
      );
      if (mOverlap)
        return {
          subtype: 'overlap',
          supervisor: mOverlap[1],
          exam1: mOverlap[2],
          slot1: mOverlap[3],
          exam2: mOverlap[4],
          slot2: mOverlap[5],
        };

      // daily limit: Supervisor "Name" exceeds the daily exam limit (max N) on DATE with M assigned exams.
      const mLimit = d.match(
        /^Supervisor "(.+?)" exceeds the daily exam limit \(max (\d+)\) on (.+?) with (\d+) assigned exams/
      );
      if (mLimit)
        return {
          subtype: 'daily_limit',
          supervisor: mLimit[1],
          maxPerDay: parseInt(mLimit[2]),
          date: mLimit[3],
          assignedCount: parseInt(mLimit[4]),
        };
      return null;
    }

    case 'ROOM_OVERCAPACITY': {
      // "Exam" requires N seats at SLOT, but the allocated room(s) only provide M.
      const m = d.match(
        /^"(.+?)" requires (\d+) seats at (.+?), but the allocated room\(s\) only provide (\d+)/
      );
      if (m)
        return {
          exam: m[1],
          required: parseInt(m[2]),
          slot: m[3],
          provided: parseInt(m[4]),
          deficit: parseInt(m[2]) - parseInt(m[4]),
        };
      return null;
    }

    case 'RESOURCE_UNAVAILABLE': {
      // status: Room "X" has status "STATUS" but is assigned to "Exam".
      const mStatus = d.match(
        /^Room "(.+?)" has status "(.+?)" but is assigned to "(.+?)"/
      );
      if (mStatus)
        return {
          subtype: 'room_status',
          room: mStatus[1],
          status: mStatus[2],
          exam: mStatus[3],
        };

      // double-book: Room "X" is double-booked — assigned to "Exam A" (slot) and "Exam B" (slot).
      const mDouble = d.match(
        /^Room "(.+?)" is double-booked — assigned to "(.+?)" \((.+?)\) and "(.+?)" \((.+?)\)/
      );
      if (mDouble)
        return {
          subtype: 'room_double_booked',
          room: mDouble[1],
          exam1: mDouble[2],
          slot1: mDouble[3],
          exam2: mDouble[4],
          slot2: mDouble[5],
        };
      return null;
    }

    case 'TIME_CONSTRAINT_VIOLATION': {
      // duration: "Exam" requires N min but the assigned time slot (SLOT) is only M min long.
      const mDur = d.match(
        /^"(.+?)" requires (\d+) min but the assigned time slot \((.+?)\) is only (\d+) min long/
      );
      if (mDur)
        return {
          subtype: 'duration',
          exam: mDur[1],
          required: parseInt(mDur[2]),
          slot: mDur[3],
          provided: parseInt(mDur[4]),
          shortage: parseInt(mDur[2]) - parseInt(mDur[4]),
        };

      // semester range: "Exam" is scheduled at SLOT, which is outside the semester "NAME" date range (START – END).
      const mSem = d.match(
        /^"(.+?)" is scheduled at (.+?), which is outside the semester "(.+?)" date range \((.+?) – (.+?)\)/
      );
      if (mSem)
        return {
          subtype: 'semester_range',
          exam: mSem[1],
          slot: mSem[2],
          semester: mSem[3],
          semesterStart: mSem[4],
          semesterEnd: mSem[5],
        };
      return null;
    }

    default:
      return null;
  }
};

// ────────────────────────────────────────────────────────────────────────────
// Explanation generator — data-driven, references real entity names/numbers
// ────────────────────────────────────────────────────────────────────────────
const buildExplanation = (conflict) => {
  const meta = CONFLICT_META[conflict.type] ?? { label: conflict.type, severity: 'medium' };
  const p = parseDescription(conflict.type, conflict.description);

  let explanation;

  switch (conflict.type) {
    case 'STUDENT_OVERLAP':
      explanation = p
        ? {
            summary: `${p.student} is enrolled in both "${p.exam1}" and "${p.exam2}", which are scheduled at overlapping times.`,
            cause: `"${p.exam1}" runs at ${p.slot1} and "${p.exam2}" runs at ${p.slot2}. These intervals overlap, making it impossible for the student to attend both.`,
            impact: 'The student will be unable to sit one of the exams unless the schedule is corrected.',
            entities: { student: p.student, exam1: p.exam1, slot1: p.slot1, exam2: p.exam2, slot2: p.slot2 },
          }
        : {
            summary: 'A student is enrolled in two exams scheduled at overlapping times.',
            cause: 'Two exams share the same or overlapping time slots, creating an impossible situation for at least one enrolled student.',
            impact: 'Affected students cannot attend both exams without a schedule change.',
            entities: {},
          };
      break;

    case 'SUPERVISOR_DOUBLE_BOOKED':
      if (p?.subtype === 'overlap') {
        explanation = {
          summary: `Supervisor "${p.supervisor}" is assigned to both "${p.exam1}" and "${p.exam2}" at overlapping times.`,
          cause: `"${p.exam1}" is scheduled at ${p.slot1} and "${p.exam2}" at ${p.slot2}. Both slots overlap, meaning the supervisor would need to be in two places simultaneously.`,
          impact: 'At least one exam will have no qualified supervisor present during the session.',
          entities: { supervisor: p.supervisor, exam1: p.exam1, slot1: p.slot1, exam2: p.exam2, slot2: p.slot2 },
        };
      } else if (p?.subtype === 'daily_limit') {
        explanation = {
          summary: `Supervisor "${p.supervisor}" is assigned to ${p.assignedCount} exams on ${p.date}, exceeding their daily limit of ${p.maxPerDay}.`,
          cause: `The supervisor's maximum exams per day is set to ${p.maxPerDay}, but ${p.assignedCount} exams have been assigned on ${p.date}.`,
          impact: 'Supervisor fatigue or unavailability may compromise exam integrity on that day.',
          entities: { supervisor: p.supervisor, date: p.date, assignedCount: p.assignedCount, maxPerDay: p.maxPerDay },
        };
      } else {
        explanation = {
          summary: 'A supervisor has been assigned to multiple exams at the same or overlapping times.',
          cause: 'The scheduling engine assigned the same supervisor to more than one exam in a conflicting time window, or their daily limit was exceeded.',
          impact: 'One or more exams may be left without adequate supervision.',
          entities: {},
        };
      }
      break;

    case 'ROOM_OVERCAPACITY':
      explanation = p
        ? {
            summary: `"${p.exam}" needs ${p.required} seats at ${p.slot}, but the allocated room(s) only provide ${p.provided} — a shortfall of ${p.deficit} seat(s).`,
            cause: `The number of registered students (${p.required}) exceeds the combined capacity (${p.provided}) of the room(s) allocated to this exam.`,
            impact: `${p.deficit} student(s) will have no seat and cannot be accommodated without a room change or additional space.`,
            entities: { exam: p.exam, slot: p.slot, required: p.required, provided: p.provided, deficit: p.deficit },
          }
        : {
            summary: 'An exam has more registered students than the allocated room(s) can seat.',
            cause: 'The total room capacity is insufficient for the number of students who need to sit this exam.',
            impact: 'Students will be left without a seat unless a larger room is assigned or the exam is split.',
            entities: {},
          };
      break;

    case 'RESOURCE_UNAVAILABLE':
      if (p?.subtype === 'room_status') {
        explanation = {
          summary: `Room "${p.room}" is assigned to "${p.exam}" but its current status is "${p.status}".`,
          cause: `The room has been marked as "${p.status}" in the system, which means it is not available for exam use.`,
          impact: 'The exam cannot proceed in this room until the room is returned to AVAILABLE status or reassigned.',
          entities: { room: p.room, status: p.status, exam: p.exam },
        };
      } else if (p?.subtype === 'room_double_booked') {
        explanation = {
          summary: `Room "${p.room}" is assigned to both "${p.exam1}" (${p.slot1}) and "${p.exam2}" (${p.slot2}) — these slots overlap.`,
          cause: 'The same physical room has been allocated to two different exams in overlapping time windows.',
          impact: 'Both exams cannot run simultaneously in the same room; one must be moved or assigned a different room.',
          entities: { room: p.room, exam1: p.exam1, slot1: p.slot1, exam2: p.exam2, slot2: p.slot2 },
        };
      } else {
        explanation = {
          summary: 'A required resource (room or supervisor) is unavailable for the scheduled exam.',
          cause: 'The room is either marked as unavailable or has been assigned to more than one exam in the same time window.',
          impact: 'The exam cannot be held as scheduled without resolving the resource conflict.',
          entities: {},
        };
      }
      break;

    case 'TIME_CONSTRAINT_VIOLATION':
      if (p?.subtype === 'duration') {
        explanation = {
          summary: `"${p.exam}" requires ${p.required} min but its assigned slot (${p.slot}) is only ${p.provided} min — ${p.shortage} min too short.`,
          cause: `The exam duration (${p.required} min) exceeds the length of the assigned time slot (${p.provided} min).`,
          impact: 'Students will not have enough time to complete the exam, or the exam will run into the next scheduled event.',
          entities: { exam: p.exam, slot: p.slot, required: p.required, provided: p.provided, shortage: p.shortage },
        };
      } else if (p?.subtype === 'semester_range') {
        explanation = {
          summary: `"${p.exam}" is scheduled at ${p.slot}, which falls outside the "${p.semester}" semester period (${p.semesterStart} – ${p.semesterEnd}).`,
          cause: `The assigned time slot is outside the valid date range for semester "${p.semester}".`,
          impact: 'The exam cannot be held outside the official semester window without administrative approval.',
          entities: { exam: p.exam, slot: p.slot, semester: p.semester, semesterStart: p.semesterStart, semesterEnd: p.semesterEnd },
        };
      } else {
        explanation = {
          summary: "An exam's time slot does not satisfy the exam's scheduling constraints.",
          cause: 'The assigned slot is either shorter than the exam duration or falls outside the semester date range.',
          impact: 'The exam cannot be administered as currently scheduled.',
          entities: {},
        };
      }
      break;

    default:
      explanation = {
        summary: conflict.description,
        cause: 'An unrecognised conflict type was detected.',
        impact: 'Manual review is required.',
        entities: {},
      };
  }

  return {
    type: conflict.type,
    typeLabel: meta.label,
    severity: meta.severity,
    description: conflict.description,
    explanation,
    detectedAt: conflict.createdAt,
    resolved: conflict.resolved,
    resolvedAt: conflict.resolvedAt ?? null,
    schedule: conflict.schedule ?? null,
  };
};

// ────────────────────────────────────────────────────────────────────────────
// Suggestion generator — data-driven, tailored to parsed entities
// ────────────────────────────────────────────────────────────────────────────
const buildSuggestions = (conflict) => {
  const p = parseDescription(conflict.type, conflict.description);
  let suggestions = [];

  switch (conflict.type) {
    case 'STUDENT_OVERLAP':
      suggestions = [
        {
          action: 'move_exam_time',
          label: p
            ? `Reschedule "${p.exam2}" to a non-overlapping slot`
            : 'Reschedule one of the overlapping exams',
          detail: p
            ? `Move "${p.exam2}" (currently at ${p.slot2}) to a time slot that does not overlap with "${p.exam1}" (${p.slot1}). Check all students shared between the two exams before choosing the new slot.`
            : 'Assign one of the conflicting exams to a different time slot so that no enrolled student faces two exams at the same time.',
          priority: 1,
        },
        {
          action: 'add_time_slot',
          label: 'Add a conflict-free time slot',
          detail: p
            ? `Create a new time slot that does not overlap with ${p.slot1} and assign one of the conflicting exams to it, minimising disruption to the overall schedule.`
            : 'Create an additional time slot that is free of student-level conflicts and use it for one of the affected exams.',
          priority: 2,
        },
        {
          action: 'split_exam',
          label: p ? `Split "${p.exam1}" or "${p.exam2}" into two sittings` : 'Split one exam into two sittings',
          detail: 'Offer the affected exam at both an earlier and a later sitting so that conflicted students can attend the alternative one.',
          priority: 3,
        },
      ];
      break;

    case 'SUPERVISOR_DOUBLE_BOOKED':
      if (p?.subtype === 'overlap') {
        suggestions = [
          {
            action: 'assign_different_supervisor',
            label: `Replace "${p.supervisor}" on one of the conflicting exams`,
            detail: `Assign a different available supervisor to either "${p.exam1}" (${p.slot1}) or "${p.exam2}" (${p.slot2}) so that "${p.supervisor}" only covers one exam.`,
            priority: 1,
          },
          {
            action: 'move_exam_time',
            label: `Reschedule "${p.exam2}" to a non-overlapping slot`,
            detail: `Move "${p.exam2}" from ${p.slot2} to a time that does not conflict with ${p.slot1}, allowing "${p.supervisor}" to cover both if needed.`,
            priority: 2,
          },
        ];
      } else if (p?.subtype === 'daily_limit') {
        suggestions = [
          {
            action: 'assign_different_supervisor',
            label: `Remove "${p.supervisor}" from one exam on ${p.date}`,
            detail: `Redistribute the workload on ${p.date} — assign at least one of the ${p.assignedCount} exams to a different supervisor so the daily limit of ${p.maxPerDay} is not exceeded.`,
            priority: 1,
          },
          {
            action: 'move_exam_time',
            label: `Move one exam on ${p.date} to a different day`,
            detail: `Shift one of the exams assigned to "${p.supervisor}" on ${p.date} to another day where they have fewer commitments.`,
            priority: 2,
          },
          {
            action: 'increase_supervisor_workload',
            label: `Increase the daily exam limit for "${p.supervisor}"`,
            detail: `If "${p.supervisor}" agrees and the institution permits it, raise their maxExamsPerDay setting above ${p.maxPerDay} to accommodate ${p.assignedCount} exams on ${p.date}.`,
            priority: 3,
          },
        ];
      } else {
        suggestions = [
          {
            action: 'assign_different_supervisor',
            label: 'Assign an available supervisor to one of the conflicting exams',
            detail: 'Replace the double-booked supervisor on one exam with another qualified supervisor who is free during that time slot.',
            priority: 1,
          },
          {
            action: 'move_exam_time',
            label: 'Reschedule one of the conflicting exams',
            detail: 'Move one exam to a slot where the supervisor is not already committed.',
            priority: 2,
          },
        ];
      }
      break;

    case 'ROOM_OVERCAPACITY':
      suggestions = [
        {
          action: 'change_room',
          label: p ? `Replace the current room with one that seats at least ${p.required}` : 'Assign a larger room',
          detail: p
            ? `The current allocation for "${p.exam}" only provides ${p.provided} seats. Choose a different room with a capacity of at least ${p.required} to cover all registered students at ${p.slot}.`
            : 'Replace the current room with one that has enough capacity for all registered students.',
          priority: 1,
        },
        {
          action: 'add_room',
          label: p ? `Add a supplementary room to cover the ${p.deficit}-seat deficit` : 'Add an additional room',
          detail: p
            ? `Keep the existing room and add one or more rooms whose combined extra capacity makes up the ${p.deficit}-seat shortfall for "${p.exam}".`
            : 'Keep the current room and pair it with an extra room so the combined capacity meets the required seats.',
          priority: 2,
        },
        {
          action: 'split_exam',
          label: p ? `Split "${p.exam}" across multiple rooms` : 'Split the exam across rooms',
          detail: p
            ? `Divide the ${p.required} students registered for "${p.exam}" across two or more rooms at ${p.slot}, ensuring each room stays within its capacity.`
            : 'Distribute enrolled students across several smaller rooms scheduled at the same time slot.',
          priority: 3,
        },
      ];
      break;

    case 'RESOURCE_UNAVAILABLE':
      if (p?.subtype === 'room_status') {
        suggestions = [
          {
            action: 'change_room',
            label: `Assign an available room to replace "${p.room}"`,
            detail: `"${p.room}" is currently "${p.status}". Pick a different room that is marked AVAILABLE and has enough capacity for "${p.exam}".`,
            priority: 1,
          },
          {
            action: 'set_room_available',
            label: `Change "${p.room}" status to AVAILABLE`,
            detail: `If the maintenance or unavailability of "${p.room}" has been resolved, update its status to AVAILABLE so it can be used for "${p.exam}".`,
            priority: 2,
          },
          {
            action: 'move_exam_time',
            label: `Reschedule "${p.exam}" to when "${p.room}" is available`,
            detail: `Move "${p.exam}" to a time slot where "${p.room}" is not under maintenance or otherwise unavailable.`,
            priority: 3,
          },
        ];
      } else if (p?.subtype === 'room_double_booked') {
        suggestions = [
          {
            action: 'change_room',
            label: p ? `Assign a different room to "${p.exam2}"` : 'Reassign one of the double-booked exams to another room',
            detail: p
              ? `Room "${p.room}" is already occupied by "${p.exam1}" at ${p.slot1}. Assign a different available room to "${p.exam2}" (${p.slot2}).`
              : 'Replace the double-booked room on one of the conflicting exams with another room that is free in that time slot.',
            priority: 1,
          },
          {
            action: 'move_exam_time',
            label: p ? `Reschedule "${p.exam2}" to a slot when "${p.room}" is free` : 'Move one exam to a non-conflicting slot',
            detail: p
              ? `Move "${p.exam2}" from ${p.slot2} to a time slot when room "${p.room}" is not already occupied by "${p.exam1}".`
              : 'If no alternative room is available, shift one exam to a slot where the room is unoccupied.',
            priority: 2,
          },
        ];
      } else {
        suggestions = [
          {
            action: 'change_room',
            label: 'Assign a different, available room',
            detail: 'Replace the unavailable or double-booked room with one marked AVAILABLE that is not already occupied in that time slot.',
            priority: 1,
          },
          {
            action: 'add_time_slot',
            label: 'Add more time slots to the semester',
            detail: 'Creating additional time slots increases scheduling flexibility and may provide a conflict-free window for this exam.',
            priority: 2,
          },
          {
            action: 'add_supervisor',
            label: 'Add more qualified supervisors',
            detail: 'Expanding the pool of available supervisors reduces the chance of double-booking and coverage gaps.',
            priority: 3,
          },
          {
            action: 'set_room_available',
            label: 'Mark rooms as AVAILABLE',
            detail: 'Review rooms currently set to MAINTENANCE or OFFLINE and restore their status if they are ready for use.',
            priority: 4,
          },
          {
            action: 'increase_supervisor_workload',
            label: 'Increase supervisor maximum daily exam limit',
            detail: 'Raising the maxExamsPerDay limit for supervisors with spare capacity gives the scheduler more valid assignment options.',
            priority: 5,
          },
        ];
      }
      break;

    case 'TIME_CONSTRAINT_VIOLATION':
      if (p?.subtype === 'duration') {
        suggestions = [
          {
            action: 'add_time_slot',
            label: `Select or create a time slot of at least ${p.required} min for "${p.exam}"`,
            detail: `The current slot (${p.slot}) is ${p.provided} min — ${p.shortage} min too short. Assign a slot whose duration is at least ${p.required} min.`,
            priority: 1,
          },
          {
            action: 'move_exam_time',
            label: `Move "${p.exam}" to a longer existing slot`,
            detail: `Browse available time slots and find one that is ${p.required} min or longer, then reassign "${p.exam}" to that slot.`,
            priority: 2,
          },
          {
            action: 'review_exam_duration',
            label: `Verify the exam duration for "${p.exam}"`,
            detail: `If the ${p.required}-min duration was entered incorrectly, correct it on the exam record to match the intended sitting length, then regenerate the schedule.`,
            priority: 3,
          },
        ];
      } else if (p?.subtype === 'semester_range') {
        suggestions = [
          {
            action: 'move_exam_time',
            label: `Move "${p.exam}" to a slot inside the "${p.semester}" date range`,
            detail: `The exam is scheduled at ${p.slot}, which is outside ${p.semesterStart} – ${p.semesterEnd}. Select a time slot that falls within these dates.`,
            priority: 1,
          },
          {
            action: 'add_time_slot',
            label: `Add a valid time slot within the "${p.semester}" semester period`,
            detail: `Create a new time slot between ${p.semesterStart} and ${p.semesterEnd} and assign "${p.exam}" to it.`,
            priority: 2,
          },
        ];
      } else {
        suggestions = [
          {
            action: 'add_time_slot',
            label: 'Select or add a time slot that meets the exam duration requirement',
            detail: "Assign a slot whose duration is at least as long as the exam's required duration.",
            priority: 1,
          },
          {
            action: 'move_exam_time',
            label: 'Move the exam inside the valid semester window',
            detail: 'Choose a time slot that falls within the official start and end dates of the semester.',
            priority: 2,
          },
        ];
      }
      break;

    default:
      suggestions = [
        {
          action: 'manual_review',
          label: 'Review this conflict manually',
          detail: 'No automated suggestion is available for this conflict type. A scheduling administrator should review and resolve it directly.',
          priority: 1,
        },
      ];
  }

  return {
    type: conflict.type,
    typeLabel: (CONFLICT_META[conflict.type] ?? {}).label ?? conflict.type,
    severity: (CONFLICT_META[conflict.type] ?? {}).severity ?? 'medium',
    description: conflict.description,
    parsedEntities: p ?? {},
    suggestions,
  };
};

// ────────────────────────────────────────────────────────────────────────────
// service API
// ────────────────────────────────────────────────────────────────────────────

export const getAll = async (query = {}) => {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 10;
  const skip = (page - 1) * limit;

  const where = {};
  if (query.scheduleId) where.scheduleId = query.scheduleId;
  if (query.type) where.type = query.type;
  if (query.resolved !== undefined) {
    where.resolved = query.resolved === true || query.resolved === 'true';
  }
  if (query.search) {
    where.description = { contains: query.search, mode: 'insensitive' };
  }

  const [data, total] = await Promise.all([
    prisma.conflict.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: conflictInclude,
    }),
    prisma.conflict.count({ where }),
  ]);

  // Attach human-readable metadata to each conflict
  const enriched = data.map((c) => ({
    ...c,
    typeLabel: (CONFLICT_META[c.type] ?? {}).label ?? c.type,
    severity: (CONFLICT_META[c.type] ?? {}).severity ?? 'medium',
  }));

  return {
    data: enriched,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
};

export const getById = async (id) => {
  const conflict = await prisma.conflict.findUnique({
    where: { id },
    include: conflictInclude,
  });
  if (!conflict) throw new AppError('Conflict not found', 404);
  return {
    ...conflict,
    typeLabel: (CONFLICT_META[conflict.type] ?? {}).label ?? conflict.type,
    severity: (CONFLICT_META[conflict.type] ?? {}).severity ?? 'medium',
  };
};

export const getByScheduleId = async (scheduleId) => {
  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    select: { id: true },
  });
  if (!schedule) throw new AppError('Schedule not found', 404);

  const data = await prisma.conflict.findMany({
    where: { scheduleId },
    orderBy: { createdAt: 'desc' },
    include: conflictInclude,
  });

  return data.map((c) => ({
    ...c,
    typeLabel: (CONFLICT_META[c.type] ?? {}).label ?? c.type,
    severity: (CONFLICT_META[c.type] ?? {}).severity ?? 'medium',
  }));
};

export const getExplanation = async (id) => {
  const conflict = await prisma.conflict.findUnique({
    where: { id },
    include: conflictInclude,
  });
  if (!conflict) throw new AppError('Conflict not found', 404);
  return buildExplanation(conflict);
};

export const getSuggestions = async (id) => {
  const conflict = await prisma.conflict.findUnique({
    where: { id },
    include: conflictInclude,
  });
  if (!conflict) throw new AppError('Conflict not found', 404);
  return buildSuggestions(conflict);
};

export const resolve = async (id, user) => {
  const existing = await prisma.conflict.findUnique({ where: { id } });
  if (!existing) throw new AppError('Conflict not found', 404);
  if (existing.resolved) throw new AppError('Conflict is already resolved', 400);

  const updated = await prisma.conflict.update({
    where: { id },
    data: {
      resolved: true,
      resolvedAt: new Date(),
      resolvedBy: user?.id ?? null,
      updatedBy: user?.id ?? null,
    },
    include: conflictInclude,
  });

  return {
    ...updated,
    typeLabel: (CONFLICT_META[updated.type] ?? {}).label ?? updated.type,
    severity: (CONFLICT_META[updated.type] ?? {}).severity ?? 'medium',
  };
};

export const detect = async (data, user) => {
  const { scheduleId } = data;
  if (!scheduleId) throw new AppError('scheduleId is required', 400);

  const schedule = await loadScheduleForDetection(scheduleId);
  const detected = computeConflicts(schedule);

  // Persist with deduplication:
  //  • Detected conflict still exists + was resolved  → reopen (no new record)
  //  • Detected conflict still exists + was unresolved → keep as-is
  //  • Previously unresolved conflict no longer detected → delete (issue gone)
  //  • Previously resolved conflict no longer detected → keep (audit trail)
  //  • New conflict with no existing match            → create
  const persisted = await prisma.$transaction(async (tx) => {
    // Load ALL existing conflicts for this schedule (resolved and unresolved)
    const existing = await tx.conflict.findMany({ where: { scheduleId } });

    // Build a lookup key: type + description (descriptions are deterministic for same issue)
    const existingByKey = new Map(existing.map((c) => [`${c.type}::${c.description}`, c]));
    const detectedKeys = new Set(detected.map((c) => `${c.type}::${c.description}`));

    // 1. Delete unresolved conflicts that are no longer detected (issue gone)
    const staleIds = existing
      .filter((c) => !c.resolved && !detectedKeys.has(`${c.type}::${c.description}`))
      .map((c) => c.id);
    if (staleIds.length > 0) {
      await tx.conflict.deleteMany({ where: { id: { in: staleIds } } });
    }

    // 2. For each detected conflict, reopen resolved duplicates or create new records
    for (const c of detected) {
      const key = `${c.type}::${c.description}`;
      const match = existingByKey.get(key);

      if (match) {
        if (match.resolved) {
          // Reopen: issue was marked resolved but still exists
          await tx.conflict.update({
            where: { id: match.id },
            data: {
              resolved: false,
              resolvedAt: null,
              resolvedBy: null,
              createdAt: new Date(),
              updatedBy: user?.id ?? null,
            },
          });
        }
        // else: already unresolved and still detected — leave untouched
      } else {
        // Genuinely new conflict
        await tx.conflict.create({
          data: {
            scheduleId,
            type: c.type,
            description: c.description,
            resolved: false,
            createdBy: user?.id ?? null,
          },
        });
      }
    }

    return tx.conflict.findMany({
      where: { scheduleId, resolved: false },
      orderBy: { createdAt: 'desc' },
      include: conflictInclude,
    });
  });

  // Build summary
  const byType = {};
  for (const c of persisted) {
    byType[c.type] = (byType[c.type] ?? 0) + 1;
  }

  const criticalCount = persisted.filter((c) => CONFLICT_META[c.type]?.critical).length;

  const enriched = persisted.map((c) => ({
    ...c,
    typeLabel: (CONFLICT_META[c.type] ?? {}).label ?? c.type,
    severity: (CONFLICT_META[c.type] ?? {}).severity ?? 'medium',
  }));

  return {
    scheduleId,
    totalConflicts: persisted.length,
    byType,
    criticalCount,
    resolvedCount: 0,
    unresolvedCount: persisted.length,
    conflicts: enriched,
  };
}
