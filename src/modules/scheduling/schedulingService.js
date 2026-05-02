import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

const DEFAULT_EXAM_DURATION = 120;

const getUniqueStudentIdsFromRegistrations = (registrations = []) => {
  const ids = new Set();
  for (const registration of registrations) {
    if (registration.studentId) ids.add(registration.studentId);
  }
  return [...ids];
};

const getUniqueStudentIdsForExam = (exam) => {
  return getUniqueStudentIdsFromRegistrations(exam.courseOffering?.registrations ?? []);
};
 
const getRequiredSeatsForExam = (exam) => {
  const registered = exam.courseOffering?.registrations?.length ?? exam.studentCount ?? 0;
  const expected = exam.courseOffering?.expectedStudents ?? exam.expectedStudents ?? 0;
  return Math.max(registered, expected, 1);
};

const getTimeslotsInSemesterRange = (semester, timeSlots) => {
  return timeSlots
    .filter((slot) => slot.startTime >= semester.startDate && slot.endTime <= semester.endDate)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
};

const toDateKey = (date) => date.toISOString().slice(0, 10);

const addToNestedSet = (map, key, value) => {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
};

const buildStudentExamMap = (exams) => {
  const studentToExams = new Map();

  for (const exam of exams) {
    for (const studentId of exam.studentIds) {
      addToNestedSet(studentToExams, studentId, exam.id);
    }
  }

  return studentToExams;
};

const compareExamsForScheduling = (a, b) => (
  b.studentCount - a.studentCount
  || b.priority - a.priority
  || b.difficulty - a.difficulty
  || (a.courseCode ?? '').localeCompare(b.courseCode ?? '')
);

const normalizeSchedulingData = ({ courseOfferings, rooms, supervisors, timeSlots, existingAssignments }) => {
  const exams = courseOfferings.map((offering) => {
    const exam = offering.exams[0] ?? {};
    const studentIds = getUniqueStudentIdsFromRegistrations(offering.registrations);
    const studentCount = studentIds.length;
    const expectedStudents = offering.expectedStudents ?? 0;

    return {
      id: exam.id ?? offering.id,
      persistedExamId: exam.id ?? null,
      courseOfferingId: offering.id,
      courseId: offering.courseId,
      courseCode: offering.course?.code ?? null,
      courseTitle: offering.course?.title ?? null,
      semesterId: offering.semesterId,
      section: offering.section,
      priority: offering.priority ?? 0,
      difficulty: offering.difficulty ?? 0,
      duration: exam.duration ?? DEFAULT_EXAM_DURATION,
      expectedStudents,
      studentCount,
      requiredSeats: Math.max(studentCount, expectedStudents, 1),
      studentIds,
      courseOffering: offering,
    };
  });

  return {
    exams,
    rooms: rooms.map((room) => ({
      id: room.id,
      name: room.name,
      capacity: room.capacity,
      status: room.status,
      centerId: room.centerId,
      center: room.center,
    })),
    supervisors: supervisors.map((supervisor) => ({
      id: supervisor.id,
      centerId: supervisor.centerId,
      center: supervisor.center,
      user: supervisor.user,
      maxExamsPerDay: supervisor.maxExamsPerDay ?? 2,
    })),
    timeSlots,
    existingAssignments,
    studentToExams: buildStudentExamMap(exams),
  };
};

const ensureExamRecords = async (courseOfferings) => {
  const missingOfferings = courseOfferings.filter((offering) => offering.exams.length === 0);

  if (missingOfferings.length > 0) {
    const createdExams = await prisma.$transaction(
      missingOfferings.map((offering) => prisma.exam.create({
        data: {
          courseOfferingId: offering.id,
          status: 'DRAFT',
          duration: DEFAULT_EXAM_DURATION,
        },
      })),
    );

    const examByOfferingId = new Map(createdExams.map((exam) => [exam.courseOfferingId, exam]));
    for (const offering of courseOfferings) {
      const created = examByOfferingId.get(offering.id);
      if (created) offering.exams = [created];
    }
  }

  return missingOfferings.length;
};

const fetchSchedulingData = async (semesterId, options = {}) => {
  const semester = await prisma.semester.findUnique({ where: { id: semesterId } });
  if (!semester) throw new AppError('Semester not found', 404);

  const [courseOfferings, rooms, supervisors, allTimeSlots, existingAssignments] = await Promise.all([
    prisma.courseOffering.findMany({
      where: { semesterId, status: 'ACTIVE' },
      include: {
        course: true,
        semester: true,
        registrations: { select: { id: true, studentId: true, status: true } },
        exams: true,
        _count: { select: { registrations: true } },
      },
      orderBy: [{ priority: 'desc' }, { course: { code: 'asc' } }, { section: 'asc' }],
    }),
    prisma.room.findMany({
      where: { status: 'AVAILABLE' },
      include: { center: true },
      orderBy: [{ capacity: 'asc' }, { name: 'asc' }],
    }),
    prisma.supervisor.findMany({
      include: {
        center: true,
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ center: { name: 'asc' } }, { user: { name: 'asc' } }],
    }),
    prisma.timeSlot.findMany({ orderBy: [{ startTime: 'asc' }, { endTime: 'asc' }] }),
    prisma.examAssignment.findMany({
      where: { exam: { courseOffering: { semesterId } } },
      include: {
        schedule: true,
        timeSlot: true,
        room: true,
        supervisor: true,
        exam: {
          include: {
            courseOffering: {
              include: {
                registrations: { select: { studentId: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  const createdExamCount = options.ensureExams ? await ensureExamRecords(courseOfferings) : 0;
  const timeSlots = getTimeslotsInSemesterRange(semester, allTimeSlots);
  const normalized = normalizeSchedulingData({ courseOfferings, rooms, supervisors, timeSlots, existingAssignments });

  return { semester, normalized, createdExamCount };
};

const createUsageTracker = (existingAssignments = []) => {
  const usage = {
    roomSlotUsed: new Set(),
    supervisorSlotUsed: new Set(),
    studentSlotMap: new Map(),
    supervisorDayCount: new Map(),
  };

  for (const assignment of existingAssignments) {
    if (!assignment.schedule?.isFinal) continue;

    usage.roomSlotUsed.add(`${assignment.roomId}:${assignment.timeSlotId}`);
    usage.supervisorSlotUsed.add(`${assignment.supervisorId}:${assignment.timeSlotId}`);

    const slotDate = assignment.timeSlot?.date ?? assignment.timeSlot?.startTime;
    if (slotDate) {
      const key = `${assignment.supervisorId}:${toDateKey(slotDate)}`;
      usage.supervisorDayCount.set(key, (usage.supervisorDayCount.get(key) ?? 0) + 1);
    }

    for (const studentId of getUniqueStudentIdsForExam(assignment.exam)) {
      addToNestedSet(usage.studentSlotMap, studentId, assignment.timeSlotId);
    }
  }

  return usage;
};

const reserveAssignment = (usage, assignment, exam, slot, slotDayKey = toDateKey(slot.date ?? slot.startTime)) => {
  usage.roomSlotUsed.add(`${assignment.roomId}:${assignment.timeSlotId}`);
  usage.supervisorSlotUsed.add(`${assignment.supervisorId}:${assignment.timeSlotId}`);

  const supervisorDayKey = `${assignment.supervisorId}:${slotDayKey}`;
  usage.supervisorDayCount.set(supervisorDayKey, (usage.supervisorDayCount.get(supervisorDayKey) ?? 0) + 1);

  for (const studentId of exam.studentIds) {
    addToNestedSet(usage.studentSlotMap, studentId, assignment.timeSlotId);
  }
};

const hasStudentOverlap = (usage, exam, slotId) => {
  return exam.studentIds.some((studentId) => usage.studentSlotMap.get(studentId)?.has(slotId));
};

const buildSlotDayKeyMap = (timeSlots) => {
  return new Map(timeSlots.map((slot) => [slot.id, toDateKey(slot.date ?? slot.startTime)]));
};

const sortRoomsByCapacityDesc = (rooms) => {
  return [...rooms].sort((a, b) => b.capacity - a.capacity || a.name.localeCompare(b.name));
};

const isRoomAvailableForSlot = (room, slot, usage) => {
  return room.status === 'AVAILABLE' && !usage.roomSlotUsed.has(`${room.id}:${slot.id}`);
};

const isSupervisorAvailableForSlot = (supervisor, slot, usage, slotDayKey = toDateKey(slot.date ?? slot.startTime)) => {
  if (usage.supervisorSlotUsed.has(`${supervisor.id}:${slot.id}`)) return false;

  const supervisorDayKey = `${supervisor.id}:${slotDayKey}`;
  return (usage.supervisorDayCount.get(supervisorDayKey) ?? 0) < supervisor.maxExamsPerDay;
};

const getAvailableRoomsForSlot = (sortedRooms, slot, usage) => {
  return sortedRooms.filter((room) => isRoomAvailableForSlot(room, slot, usage));
};

const getAvailableSupervisorsForSlot = (supervisors, slot, usage, slotDayKey) => {
  return supervisors.filter((supervisor) => isSupervisorAvailableForSlot(supervisor, slot, usage, slotDayKey));
};

const getTotalCapacity = (rooms) => rooms.reduce((total, room) => total + room.capacity, 0);

const isValidAssignment = ({ exam, slot, room, supervisor, usage, slotDayKey }) => {
  if (hasStudentOverlap(usage, exam, slot.id)) return false;
  if (!isRoomAvailableForSlot(room, slot, usage)) return false;
  if (room.capacity < exam.requiredSeats) return false;
  return isSupervisorAvailableForSlot(supervisor, slot, usage, slotDayKey);
};

const buildRoomAllocation = ({ exam, slot, sortedRooms, supervisors, usage, slotDayKey }) => {
  if (hasStudentOverlap(usage, exam, slot.id)) return null;

  const availableRooms = getAvailableRoomsForSlot(sortedRooms, slot, usage);
  const availableSupervisors = getAvailableSupervisorsForSlot(supervisors, slot, usage, slotDayKey);

  const singleRoom = availableRooms.find((room) => room.capacity >= exam.requiredSeats);
  if (singleRoom && availableSupervisors.length > 0) {
    const supervisor = availableSupervisors[0];
    if (isValidAssignment({ exam, slot, room: singleRoom, supervisor, usage, slotDayKey })) {
      return [{ room: singleRoom, supervisor }];
    }
  }

  const selectedRooms = [];
  let totalCapacity = 0;

  for (const room of availableRooms) {
    if (selectedRooms.length >= availableSupervisors.length) break;

    selectedRooms.push(room);
    totalCapacity += room.capacity;

    if (totalCapacity >= exam.requiredSeats) break;
  }

  if (totalCapacity < exam.requiredSeats) return null;

  return selectedRooms.map((room, index) => ({
    room,
    supervisor: availableSupervisors[index],
  }));
};

const isValidRoomAllocation = ({ exam, slot, allocation, usage, slotDayKey }) => {
  if (!allocation?.length) return false;
  if (hasStudentOverlap(usage, exam, slot.id)) return false;

  const roomIds = new Set();
  const supervisorIds = new Set();

  for (const { room, supervisor } of allocation) {
    if (!room || !supervisor) return false;
    if (roomIds.has(room.id) || supervisorIds.has(supervisor.id)) return false;
    if (!isRoomAvailableForSlot(room, slot, usage)) return false;
    if (!isSupervisorAvailableForSlot(supervisor, slot, usage, slotDayKey)) return false;

    roomIds.add(room.id);
    supervisorIds.add(supervisor.id);
  }

  return getTotalCapacity(allocation.map(({ room }) => room)) >= exam.requiredSeats;
};

const buildConflictPayload = (scheduleId, type, description) => ({ scheduleId, type, description });

const getExamLabel = (exam) => exam.courseCode ?? exam.courseTitle ?? exam.id;

const buildAssignmentFailureConflict = ({ scheduleId, exam, timeSlots, sortedRooms, supervisors, usage, slotDayKeys }) => {
  const examLabel = getExamLabel(exam);
  const totalRoomCapacity = getTotalCapacity(sortedRooms);

  if (timeSlots.length === 0) {
    return buildConflictPayload(
      scheduleId,
      'TIME_CONSTRAINT_VIOLATION',
      `No timeslots are available in the scheduling window for ${examLabel}.`,
    );
  }

  if (totalRoomCapacity < exam.requiredSeats) {
    return buildConflictPayload(
      scheduleId,
      'ROOM_OVERCAPACITY',
      `Insufficient total available room capacity for ${examLabel}: requires ${exam.requiredSeats} seats, available room capacity is ${totalRoomCapacity}.`,
    );
  }

  if (supervisors.length === 0) {
    return buildConflictPayload(
      scheduleId,
      'SUPERVISOR_DOUBLE_BOOKED',
      `No supervisors are available to invigilate ${examLabel}.`,
    );
  }

  const everySlotHasStudentOverlap = timeSlots.every((slot) => hasStudentOverlap(usage, exam, slot.id));
  if (everySlotHasStudentOverlap) {
    return buildConflictPayload(
      scheduleId,
      'STUDENT_OVERLAP',
      `Every available timeslot conflicts with at least one registered student for ${examLabel}.`,
    );
  }

  const everyNonOverlappingSlotHasNoSupervisor = timeSlots
    .filter((slot) => !hasStudentOverlap(usage, exam, slot.id))
    .every((slot) => getAvailableSupervisorsForSlot(supervisors, slot, usage, slotDayKeys.get(slot.id)).length === 0);

  if (everyNonOverlappingSlotHasNoSupervisor) {
    return buildConflictPayload(
      scheduleId,
      'SUPERVISOR_DOUBLE_BOOKED',
      `No supervisor is available without double-booking or exceeding daily limits for ${examLabel}.`,
    );
  }

  const canFitCapacityInAnySlot = timeSlots.some((slot) => {
    if (hasStudentOverlap(usage, exam, slot.id)) return false;

    const slotDayKey = slotDayKeys.get(slot.id);
    const availableRooms = getAvailableRoomsForSlot(sortedRooms, slot, usage);
    const availableSupervisors = getAvailableSupervisorsForSlot(supervisors, slot, usage, slotDayKey);
    const supervisedCapacity = getTotalCapacity(availableRooms.slice(0, availableSupervisors.length));

    return supervisedCapacity >= exam.requiredSeats;
  });

  if (!canFitCapacityInAnySlot) {
    return buildConflictPayload(
      scheduleId,
      'ROOM_OVERCAPACITY',
      `No timeslot has enough unused room capacity and supervisor coverage for ${examLabel}: requires ${exam.requiredSeats} seats.`,
    );
  }

  return buildConflictPayload(
    scheduleId,
    'RESOURCE_UNAVAILABLE',
    `No valid assignment found for ${examLabel} after checking timeslots, rooms, supervisors, student overlaps, room reuse, and supervisor daily limits.`,
  );
};

const generatedScheduleInclude = {
  assignments: {
    include: {
      exam: {
        include: {
          courseOffering: {
            include: {
              course: true,
              semester: true,
              registrations: { select: { id: true, studentId: true, status: true } },
            },
          },
        },
      },
      room: { include: { center: true } },
      supervisor: { include: { user: { select: { id: true, name: true, email: true } } } },
      timeSlot: true,
    },
  },
  conflicts: true,
  _count: { select: { assignments: true, conflicts: true } },
};

const runConstraintScheduling = ({ scheduleId, exams, rooms, supervisors, timeSlots, existingAssignments }) => {
  const usage = createUsageTracker(existingAssignments);
  const sortedRooms = sortRoomsByCapacityDesc(rooms);
  const slotDayKeys = buildSlotDayKeyMap(timeSlots);
  const assignmentInserts = [];
  const conflictInserts = [];
  const scheduledExamIds = [];

  const sortedExams = [...exams].sort(compareExamsForScheduling);

  for (const exam of sortedExams) {
    let assignments = null;

    for (const slot of timeSlots) {
      const slotDayKey = slotDayKeys.get(slot.id);
      const allocation = buildRoomAllocation({ exam, slot, sortedRooms, supervisors, usage, slotDayKey });
      if (!isValidRoomAllocation({ exam, slot, allocation, usage, slotDayKey })) continue;

      assignments = allocation.map(({ room, supervisor }) => ({
        scheduleId,
        examId: exam.id,
        roomId: room.id,
        supervisorId: supervisor.id,
        timeSlotId: slot.id,
      }));

      for (const assignment of assignments) {
        reserveAssignment(usage, assignment, exam, slot, slotDayKey);
      }
      break;
    }

    if (!assignments) {
      conflictInserts.push(buildAssignmentFailureConflict({
        scheduleId,
        exam,
        timeSlots,
        sortedRooms,
        supervisors,
        usage,
        slotDayKeys,
      }));
      continue;
    }

    assignmentInserts.push(...assignments);
    scheduledExamIds.push(exam.id);
  }

  return { assignmentInserts, conflictInserts, scheduledExamIds };
};

export const prepareScheduling = async (data) => {
  const { semester, normalized, createdExamCount } = await fetchSchedulingData(data.semesterId);

  const requestedStartDate = new Date(data.startDate);
  const requestedEndDate = new Date(data.endDate);

  if (Number.isNaN(requestedStartDate.getTime()) || Number.isNaN(requestedEndDate.getTime())) {
    throw new AppError('Invalid startDate or endDate', 400);
  }

  if (requestedStartDate >= requestedEndDate) {
    throw new AppError('startDate must be before endDate', 400);
  }

  if (requestedStartDate < semester.startDate || requestedEndDate > semester.endDate) {
    throw new AppError('Requested scheduling window must be inside semester range', 400);
  }

  const filteredTimeSlots = normalized.timeSlots.filter(
    (slot) => slot.startTime >= requestedStartDate && slot.endTime <= requestedEndDate,
  );

  return {
    semester: {
      id: semester.id,
      name: semester.name,
      startDate: semester.startDate,
      endDate: semester.endDate,
    },
    requestedWindow: {
      startDate: requestedStartDate,
      endDate: requestedEndDate,
    },
    resources: {
      courseOfferings: normalized.exams.length,
      exams: normalized.exams.length,
      rooms: normalized.rooms.length,
      supervisors: normalized.supervisors.length,
      timeSlotsInWindow: filteredTimeSlots.length,
      existingAssignments: normalized.existingAssignments.length,
      studentsWithExams: normalized.studentToExams.size,
      createdExamRecords: createdExamCount,
    },
    message: `Scheduling preparation complete for ${semester.name}`,
  };
};

const fmtDate = (d) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export const validateInput = async (data) => {
  const { normalized, semester } = await fetchSchedulingData(data.semesterId);

  // ── Group buckets ────────────────────────────────────────────────
  const g = {
    rooms: [],
    supervisors: [],
    timeSlots: [],
    courseOfferings: [],
    studentOverlapRisks: [],
  };

  // ── Rooms ───────────────────────────────────────────────────────
  if (normalized.rooms.length === 0) {
    g.rooms.push('No rooms are marked as Available. Mark at least one room as Available before generating.');
  }

  // ── Supervisors ─────────────────────────────────────────────────
  if (normalized.supervisors.length === 0) {
    g.supervisors.push('No supervisors are registered. Add at least one supervisor before generating.');
  }

  // ── Time slots ──────────────────────────────────────────────────
  if (normalized.timeSlots.length === 0) {
    const semRange = `${fmtDate(semester.startDate)} – ${fmtDate(semester.endDate)}`;
    g.timeSlots.push(
      `No time slots fall within the "${semester.name}" period (${semRange}). Create time slots with dates inside this range.`,
    );
  }
  for (const slot of normalized.timeSlots) {
    if (slot.endTime <= slot.startTime) {
      g.timeSlots.push('One or more time slots have an end time before their start time. Fix the time slot dates.');
    }
    break; // deduplicate: one message is enough
  }

  // ── Course offerings ─────────────────────────────────────────────
  if (normalized.exams.length === 0) {
    g.courseOfferings.push(`No active course offerings found for "${semester.name}". Activate or add offerings for this semester.`);
  }

  const emptyOfferings = normalized.exams.filter((e) => e.studentCount === 0);
  for (const exam of emptyOfferings) {
    const label = [exam.courseCode, exam.courseTitle].filter(Boolean).join(' — ') || 'an offering';
    g.courseOfferings.push(
      `"${label}" has no enrolled students and will be skipped. Enroll students before generating.`,
    );
  }

  const supervisedRooms = sortRoomsByCapacityDesc(normalized.rooms).slice(0, normalized.supervisors.length);
  const supervisedCapacity = getTotalCapacity(supervisedRooms);

  if (normalized.supervisors.length > 0 && normalized.rooms.length > 0 && supervisedCapacity === 0) {
    g.rooms.push('All available rooms report zero capacity. Update room capacities so supervisors can be assigned.');
  }

  for (const exam of normalized.exams) {
    if (supervisedCapacity < exam.requiredSeats) {
      const courseLabel = [exam.courseCode, exam.courseTitle].filter(Boolean).join(' — ') || 'an offering';
      g.courseOfferings.push(
        `"${courseLabel}" requires ${exam.requiredSeats} seats but maximum supervised capacity is ${supervisedCapacity}. Add larger rooms or more supervisors.`,
      );
    }
  }

  // ── Student overlap risks ────────────────────────────────────────
  const allStudentIds = [...normalized.studentToExams.keys()];
  const studentUserMap = new Map();
  if (allStudentIds.length > 0) {
    const students = await prisma.student.findMany({
      where: { id: { in: allStudentIds } },
      select: { id: true, user: { select: { name: true, email: true } } },
    });
    for (const s of students) studentUserMap.set(s.id, s.user);
  }

  for (const [studentId, examIds] of normalized.studentToExams.entries()) {
    if (examIds.size > normalized.timeSlots.length && normalized.timeSlots.length > 0) {
      const user = studentUserMap.get(studentId);
      const studentLabel = user?.name
        ? user.email ? `${user.name} (${user.email})` : user.name
        : `a student`;
      const semesterName = semester.name;
      g.studentOverlapRisks.push(
        `${studentLabel} has ${examIds.size} exams but only ${normalized.timeSlots.length} time slots in "${semesterName}" — exam overlap is unavoidable.`,
      );
    }
  }

  // ── Flatten for backward compat ──────────────────────────────────
  const allIssues = [
    ...g.rooms,
    ...g.supervisors,
    ...g.timeSlots,
    ...g.courseOfferings,
    ...g.studentOverlapRisks,
  ];

  return {
    ready: allIssues.length === 0,
    semester: { name: semester.name },
    metrics: {
      roomsCount: normalized.rooms.length,
      supervisorsCount: normalized.supervisors.length,
      examsCount: normalized.exams.length,
      timeSlotsCount: normalized.timeSlots.length,
      studentsWithExamsCount: normalized.studentToExams.size,
      existingAssignmentsCount: normalized.existingAssignments.length,
    },
    groups: {
      rooms: { ok: g.rooms.length === 0, issues: g.rooms },
      supervisors: { ok: g.supervisors.length === 0, issues: g.supervisors },
      timeSlots: { ok: g.timeSlots.length === 0, issues: g.timeSlots },
      courseOfferings: { ok: g.courseOfferings.length === 0, issues: g.courseOfferings },
      studentOverlapRisks: { ok: g.studentOverlapRisks.length === 0, issues: g.studentOverlapRisks },
    },
    // flat list kept for backward compat
    issues: allIssues,
  };
};

export const generateSchedule = async (data) => {
  const { semesterId, scheduleName } = data;
  const { normalized, createdExamCount } = await fetchSchedulingData(semesterId, { ensureExams: true });

  if (
    normalized.rooms.length === 0
    || normalized.supervisors.length === 0
    || normalized.timeSlots.length === 0
    || normalized.exams.length === 0
  ) {
    throw new AppError('Insufficient scheduling resources. Run validate-input first.', 400);
  }

  const result = await prisma.$transaction(async (tx) => {
    const schedule = await tx.schedule.create({
      data: { name: scheduleName, isFinal: false },
    });

    const { assignmentInserts, conflictInserts, scheduledExamIds } = runConstraintScheduling({
      scheduleId: schedule.id,
      exams: normalized.exams,
      rooms: normalized.rooms,
      supervisors: normalized.supervisors,
      timeSlots: normalized.timeSlots,
      existingAssignments: normalized.existingAssignments,
    });

    if (assignmentInserts.length > 0) {
      await tx.examAssignment.createMany({ data: assignmentInserts });
    }

    if (conflictInserts.length > 0) {
      await tx.conflict.createMany({ data: conflictInserts });
    }

    if (scheduledExamIds.length > 0) {
      await tx.exam.updateMany({
        where: { id: { in: scheduledExamIds } },
        data: { status: 'SCHEDULED' },
      });
    }

    const fullSchedule = await tx.schedule.findUnique({
      where: { id: schedule.id },
      include: generatedScheduleInclude,
    });

    if (!fullSchedule) throw new AppError('Generated schedule could not be loaded', 500);

    return { fullSchedule, assignmentInserts, conflictInserts, scheduledExamIds };
  });

  const { fullSchedule, assignmentInserts, conflictInserts, scheduledExamIds } = result;
  const summary = {
    totalExams: normalized.exams.length,
    assignedExams: scheduledExamIds.length,
    unassignedExams: conflictInserts.length,
    assignmentRows: assignmentInserts.length,
    conflicts: conflictInserts.length,
    createdExamRecords: createdExamCount,
    existingAssignments: normalized.existingAssignments.length,
    lockedFinalAssignments: normalized.existingAssignments.filter((assignment) => assignment.schedule?.isFinal).length,
    studentsWithExams: normalized.studentToExams.size,
  };

  return {
    scheduleId: fullSchedule.id,
    scheduleName,
    schedule: fullSchedule,
    summary,
    assignedExams: summary.assignedExams,
    unassignedExams: summary.unassignedExams,
    totalExams: summary.totalExams,
    diagnostics: summary,
    message: `Schedule generated with ${summary.assignedExams}/${summary.totalExams} exams assigned.`,
  };
};

export const getScheduleAnalysis = async (scheduleId) => {
  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    include: {
      conflicts: true,
      assignments: {
        include: {
          exam: {
            include: {
              courseOffering: {
                include: {
                  course: true,
                  semester: true,
                  registrations: { select: { studentId: true } },
                },
              },
            },
          },
          room: true,
          supervisor: { include: { user: { select: { id: true, name: true, email: true } } } },
          timeSlot: true,
        },
      },
    },
  });

  if (!schedule) throw new AppError('Schedule not found', 404);

  const studentSlotSeen = new Map();
  const roomCapacityViolations = [];
  const roomReuseViolations = [];
  const supervisorCollisions = [];
  const studentOverlaps = [];
  const roomSlotCount = new Map();
  const supervisorSlotCount = new Map();
  const supervisorDayCount = new Map();
  const supervisorDailyLoadViolations = [];
  const examSlotCapacity = new Map();

  for (const assignment of schedule.assignments) {
    const examSlotKey = `${assignment.examId}:${assignment.timeSlotId}`;
    const capacityGroup = examSlotCapacity.get(examSlotKey) ?? {
      examId: assignment.examId,
      timeSlotId: assignment.timeSlotId,
      assignmentIds: [],
      requiredSeats: getRequiredSeatsForExam(assignment.exam),
      totalCapacity: 0,
    };
    capacityGroup.assignmentIds.push(assignment.id);
    capacityGroup.totalCapacity += assignment.room.capacity;
    examSlotCapacity.set(examSlotKey, capacityGroup);

    const roomSlotKey = `${assignment.roomId}:${assignment.timeSlotId}`;
    roomSlotCount.set(roomSlotKey, (roomSlotCount.get(roomSlotKey) ?? 0) + 1);

    const supervisorSlotKey = `${assignment.supervisorId}:${assignment.timeSlotId}`;
    supervisorSlotCount.set(supervisorSlotKey, (supervisorSlotCount.get(supervisorSlotKey) ?? 0) + 1);

    const supervisorDayKey = `${assignment.supervisorId}:${toDateKey(assignment.timeSlot.date ?? assignment.timeSlot.startTime)}`;
    supervisorDayCount.set(supervisorDayKey, (supervisorDayCount.get(supervisorDayKey) ?? 0) + 1);

    const studentIds = getUniqueStudentIdsForExam(assignment.exam);
    for (const studentId of studentIds) {
      const key = `${studentId}:${assignment.timeSlotId}`;
      const seen = studentSlotSeen.get(key);
      if (seen && seen.examId !== assignment.examId) {
        studentOverlaps.push({
          studentId,
          timeSlotId: assignment.timeSlotId,
          assignmentIds: [seen.assignmentId, assignment.id],
        });
      } else if (!seen) {
        studentSlotSeen.set(key, { assignmentId: assignment.id, examId: assignment.examId });
      }
    }
  }

  for (const [key, count] of roomSlotCount.entries()) {
    if (count > 1) {
      const [roomId, timeSlotId] = key.split(':');
      roomReuseViolations.push({ roomId, timeSlotId, count });
    }
  }

  for (const group of examSlotCapacity.values()) {
    if (group.totalCapacity < group.requiredSeats) {
      roomCapacityViolations.push(group);
    }
  }

  for (const [key, count] of supervisorSlotCount.entries()) {
    if (count > 1) {
      const [supervisorId, timeSlotId] = key.split(':');
      supervisorCollisions.push({ supervisorId, timeSlotId, count });
    }
  }

  for (const [key, count] of supervisorDayCount.entries()) {
    const [supervisorId, date] = key.split(':');
    const supervisor = schedule.assignments.find((assignment) => assignment.supervisorId === supervisorId)?.supervisor;
    const maxExamsPerDay = supervisor?.maxExamsPerDay ?? 2;
    if (count > maxExamsPerDay) {
      supervisorDailyLoadViolations.push({ supervisorId, date, count, maxExamsPerDay });
    }
  }

  const derivedConflicts = {
    studentOverlaps,
    roomReuseViolations,
    supervisorConflicts: supervisorCollisions,
    supervisorDailyLoadViolations,
    roomCapacityViolations,
  };

  const derivedConflictCount =
    studentOverlaps.length
    + roomReuseViolations.length
    + supervisorCollisions.length
    + supervisorDailyLoadViolations.length
    + roomCapacityViolations.length;

  const totalConflicts = schedule.conflicts.length + derivedConflictCount;

  const utilization =
    examSlotCapacity.size === 0
      ? 0
      : [...examSlotCapacity.values()].reduce((acc, group) => {
          return acc + group.requiredSeats / group.totalCapacity;
        }, 0) / examSlotCapacity.size;

  return {
    scheduleId: schedule.id,
    isFinal: schedule.isFinal,
    metrics: {
      totalAssignments: schedule.assignments.length,
      persistedConflicts: schedule.conflicts.length,
      derivedConflicts: derivedConflictCount,
      totalConflicts,
      averageRoomUtilization: Number(utilization.toFixed(3)),
    },
    conflicts: {
      persisted: schedule.conflicts,
      derived: derivedConflicts,
    },
  };
};

export const publishSchedule = async (scheduleId) => {
  const existing = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    include: { conflicts: true },
  });

  if (!existing) throw new AppError('Schedule not found', 404);

  if (existing.conflicts.some((conflict) => !conflict.resolved)) {
    throw new AppError('Cannot publish schedule with unresolved conflicts', 400);
  }

  const analysis = await getScheduleAnalysis(scheduleId);
  if (analysis.metrics.totalConflicts > 0) {
    throw new AppError('Cannot publish schedule while derived conflicts still exist', 400);
  }

  const schedule = await prisma.schedule.update({
    where: { id: scheduleId },
    data: { isFinal: true },
  });

  return { message: 'Schedule published successfully', schedule };
};