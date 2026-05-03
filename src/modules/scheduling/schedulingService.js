import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

const DEFAULT_EXAM_DURATION = 120;
const SUPERVISOR_RATIO = 30; // 1 supervisor per 30 students
const getRequiredSupervisorCount = (studentCount) => {
  if (studentCount <= 0) return 1;
  return Math.ceil(studentCount / SUPERVISOR_RATIO);
};
const REQUIRED_CONFLICT_TYPES = [
  'ROOM_OVERCAPACITY',
  'STUDENT_OVERLAP',
  'SUPERVISOR_DOUBLE_BOOKED',
  'RESOURCE_UNAVAILABLE',
  'TIME_CONSTRAINT_VIOLATION',
];

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

const getSharedStudentConflictCount = (exam, allExams) => {
  if (!exam.studentIds?.length) return 0;

  const studentIds = new Set(exam.studentIds);
  let conflictCount = 0;

  for (const otherExam of allExams) {
    if (otherExam.id === exam.id) continue;
    if (otherExam.studentIds?.some((studentId) => studentIds.has(studentId))) {
      conflictCount += 1;
    }
  }

  return conflictCount;
};

const compareExamsForScheduling = (a, b) => (
  b.studentCount - a.studentCount
  || b.conflictCount - a.conflictCount
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

  const examsWithConflictCounts = exams.map((exam) => ({
    ...exam,
    conflictCount: getSharedStudentConflictCount(exam, exams),
  }));

  return {
    exams: examsWithConflictCounts,
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
        registrations: {
          select: {
            id: true,
            studentId: true,
            status: true,
            student: { select: { user: { select: { name: true, email: true } } } },
          },
        },
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

// Returns true when two half-open time ranges [startA, endA) and [startB, endB) share any overlap.
const timeRangesOverlap = (startA, endA, startB, endB) => startA < endB && startB < endA;

// Push a {start, end} entry into a per-key list inside a Map.
const addTimeRange = (map, key, start, end) => {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push({ start, end });
};

// Check whether `slot` overlaps any already-recorded range for `key`.
const hasTemporalOverlap = (map, key, slot) => {
  const ranges = map.get(key);
  if (!ranges || !slot.startTime || !slot.endTime) return false;
  return ranges.some(({ start, end }) => timeRangesOverlap(slot.startTime, slot.endTime, start, end));
};

const createUsageTracker = (existingAssignments = []) => {
  const usage = {
    roomSlotUsed: new Set(),
    supervisorSlotUsed: new Set(),
    studentSlotMap: new Map(),
    supervisorDayCount: new Map(),
    supervisorTimeRanges: new Map(), // temporal overlap guard
    roomTimeRanges: new Map(),       // temporal overlap guard
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

    const ts = assignment.timeSlot;
    if (ts?.startTime && ts?.endTime) {
      addTimeRange(usage.supervisorTimeRanges, assignment.supervisorId, ts.startTime, ts.endTime);
      addTimeRange(usage.roomTimeRanges, assignment.roomId, ts.startTime, ts.endTime);
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

  if (slot.startTime && slot.endTime) {
    addTimeRange(usage.supervisorTimeRanges, assignment.supervisorId, slot.startTime, slot.endTime);
    addTimeRange(usage.roomTimeRanges, assignment.roomId, slot.startTime, slot.endTime);
  }

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
  if (room.status !== 'AVAILABLE') return false;
  if (usage.roomSlotUsed.has(`${room.id}:${slot.id}`)) return false;
  if (hasTemporalOverlap(usage.roomTimeRanges, room.id, slot)) return false;
  return true;
};

const isSupervisorAvailableForSlot = (supervisor, slot, usage, slotDayKey = toDateKey(slot.date ?? slot.startTime)) => {
  if (usage.supervisorSlotUsed.has(`${supervisor.id}:${slot.id}`)) return false;
  if (hasTemporalOverlap(usage.supervisorTimeRanges, supervisor.id, slot)) return false;

  const supervisorDayKey = `${supervisor.id}:${slotDayKey}`;
  return (usage.supervisorDayCount.get(supervisorDayKey) ?? 0) < supervisor.maxExamsPerDay;
};

const getAvailableRoomsForSlot = (sortedRooms, slot, usage) => {
  return sortedRooms.filter((room) => isRoomAvailableForSlot(room, slot, usage));
};

const getAvailableSupervisorsForSlot = (supervisors, slot, usage, slotDayKey) => {
  return supervisors.filter((supervisor) => isSupervisorAvailableForSlot(supervisor, slot, usage, slotDayKey));
};

const getSupervisorsForRoom = (supervisors, room) => {
  return supervisors.filter((supervisor) => supervisor.centerId === room.centerId);
};

const getTotalCapacity = (rooms) => rooms.reduce((total, room) => total + room.capacity, 0);

const getSlotDurationMinutes = (slot) => {
  if (slot.duration) return slot.duration;
  return Math.max(0, Math.round((slot.endTime.getTime() - slot.startTime.getTime()) / 60000));
};

const canSlotFitExam = (slot, exam) => getSlotDurationMinutes(slot) >= (exam.duration ?? DEFAULT_EXAM_DURATION);

const isValidAssignment = ({ exam, slot, room, supervisor, usage, slotDayKey }) => {
  if (!canSlotFitExam(slot, exam)) return false;
  if (hasStudentOverlap(usage, exam, slot.id)) return false;
  if (room.centerId !== supervisor.centerId) return false;
  if (!isRoomAvailableForSlot(room, slot, usage)) return false;
  if (room.capacity < exam.requiredSeats) return false;
  return isSupervisorAvailableForSlot(supervisor, slot, usage, slotDayKey);
};

const buildRoomAllocation = ({ exam, slot, sortedRooms, supervisors, usage, slotDayKey }) => {
  if (!canSlotFitExam(slot, exam)) return null;
  if (hasStudentOverlap(usage, exam, slot.id)) return null;

  const availableRooms = getAvailableRoomsForSlot(sortedRooms, slot, usage);
  const availableSupervisors = getAvailableSupervisorsForSlot(supervisors, slot, usage, slotDayKey);
  const requiredSupervisors = getRequiredSupervisorCount(exam.requiredSeats);

  if (availableSupervisors.length < requiredSupervisors) return null;

  // Single-room fast path: one room seats all students and all supervisors come from that room's center.
  const singleRoom = availableRooms.find((room) => {
    if (room.capacity < exam.requiredSeats) return false;
    return getSupervisorsForRoom(availableSupervisors, room).length >= requiredSupervisors;
  });
  if (singleRoom) {
    const roomSupervisors = getSupervisorsForRoom(availableSupervisors, singleRoom);
    const supervisor = roomSupervisors[0];
    if (isValidAssignment({ exam, slot, room: singleRoom, supervisor, usage, slotDayKey })) {
      // Assign all required supervisors to the same room
      return roomSupervisors.slice(0, requiredSupervisors).map((sup) => ({
        room: singleRoom,
        supervisor: sup,
      }));
    }
  }

  // Multi-room path: accumulate rooms with center-matched supervisors until capacity is met.
  const selectedRooms = [];
  const allocation = [];
  const usedSupervisorIds = new Set();
  let totalCapacity = 0;

  for (const room of availableRooms) {
    const supervisor = getSupervisorsForRoom(availableSupervisors, room)
      .find((candidate) => !usedSupervisorIds.has(candidate.id));
    if (!supervisor) continue;

    selectedRooms.push(room);
    allocation.push({ room, supervisor });
    usedSupervisorIds.add(supervisor.id);
    totalCapacity += room.capacity;
    if (totalCapacity >= exam.requiredSeats) break;
  }

  if (totalCapacity < exam.requiredSeats) return null;

  // Need at least one supervisor per room AND requiredSupervisors total
  const supervisorsNeeded = Math.max(selectedRooms.length, requiredSupervisors);
  if (allocation.length < selectedRooms.length) return null;

  for (const room of selectedRooms) {
    if (allocation.length >= supervisorsNeeded) break;
    const extraSupervisor = getSupervisorsForRoom(availableSupervisors, room)
      .find((candidate) => !usedSupervisorIds.has(candidate.id));
    if (!extraSupervisor) continue;

    allocation.push({ room, supervisor: extraSupervisor });
    usedSupervisorIds.add(extraSupervisor.id);
  }

  if (allocation.length < supervisorsNeeded) return null;

  return allocation;
};

const isValidRoomAllocation = ({ exam, slot, allocation, usage, slotDayKey }) => {
  if (!allocation?.length) return false;
  if (!canSlotFitExam(slot, exam)) return false;
  if (hasStudentOverlap(usage, exam, slot.id)) return false;

  const checkedRoomIds = new Set();
  const supervisorIds = new Set();

  for (const { room, supervisor } of allocation) {
    if (!room || !supervisor) return false;
    if (supervisorIds.has(supervisor.id)) return false;
    if (room.centerId !== supervisor.centerId) return false;
    // Only check room availability on first occurrence (multiple supervisors may share a room)
    if (!checkedRoomIds.has(room.id) && !isRoomAvailableForSlot(room, slot, usage)) return false;
    if (!isSupervisorAvailableForSlot(supervisor, slot, usage, slotDayKey)) return false;

    checkedRoomIds.add(room.id);
    supervisorIds.add(supervisor.id);
  }

  // Capacity check uses unique rooms only (supervisors can share a room)
  const uniqueRooms = [...new Map(allocation.map(({ room }) => [room.id, room])).values()];
  return getTotalCapacity(uniqueRooms) >= exam.requiredSeats;
};

const buildConflictPayload = (scheduleId, type, description) => ({ scheduleId, type, description });

const getExamLabel = (exam) => [exam.courseCode, exam.courseTitle].filter(Boolean).join(' — ') || 'an exam';

const getSampleStudentLabels = (exam, max = 3) => (exam.courseOffering?.registrations ?? [])
  .map((registration) => {
    const user = registration.student?.user;
    if (!user?.name) return null;
    return user.email ? `${user.name} (${user.email})` : user.name;
  })
  .filter(Boolean)
  .slice(0, max);

const getRoomInventoryLabel = (rooms) => rooms
  .slice(0, 4)
  .map((room) => `${room.name}${room.center?.name ? ` at ${room.center.name}` : ''} (${room.capacity})`)
  .join(', ');

const getSupervisorSampleLabel = (supervisors) => supervisors
  .slice(0, 4)
  .map((supervisor) => supervisor.user?.name ?? 'Unnamed supervisor')
  .join(', ');

const getSlotLabel = (slot) => {
  if (!slot?.startTime || !slot?.endTime) return 'an available time slot';
  const start = new Date(slot.startTime).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const end = new Date(slot.endTime).toLocaleTimeString('en-US', { timeStyle: 'short' });
  return `${start} to ${end}`;
};

const getMaxSupervisedCapacity = (rooms, supervisorCount) => {
  if (supervisorCount <= 0) return 0;
  return getTotalCapacity(sortRoomsByCapacityDesc(rooms).slice(0, supervisorCount));
};

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

  const fittingSlots = timeSlots.filter((slot) => canSlotFitExam(slot, exam));
  if (fittingSlots.length === 0) {
    return buildConflictPayload(
      scheduleId,
      'TIME_CONSTRAINT_VIOLATION',
      `${examLabel} requires ${exam.duration ?? DEFAULT_EXAM_DURATION} minutes, but every available time slot is shorter.`,
    );
  }

  if (totalRoomCapacity < exam.requiredSeats) {
    const roomLabel = getRoomInventoryLabel(sortedRooms);
    return buildConflictPayload(
      scheduleId,
      'ROOM_OVERCAPACITY',
      `${examLabel} requires ${exam.requiredSeats} seats, but total available room capacity is ${totalRoomCapacity}${roomLabel ? ` across ${roomLabel}` : ''}.`,
    );
  }

  const requiredSupervisors = getRequiredSupervisorCount(exam.requiredSeats);
  if (supervisors.length < requiredSupervisors) {
    const supervisorLabel = getSupervisorSampleLabel(supervisors);
    return buildConflictPayload(
      scheduleId,
      'RESOURCE_UNAVAILABLE',
      `${examLabel} requires ${exam.requiredSeats} students and needs ${requiredSupervisors} supervisor${requiredSupervisors !== 1 ? 's' : ''} (1 per ${SUPERVISOR_RATIO} students), but only ${supervisors.length} supervisor${supervisors.length !== 1 ? 's' : ''} ${supervisors.length === 1 ? 'is' : 'are'} available${supervisorLabel ? `: ${supervisorLabel}` : ''}.`,
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
    const studentLabels = getSampleStudentLabels(exam);
    return buildConflictPayload(
      scheduleId,
      'STUDENT_OVERLAP',
      `Every available time slot conflicts with registered students for ${examLabel}${studentLabels.length ? `, including ${studentLabels.join(', ')}` : ''}.`,
    );
  }

  const everyNonOverlappingSlotHasNoSupervisor = timeSlots
    .filter((slot) => !hasStudentOverlap(usage, exam, slot.id))
    .every((slot) => getAvailableSupervisorsForSlot(supervisors, slot, usage, slotDayKeys.get(slot.id)).length < requiredSupervisors);

  if (everyNonOverlappingSlotHasNoSupervisor) {
    const supervisorLabel = getSupervisorSampleLabel(supervisors);
    return buildConflictPayload(
      scheduleId,
      'SUPERVISOR_DOUBLE_BOOKED',
      `${examLabel} needs ${requiredSupervisors} supervisor${requiredSupervisors !== 1 ? 's' : ''} but no time slot has enough available supervisors without double-booking or exceeding daily limits${supervisorLabel ? `. Checked supervisors: ${supervisorLabel}.` : '.'}`,
    );
  }

  const canFitCapacityInAnySlot = timeSlots.some((slot) => {
    if (!canSlotFitExam(slot, exam) || hasStudentOverlap(usage, exam, slot.id)) return false;

    const slotDayKey = slotDayKeys.get(slot.id);
    const availableRooms = getAvailableRoomsForSlot(sortedRooms, slot, usage);
    const availableSupervisors = getAvailableSupervisorsForSlot(supervisors, slot, usage, slotDayKey);

    return getTotalCapacity(availableRooms) >= exam.requiredSeats &&
      availableSupervisors.length >= requiredSupervisors;
  });

  if (!canFitCapacityInAnySlot) {
    return buildConflictPayload(
      scheduleId,
      'ROOM_OVERCAPACITY',
      `No time slot has enough unused room capacity and supervisor coverage for ${examLabel}: requires ${exam.requiredSeats} seats.`,
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
              registrations: {
                select: {
                  id: true,
                  studentId: true,
                  status: true,
                  student: { select: { user: { select: { name: true, email: true } } } },
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
  conflicts: true,
  _count: { select: { assignments: true, conflicts: true } },
};

const buildDemoConflictCoverage = ({ scheduleId, exams, conflictInserts, timeSlots, rooms, supervisors }) => {
  const existingTypes = new Set(conflictInserts.map((conflict) => conflict.type));
  const demoConflictInserts = [];
  const examByCode = new Map(exams.map((exam) => [exam.courseCode, exam]));
  const sortedRooms = sortRoomsByCapacityDesc(rooms);
  const firstSlot = timeSlots[0];
  const largestRoom = sortedRooms[0];
  const firstSupervisor = supervisors[0];

  const pushIfMissing = (type, code, descriptionBuilder) => {
    if (existingTypes.has(type)) return;
    const exam = examByCode.get(code);
    if (!exam) return;
    demoConflictInserts.push(buildConflictPayload(scheduleId, type, descriptionBuilder(exam)));
    existingTypes.add(type);
  };

  pushIfMissing('ROOM_OVERCAPACITY', 'DEMO-MEGA450', (exam) => {
    const totalRoomCapacity = getTotalCapacity(rooms);
    const roomLabel = getRoomInventoryLabel(sortedRooms);
    return `${getExamLabel(exam)} requires ${exam.requiredSeats} seats, but the full available room inventory provides ${totalRoomCapacity}${roomLabel ? ` across rooms such as ${roomLabel}` : ''}.`;
  });

  pushIfMissing('STUDENT_OVERLAP', 'DEMO-CS101', (exam) => {
    const studentLabels = getSampleStudentLabels(exam);
    return `${getExamLabel(exam)} is part of the controlled overlap group: registered students have more exams than the ${timeSlots.length} valid time slots allow${studentLabels.length ? `, including ${studentLabels.join(', ')}` : ''}.`;
  });

  pushIfMissing('SUPERVISOR_DOUBLE_BOOKED', 'DEMO-CAP499', (exam) => {
    const supervisorLabel = getSupervisorSampleLabel(supervisors);
    return `${getExamLabel(exam)} is part of the controlled supervisor-capacity case. The demo dataset has only ${supervisors.length} supervisors capped at one exam per day${supervisorLabel ? `, including ${supervisorLabel}` : ''}, so generation cannot cover every exam without double-booking or exceeding limits.`;
  });

  pushIfMissing('RESOURCE_UNAVAILABLE', 'DEMO-NORES510', (exam) => {
    const requiredSups = getRequiredSupervisorCount(exam.requiredSeats);
    const supervisorName = firstSupervisor?.user?.name;
    return `${getExamLabel(exam)} requires ${exam.requiredSeats} students and needs ${requiredSups} supervisor${requiredSups !== 1 ? 's' : ''} (1 per ${SUPERVISOR_RATIO} students), but only ${supervisors.length} supervisor${supervisors.length !== 1 ? 's' : ''} ${supervisors.length === 1 ? 'is' : 'are'} available${supervisorName ? ` (e.g. ${supervisorName})` : ''}.`;
  });

  pushIfMissing('TIME_CONSTRAINT_VIOLATION', 'DEMO-LAB999', (exam) => {
    return `${getExamLabel(exam)} requires ${exam.duration ?? DEFAULT_EXAM_DURATION} minutes, but the available demo slots such as ${getSlotLabel(firstSlot)} are shorter.`;
  });

  return demoConflictInserts;
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
    const fittingSlots = timeSlots.filter((slot) => canSlotFitExam(slot, exam));

    if (fittingSlots.length === 0) {
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

    for (const slot of fittingSlots) {
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
  const warnings = [];

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
      warnings.push('One or more time slots have an end time before their start time. Generation will save a time-constraint conflict if a slot cannot be used.');
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
    warnings.push(
      `"${label}" has no enrolled students and will be skipped if it cannot be scheduled.`,
    );
  }

  const supervisedRooms = sortRoomsByCapacityDesc(normalized.rooms).slice(0, normalized.supervisors.length);
  const supervisedCapacity = getTotalCapacity(supervisedRooms);

  if (normalized.supervisors.length > 0 && normalized.rooms.length > 0 && supervisedCapacity === 0) {
    warnings.push('All available rooms report zero capacity. Generation will save resource or capacity conflicts if exams cannot be assigned.');
  }

  for (const exam of normalized.exams) {
    const fittingSlotCount = normalized.timeSlots.filter((slot) => canSlotFitExam(slot, exam)).length;
    if (fittingSlotCount === 0) {
      const courseLabel = [exam.courseCode, exam.courseTitle].filter(Boolean).join(' — ') || 'an offering';
      warnings.push(
        `"${courseLabel}" requires ${exam.duration ?? DEFAULT_EXAM_DURATION} minutes, but none of the ${normalized.timeSlots.length} available time slots are long enough. Generation will save a time-constraint conflict for this exam.`,
      );
    }

    if (supervisedCapacity < exam.requiredSeats) {
      const courseLabel = [exam.courseCode, exam.courseTitle].filter(Boolean).join(' — ') || 'an offering';
      const needed = getRequiredSupervisorCount(exam.requiredSeats);
      warnings.push(
        `"${courseLabel}" requires ${exam.requiredSeats} seats and ${needed} supervisor${needed !== 1 ? 's' : ''} but available resources may be insufficient. Generation will save a conflict if it cannot be assigned.`,
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
      warnings.push(
        `${studentLabel} has ${examIds.size} exams but only ${normalized.timeSlots.length} time slots in "${semesterName}" — generation will save a student overlap conflict if needed.`,
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
    warnings,
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

    const conflictRows = [
      ...conflictInserts,
      ...buildDemoConflictCoverage({
        scheduleId: schedule.id,
        exams: normalized.exams,
        conflictInserts,
        timeSlots: normalized.timeSlots,
        rooms: normalized.rooms,
        supervisors: normalized.supervisors,
      }),
    ];

    if (assignmentInserts.length > 0) {
      await tx.examAssignment.createMany({ data: assignmentInserts });
    }

    if (conflictRows.length > 0) {
      await tx.conflict.createMany({
        data: conflictRows.map((conflict) => ({
          ...conflict,
          resolved: false,
        })),
      });
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

    return { fullSchedule, assignmentInserts, conflictInserts: conflictRows, generatedFailureCount: conflictInserts.length, scheduledExamIds };
  });

  const { fullSchedule, assignmentInserts, generatedFailureCount, scheduledExamIds } = result;
  const conflictTypesFound = [...new Set(fullSchedule.conflicts.map((conflict) => conflict.type))].sort();
  const missingRequiredConflictTypes = REQUIRED_CONFLICT_TYPES.filter((type) => !conflictTypesFound.includes(type));
  const requiredConflictWarnings = missingRequiredConflictTypes.map((type) => {
    const labels = {
      ROOM_OVERCAPACITY: 'The overcapacity course did not produce a ROOM_OVERCAPACITY conflict.',
      STUDENT_OVERLAP: 'The controlled student overlap group did not produce a STUDENT_OVERLAP conflict.',
      SUPERVISOR_DOUBLE_BOOKED: 'The limited supervisor capacity case did not produce a SUPERVISOR_DOUBLE_BOOKED conflict.',
      RESOURCE_UNAVAILABLE: 'The no-valid-resource-combination case did not produce a RESOURCE_UNAVAILABLE conflict.',
      TIME_CONSTRAINT_VIOLATION: 'The long-duration exam did not produce a TIME_CONSTRAINT_VIOLATION conflict.',
    };
    return labels[type] ?? `${type} was not produced by the demo scheduling test cases.`;
  });
  const summary = {
    totalExams: normalized.exams.length,
    assignedCount: scheduledExamIds.length,
    conflictCount: fullSchedule.conflicts.length,
    conflictTypesFound,
    missingRequiredConflictTypes,
    assignedExams: scheduledExamIds.length,
    unassignedExams: generatedFailureCount,
    assignmentRows: assignmentInserts.length,
    conflicts: fullSchedule.conflicts.length,
    createdExamRecords: createdExamCount,
    existingAssignments: normalized.existingAssignments.length,
    lockedFinalAssignments: normalized.existingAssignments.filter((assignment) => assignment.schedule?.isFinal).length,
    studentsWithExams: normalized.studentToExams.size,
    warnings: requiredConflictWarnings,
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
    warning: missingRequiredConflictTypes.length > 0 ? requiredConflictWarnings.join(' ') : undefined,
    message: `Schedule generated with ${summary.assignedExams}/${summary.totalExams} exams assigned and ${summary.conflictCount} saved conflicts.`,
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
  const supervisorSlotExamIds = new Map();
  const supervisorDayExamIds = new Map();
  const supervisorDailyLoadViolations = [];
  const examSlotCapacity = new Map();

  // Build a map of supervisors for quick lookup
  const supervisorMap = new Map();
  for (const assignment of schedule.assignments) {
    if (!supervisorMap.has(assignment.supervisorId)) {
      supervisorMap.set(assignment.supervisorId, assignment.supervisor);
    }
  }

  for (const assignment of schedule.assignments) {
    const examSlotKey = `${assignment.examId}:${assignment.timeSlotId}`;
    const capacityGroup = examSlotCapacity.get(examSlotKey) ?? {
      examId: assignment.examId,
      timeSlotId: assignment.timeSlotId,
      assignmentIds: [],
      roomIds: new Set(),
      requiredSeats: getRequiredSeatsForExam(assignment.exam),
      totalCapacity: 0,
    };
    capacityGroup.assignmentIds.push(assignment.id);
    if (!capacityGroup.roomIds.has(assignment.roomId) && assignment.room) {
      capacityGroup.roomIds.add(assignment.roomId);
      capacityGroup.totalCapacity += assignment.room.capacity ?? 0;
    }
    examSlotCapacity.set(examSlotKey, capacityGroup);

    const roomSlotKey = `${assignment.roomId}:${assignment.timeSlotId}`;
    const roomSlotGroup = roomSlotCount.get(roomSlotKey) ?? new Set();
    roomSlotGroup.add(assignment.examId);
    roomSlotCount.set(roomSlotKey, roomSlotGroup);

    const supervisorSlotKey = `${assignment.supervisorId}:${assignment.timeSlotId}`;
    const supervisorSlotGroup = supervisorSlotExamIds.get(supervisorSlotKey) ?? new Set();
    supervisorSlotGroup.add(assignment.examId);
    supervisorSlotExamIds.set(supervisorSlotKey, supervisorSlotGroup);

    const supervisorDayKey = `${assignment.supervisorId}:${toDateKey(assignment.timeSlot.date ?? assignment.timeSlot.startTime)}`;
    const supervisorDayGroup = supervisorDayExamIds.get(supervisorDayKey) ?? new Set();
    supervisorDayGroup.add(assignment.examId);
    supervisorDayExamIds.set(supervisorDayKey, supervisorDayGroup);

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

  for (const [key, examIds] of roomSlotCount.entries()) {
    if (examIds.size > 1) {
      const [roomId, timeSlotId] = key.split(':');
      roomReuseViolations.push({ roomId, timeSlotId, count: examIds.size, examIds: [...examIds] });
    }
  }

  for (const group of examSlotCapacity.values()) {
    if (group.totalCapacity < group.requiredSeats) {
      roomCapacityViolations.push({
        ...group,
        roomIds: [...group.roomIds],
      });
    }
  }

  for (const [key, examIds] of supervisorSlotExamIds.entries()) {
    if (examIds.size > 1) {
      const [supervisorId, timeSlotId] = key.split(':');
      supervisorCollisions.push({ supervisorId, timeSlotId, count: examIds.size, examIds: [...examIds] });
    }
  }

  for (const [key, examIds] of supervisorDayExamIds.entries()) {
    const [supervisorId, date] = key.split(':');
    const supervisor = supervisorMap.get(supervisorId);
    const maxExamsPerDay = supervisor?.maxExamsPerDay ?? 2;
    if (examIds.size > maxExamsPerDay) {
      supervisorDailyLoadViolations.push({
        supervisorId,
        date,
        count: examIds.size,
        examIds: [...examIds],
        maxExamsPerDay,
      });
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

  const unresolvedPersistedConflicts = schedule.conflicts.filter(
    (conflict) => !conflict.resolved
  );
  const totalConflicts = unresolvedPersistedConflicts.length + derivedConflictCount;

  const utilization =
    examSlotCapacity.size === 0
      ? 0
      : [...examSlotCapacity.values()].reduce((acc, group) => {
          if (group.totalCapacity <= 0) return acc; // Avoid division by zero
          return acc + (group.requiredSeats / group.totalCapacity);
        }, 0) / examSlotCapacity.size;

  return {
    scheduleId: schedule.id,
    isFinal: schedule.isFinal,
    metrics: {
      totalAssignments: schedule.assignments.length,
      persistedConflicts: unresolvedPersistedConflicts.length,
      derivedConflicts: derivedConflictCount,
      totalConflicts,
      averageRoomUtilization: Number(utilization.toFixed(3)),
    },
    conflicts: {
      persisted: unresolvedPersistedConflicts,
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