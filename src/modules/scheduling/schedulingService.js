import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';
import { extractAvailableTimeSlotIds } from '../proctors/proctorAvailability.js';

const DEFAULT_EXAM_DURATION = 120;
const PROCTOR_RATIO = 20; // 1 proctor per 20 students
const MAX_STUDENT_EXAMS_PER_DAY = 2;
const LOCAL_SEARCH_EXAM_LIMIT = 30;
const LOCAL_SEARCH_CANDIDATE_LIMIT = 6;
const QUALITY_WEIGHTS = {
  roomUtilization: 0.25,
  proctorWorkloadBalance: 0.25,
  studentSpacing: 0.20,
  examDistribution: 0.15,
  preferredSpacing: 0.15,
};
const HYBRID_ALGORITHM_TYPE = 'HYBRID_CONSTRAINT_BASED';
const NO_VALID_SCHEDULE_MESSAGE = 'No valid conflict-free schedule exists for the current data/resources.';
const GENERATION_STAGE = {
  PREPARED: 'PREPARED',
  VALIDATED: 'VALIDATED',
  DRAFT_BUILT: 'DRAFT_BUILT',
  EVALUATED: 'EVALUATED',
  OPTIMIZED: 'OPTIMIZED',
  RE_EVALUATED: 'RE_EVALUATED',
  CONFIRMED: 'CONFIRMED',
  GENERATED: 'GENERATED',
  BLOCKED: 'BLOCKED',
};

const PIPELINE_STAGES = [
  GENERATION_STAGE.PREPARED,
  GENERATION_STAGE.VALIDATED,
  GENERATION_STAGE.DRAFT_BUILT,
  GENERATION_STAGE.EVALUATED,
  GENERATION_STAGE.OPTIMIZED,
  GENERATION_STAGE.RE_EVALUATED,
  GENERATION_STAGE.CONFIRMED,
  GENERATION_STAGE.GENERATED,
];
const getRequiredProctorCount = (studentCount) => {
  if (studentCount <= 0) return 1;
  return Math.ceil(studentCount / PROCTOR_RATIO);
};
const getRequiredProctorsForExam = (exam) => (
  exam.requiredProctors ?? getRequiredProctorCount(exam.studentCount ?? 0)
);

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

const buildExamConflictCountMap = (studentToExams) => {
  const examNeighborMap = new Map();

  for (const examIds of studentToExams.values()) {
    const relatedExamIds = [...examIds];
    for (let index = 0; index < relatedExamIds.length; index += 1) {
      const examId = relatedExamIds[index];
      if (!examNeighborMap.has(examId)) examNeighborMap.set(examId, new Set());

      const neighbors = examNeighborMap.get(examId);
      for (let neighborIndex = 0; neighborIndex < relatedExamIds.length; neighborIndex += 1) {
        if (neighborIndex === index) continue;
        neighbors.add(relatedExamIds[neighborIndex]);
      }
    }
  }

  return new Map(
    [...examNeighborMap.entries()].map(([examId, neighbors]) => [examId, neighbors.size]),
  );
};

const buildSchedulingLookups = ({ exams, rooms, proctors, timeSlots, existingAssignments }) => {
  const proctorAvailabilityMap = new Map();
  const studentDailyLoadMap = new Map();
  const roomSlotMap = new Map();
  const studentTimeMap = new Map();
  const studentTimeRangeMap = new Map();
  const roomUsageMap = new Map();
  const roomAvailabilityMap = new Map();
  const timeslotCapacityMap = new Map();
  const proctorSlotMap = new Map();
  const proctorDailyLoadMap = new Map();
  const roomTimeRangeMap = new Map();
  const proctorTimeRangeMap = new Map();
  const slotDayKeyMap = new Map(timeSlots.map((slot) => [slot.id, toDateKey(slot.date ?? slot.startTime)]));
  const availableRooms = rooms.filter((room) => room.status === 'AVAILABLE');

  for (const proctor of proctors) {
    proctorAvailabilityMap.set(proctor.id, new Set(proctor.availableTimeSlotIds ?? []));
  }

  for (const room of rooms) {
    roomAvailabilityMap.set(
      room.id,
      new Set(room.status === 'AVAILABLE' ? timeSlots.map((slot) => slot.id) : []),
    );
  }

  for (const slot of timeSlots) {
    timeslotCapacityMap.set(slot.id, getTotalCapacity(availableRooms));
  }

  for (const assignment of existingAssignments) {
    if (!assignment.schedule?.isFinal) continue;
    const slot = assignment.timeSlot;
    const slotDayKey = slotDayKeyMap.get(assignment.timeSlotId) ?? (slot ? toDateKey(slot.date ?? slot.startTime) : null);

    addToNestedSet(roomSlotMap, assignment.roomId, assignment.timeSlotId);
    addToNestedSet(roomUsageMap, assignment.timeSlotId, assignment.roomId);
    addToNestedSet(proctorSlotMap, assignment.proctorId, assignment.timeSlotId);

    if (slotDayKey) {
      const proctorDayKey = `${assignment.proctorId}:${slotDayKey}`;
      proctorDailyLoadMap.set(proctorDayKey, (proctorDailyLoadMap.get(proctorDayKey) ?? 0) + 1);
    }

    if (slot?.startTime && slot?.endTime) {
      addTimeRange(proctorTimeRangeMap, assignment.proctorId, slot.startTime, slot.endTime);
      addTimeRange(roomTimeRangeMap, assignment.roomId, slot.startTime, slot.endTime);
    }

    for (const studentId of getUniqueStudentIdsForExam(assignment.exam)) {
      addToNestedSet(studentTimeMap, studentId, assignment.timeSlotId);
      if (slot?.startTime && slot?.endTime) {
        addTimeRange(studentTimeRangeMap, studentId, slot.startTime, slot.endTime);
      }
      if (slotDayKey) {
        const studentDayKey = `${studentId}:${slotDayKey}`;
        studentDailyLoadMap.set(studentDayKey, (studentDailyLoadMap.get(studentDayKey) ?? 0) + 1);
      }
    }
  }

  for (const exam of exams) {
    for (const studentId of exam.studentIds) {
      if (!studentTimeMap.has(studentId)) studentTimeMap.set(studentId, new Set());
    }
  }

  return {
    proctorAvailabilityMap,
    studentDailyLoadMap,
    roomSlotMap,
    studentTimeMap,
    studentTimeRangeMap,
    roomUsageMap,
    roomAvailabilityMap,
    timeslotCapacityMap,
    proctorSlotMap,
    proctorDailyLoadMap,
    roomTimeRangeMap,
    proctorTimeRangeMap,
    slotDayKeyMap,
  };
};

const getStaticFeasibleTimeSlotCount = ({ exam, rooms, proctors, timeSlots }) => {
  const requiredProctors = getRequiredProctorsForExam(exam);

  return timeSlots.filter((slot) => {
    if (!canSlotFitExam(slot, exam)) return false;
    const slotCapacity = getTotalCapacity(rooms.filter((room) => room.status === 'AVAILABLE'));
    if (slotCapacity < exam.requiredSeats) return false;
    const availableProctors = proctors.filter((proctor) => proctor.availableTimeSlotIds?.has(slot.id));
    return availableProctors.length >= requiredProctors;
  }).length;
};

const getStaticFeasibleOptionCount = ({ exam, rooms, proctors, timeSlots }) => {
  const requiredProctors = getRequiredProctorsForExam(exam);
  let count = 0;

  for (const slot of timeSlots) {
    if (!canSlotFitExam(slot, exam)) continue;
    const availableProctors = proctors.filter((proctor) => proctor.availableTimeSlotIds?.has(slot.id));
    if (availableProctors.length < requiredProctors) continue;

    for (const room of rooms) {
      if (room.status !== 'AVAILABLE' || room.capacity < exam.requiredSeats) continue;
      if (availableProctors.some((proctor) => proctor.centerId === room.centerId)) count += 1;
    }
  }

  return count;
};

const addExamFeasibilityStats = ({ exams, rooms, proctors, timeSlots }) => exams.map((exam) => ({
  ...exam,
  resourceDemand: exam.requiredSeats + (getRequiredProctorsForExam(exam) * PROCTOR_RATIO),
  feasibleTimeSlotCount: getStaticFeasibleTimeSlotCount({ exam, rooms, proctors, timeSlots }),
  feasibleOptionCount: getStaticFeasibleOptionCount({ exam, rooms, proctors, timeSlots }),
}));

const compareExamsForScheduling = (a, b) => (
  b.studentCount - a.studentCount
  || b.priority - a.priority
  || b.resourceDemand - a.resourceDemand
  || a.feasibleOptionCount - b.feasibleOptionCount
  || a.feasibleTimeSlotCount - b.feasibleTimeSlotCount
  || b.conflictCount - a.conflictCount
  || b.difficulty - a.difficulty
  || (a.courseCode ?? '').localeCompare(b.courseCode ?? '')
);

const compareExamsLeastConstrainedFirst = (a, b) => (
  a.conflictCount - b.conflictCount
  || a.studentCount - b.studentCount
  || a.priority - b.priority
  || (a.courseCode ?? '').localeCompare(b.courseCode ?? '')
);

const compareExamsPriorityFirst = (a, b) => (
  b.priority - a.priority
  || b.studentCount - a.studentCount
  || b.conflictCount - a.conflictCount
  || (a.courseCode ?? '').localeCompare(b.courseCode ?? '')
);

const compareExamsShortestFirst = (a, b) => (
  (a.duration ?? DEFAULT_EXAM_DURATION) - (b.duration ?? DEFAULT_EXAM_DURATION)
  || a.conflictCount - b.conflictCount
  || a.studentCount - b.studentCount
  || (a.courseCode ?? '').localeCompare(b.courseCode ?? '')
);

const normalizeSchedulingData = ({ courseOfferings, rooms, proctors, timeSlots, existingAssignments }) => {
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
      semesterStartDate: offering.semester?.startDate ?? null,
      semesterEndDate: offering.semester?.endDate ?? null,
      section: offering.section,
      priority: offering.priority ?? 0,
      difficulty: offering.difficulty ?? 0,
      duration: exam.duration ?? DEFAULT_EXAM_DURATION,
      expectedStudents,
      studentCount,
      requiredSeats: Math.max(studentCount, expectedStudents, 1),
      requiredProctors: getRequiredProctorCount(studentCount),
      studentIds,
      courseOffering: offering,
    };
  });

  const normalizedRooms = rooms.map((room) => ({
    id: room.id,
    name: room.name,
    capacity: room.capacity,
    status: room.status,
    centerId: room.centerId,
    center: room.center,
  }));
  const normalizedProctors = proctors.map((proctor) => ({
    id: proctor.id,
    centerId: proctor.centerId,
    center: proctor.center,
    user: proctor.user,
    maxExamsPerDay: proctor.maxExamsPerDay ?? 2,
    availableTimeSlotIds: extractAvailableTimeSlotIds(proctor),
  }));
  const studentExamMap = buildStudentExamMap(exams);
  const examConflictCountMap = buildExamConflictCountMap(studentExamMap);
  const examsWithConflictCounts = addExamFeasibilityStats({
    exams: exams.map((exam) => ({
      ...exam,
      conflictCount: examConflictCountMap.get(exam.id) ?? 0,
    })),
    rooms: normalizedRooms,
    proctors: normalizedProctors,
    timeSlots,
  });

  return {
    exams: examsWithConflictCounts,
    rooms: normalizedRooms,
    proctors: normalizedProctors,
    timeSlots,
    existingAssignments,
    studentExamMap,
    studentToExams: studentExamMap,
    lookups: buildSchedulingLookups({
      exams: examsWithConflictCounts,
      rooms: normalizedRooms,
      proctors: normalizedProctors,
      timeSlots,
      existingAssignments,
    }),
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

  const [courseOfferings, rooms, proctors, allTimeSlots, existingAssignments] = await Promise.all([
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
    prisma.proctor.findMany({
      include: {
        center: true,
        user: { select: { id: true, name: true, email: true } },
        availableTimeSlots: {
          select: {
            timeSlotId: true,
          },
        },
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
        proctor: true,
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
  const normalized = normalizeSchedulingData({ courseOfferings, rooms, proctors, timeSlots, existingAssignments });

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

const cloneNestedSetMap = (source = new Map()) => new Map(
  [...source.entries()].map(([key, values]) => [key, new Set(values)]),
);

const cloneCountMap = (source = new Map()) => new Map(source.entries());

const cloneRangeMap = (source = new Map()) => new Map(
  [...source.entries()].map(([key, ranges]) => [key, ranges.map((range) => ({ ...range }))]),
);

const createUsageTracker = (existingAssignments = [], lookups = null) => {
  if (lookups) {
    return {
      roomSlotMap: cloneNestedSetMap(lookups.roomSlotMap),
      proctorSlotMap: cloneNestedSetMap(lookups.proctorSlotMap),
      studentTimeMap: cloneNestedSetMap(lookups.studentTimeMap),
      studentTimeRangeMap: cloneRangeMap(lookups.studentTimeRangeMap),
      studentDailyLoadMap: cloneCountMap(lookups.studentDailyLoadMap),
      proctorDailyLoadMap: cloneCountMap(lookups.proctorDailyLoadMap),
      proctorTimeRangeMap: cloneRangeMap(lookups.proctorTimeRangeMap),
      roomTimeRangeMap: cloneRangeMap(lookups.roomTimeRangeMap),
    };
  }

  const usage = {
    roomSlotMap: new Map(),
    proctorSlotMap: new Map(),
    studentTimeMap: new Map(),
    studentTimeRangeMap: new Map(),
    studentDailyLoadMap: new Map(),
    proctorDailyLoadMap: new Map(),
    proctorTimeRangeMap: new Map(),
    roomTimeRangeMap: new Map(),
  };

  const reservedStudentExamSlots = new Set();

  for (const assignment of existingAssignments) {
    if (!assignment.schedule?.isFinal) continue;

    addToNestedSet(usage.roomSlotMap, assignment.roomId, assignment.timeSlotId);
    addToNestedSet(usage.proctorSlotMap, assignment.proctorId, assignment.timeSlotId);

    const slotDate = assignment.timeSlot?.date ?? assignment.timeSlot?.startTime;
    if (slotDate) {
      const key = `${assignment.proctorId}:${toDateKey(slotDate)}`;
      usage.proctorDailyLoadMap.set(key, (usage.proctorDailyLoadMap.get(key) ?? 0) + 1);
    }

    const ts = assignment.timeSlot;
    if (ts?.startTime && ts?.endTime) {
      addTimeRange(usage.proctorTimeRangeMap, assignment.proctorId, ts.startTime, ts.endTime);
      addTimeRange(usage.roomTimeRangeMap, assignment.roomId, ts.startTime, ts.endTime);
    }

    const studentReservationKey = `${assignment.examId}:${assignment.timeSlotId}`;
    if (!reservedStudentExamSlots.has(studentReservationKey)) {
      reservedStudentExamSlots.add(studentReservationKey);
      for (const studentId of getUniqueStudentIdsForExam(assignment.exam)) {
        addToNestedSet(usage.studentTimeMap, studentId, assignment.timeSlotId);
        if (assignment.timeSlot?.startTime && assignment.timeSlot?.endTime) {
          addTimeRange(usage.studentTimeRangeMap, studentId, assignment.timeSlot.startTime, assignment.timeSlot.endTime);
        }
        const studentSlotDate = assignment.timeSlot?.date ?? assignment.timeSlot?.startTime;
        if (studentSlotDate) {
          const studentDayKey = `${studentId}:${toDateKey(studentSlotDate)}`;
          usage.studentDailyLoadMap.set(studentDayKey, (usage.studentDailyLoadMap.get(studentDayKey) ?? 0) + 1);
        }
      }
    }
  }

  return usage;
};

const reserveAssignment = (usage, assignment, exam, slot, slotDayKey = toDateKey(slot.date ?? slot.startTime), options = {}) => {
  addToNestedSet(usage.roomSlotMap, assignment.roomId, assignment.timeSlotId);
  addToNestedSet(usage.proctorSlotMap, assignment.proctorId, assignment.timeSlotId);

  const proctorDayKey = `${assignment.proctorId}:${slotDayKey}`;
  usage.proctorDailyLoadMap.set(proctorDayKey, (usage.proctorDailyLoadMap.get(proctorDayKey) ?? 0) + 1);

  if (slot.startTime && slot.endTime) {
    addTimeRange(usage.proctorTimeRangeMap, assignment.proctorId, slot.startTime, slot.endTime);
    addTimeRange(usage.roomTimeRangeMap, assignment.roomId, slot.startTime, slot.endTime);
  }

  if (options.reserveStudents === false) return;

  for (const studentId of exam.studentIds) {
    addToNestedSet(usage.studentTimeMap, studentId, assignment.timeSlotId);
    if (slot.startTime && slot.endTime) {
      addTimeRange(usage.studentTimeRangeMap, studentId, slot.startTime, slot.endTime);
    }
    const studentDayKey = `${studentId}:${slotDayKey}`;
    usage.studentDailyLoadMap.set(studentDayKey, (usage.studentDailyLoadMap.get(studentDayKey) ?? 0) + 1);
  }
};

const hasStudentOverlap = (usage, exam, slotOrId) => {
  const slotId = typeof slotOrId === 'object' ? slotOrId.id : slotOrId;
  const slot = typeof slotOrId === 'object' ? slotOrId : null;
  return exam.studentIds.some((studentId) => (
    usage.studentTimeMap.get(studentId)?.has(slotId)
    || (slot ? hasTemporalOverlap(usage.studentTimeRangeMap, studentId, slot) : false)
  ));
};

const hasStudentDailyLoadCapacity = (usage, exam, slotDayKey) => {
  return exam.studentIds.every((studentId) => (
    (usage.studentDailyLoadMap.get(`${studentId}:${slotDayKey}`) ?? 0) < MAX_STUDENT_EXAMS_PER_DAY
  ));
};

const buildSlotDayKeyMap = (timeSlots) => {
  return new Map(timeSlots.map((slot) => [slot.id, toDateKey(slot.date ?? slot.startTime)]));
};

const sortRoomsByCapacityDesc = (rooms) => {
  return [...rooms].sort((a, b) => b.capacity - a.capacity || a.name.localeCompare(b.name));
};

const sortRoomsByCapacityAsc = (rooms) => {
  return [...rooms].sort((a, b) => a.capacity - b.capacity || a.name.localeCompare(b.name));
};

const isRoomAvailableForSlot = (room, slot, usage) => {
  if (room.status !== 'AVAILABLE') return false;
  if (usage.roomSlotMap.get(room.id)?.has(slot.id)) return false;
  if (hasTemporalOverlap(usage.roomTimeRangeMap, room.id, slot)) return false;
  return true;
};

const isProctorAvailableForSlot = (proctor, slot, usage, slotDayKey = toDateKey(slot.date ?? slot.startTime)) => {
  if (!proctor.availableTimeSlotIds?.has(slot.id)) return false;
  if (usage.proctorSlotMap.get(proctor.id)?.has(slot.id)) return false;
  if (hasTemporalOverlap(usage.proctorTimeRangeMap, proctor.id, slot)) return false;

  const proctorDayKey = `${proctor.id}:${slotDayKey}`;
  return (usage.proctorDailyLoadMap.get(proctorDayKey) ?? 0) < proctor.maxExamsPerDay;
};

const getAvailableRoomsForSlot = (sortedRooms, slot, usage) => {
  return sortedRooms.filter((room) => isRoomAvailableForSlot(room, slot, usage));
};

const getAvailableProctorsForSlot = (proctors, slot, usage, slotDayKey) => {
  return proctors
    .filter((proctor) => isProctorAvailableForSlot(proctor, slot, usage, slotDayKey))
    .sort((a, b) => (
      (usage.proctorDailyLoadMap.get(`${a.id}:${slotDayKey}`) ?? 0)
      - (usage.proctorDailyLoadMap.get(`${b.id}:${slotDayKey}`) ?? 0)
      || (a.user?.name ?? '').localeCompare(b.user?.name ?? '')
    ));
};

const getProctorsForRoom = (proctors, room) => {
  return proctors.filter((proctor) => proctor.centerId === room.centerId);
};

const getTotalCapacity = (rooms) => rooms.reduce((total, room) => total + room.capacity, 0);

const getSlotDurationMinutes = (slot) => {
  if (slot.duration) return slot.duration;
  return Math.max(0, Math.round((slot.endTime.getTime() - slot.startTime.getTime()) / 60000));
};

const hasValidTimeSlotWindow = (slot) => {
  if (!slot?.startTime || !slot?.endTime) return false;

  const startTime = slot.startTime instanceof Date ? slot.startTime : new Date(slot.startTime);
  const endTime = slot.endTime instanceof Date ? slot.endTime : new Date(slot.endTime);
  const slotDate = slot.date ?? slot.startTime;
  const dateValue = slotDate instanceof Date ? slotDate : new Date(slotDate);

  return !Number.isNaN(startTime.getTime())
    && !Number.isNaN(endTime.getTime())
    && !Number.isNaN(dateValue.getTime())
    && endTime > startTime;
};

const isSlotWithinSemesterWindow = (slot, exam) => {
  const slotStart = slot?.startTime instanceof Date ? slot.startTime : new Date(slot?.startTime);
  const slotEnd = slot?.endTime instanceof Date ? slot.endTime : new Date(slot?.endTime);
  const semesterStart = exam?.semesterStartDate instanceof Date
    ? exam.semesterStartDate
    : new Date(exam?.semesterStartDate);
  const semesterEnd = exam?.semesterEndDate instanceof Date
    ? exam.semesterEndDate
    : new Date(exam?.semesterEndDate);

  if (
    Number.isNaN(slotStart?.getTime?.())
    || Number.isNaN(slotEnd?.getTime?.())
    || Number.isNaN(semesterStart?.getTime?.())
    || Number.isNaN(semesterEnd?.getTime?.())
  ) {
    return false;
  }

  return slotStart >= semesterStart && slotEnd <= semesterEnd;
};

const hasEnrollmentConstraintSatisfied = (exam) => (
  (exam.studentCount ?? 0) > 0 && (exam.studentIds?.length ?? 0) > 0
);

const canSlotFitExam = (slot, exam) => {
  if (!hasValidTimeSlotWindow(slot)) return false;
  if (!isSlotWithinSemesterWindow(slot, exam)) return false;
  return getSlotDurationMinutes(slot) >= (exam.duration ?? DEFAULT_EXAM_DURATION);
};

const isValidAssignment = ({ exam, slot, room, proctor, usage, slotDayKey }) => {
  if (!canSlotFitExam(slot, exam)) return false;
  if (hasStudentOverlap(usage, exam, slot)) return false;
  if (room.centerId !== proctor.centerId) return false;
  if (!isRoomAvailableForSlot(room, slot, usage)) return false;
  if (room.capacity < exam.requiredSeats) return false;
  return isProctorAvailableForSlot(proctor, slot, usage, slotDayKey);
};

const buildRoomAllocation = ({ exam, slot, sortedRooms, proctors, usage, slotDayKey }) => {
  if (!canSlotFitExam(slot, exam)) return null;
  if (hasStudentOverlap(usage, exam, slot)) return null;

  const availableRooms = getAvailableRoomsForSlot(sortedRooms, slot, usage);
  const availableProctors = getAvailableProctorsForSlot(proctors, slot, usage, slotDayKey);
  const requiredProctors = getRequiredProctorsForExam(exam);

  if (availableProctors.length < requiredProctors) return null;

  // Single-room fast path: one room seats all students and all proctors come from that room's center.
  const singleRoom = availableRooms.find((room) => {
    if (room.capacity < exam.requiredSeats) return false;
    return getProctorsForRoom(availableProctors, room).length >= requiredProctors;
  });
  if (singleRoom) {
    const roomProctors = getProctorsForRoom(availableProctors, singleRoom);
    const proctor = roomProctors[0];
    if (isValidAssignment({ exam, slot, room: singleRoom, proctor, usage, slotDayKey })) {
      // Assign all required proctors to the same room
      return roomProctors.slice(0, requiredProctors).map((sup) => ({
        room: singleRoom,
        proctor: sup,
      }));
    }
  }

  // Multi-room path: accumulate rooms with center-matched proctors until capacity is met.
  const selectedRooms = [];
  const allocation = [];
  const usedProctorIds = new Set();
  let totalCapacity = 0;

  for (const room of availableRooms) {
    const proctor = getProctorsForRoom(availableProctors, room)
      .find((candidate) => !usedProctorIds.has(candidate.id));
    if (!proctor) continue;

    selectedRooms.push(room);
    allocation.push({ room, proctor });
    usedProctorIds.add(proctor.id);
    totalCapacity += room.capacity;
    if (totalCapacity >= exam.requiredSeats) break;
  }

  if (totalCapacity < exam.requiredSeats) return null;

  // Need at least one proctor per room AND requiredProctors total
  const proctorsNeeded = Math.max(selectedRooms.length, requiredProctors);
  if (allocation.length < selectedRooms.length) return null;

  for (const room of selectedRooms) {
    if (allocation.length >= proctorsNeeded) break;
    const extraProctor = getProctorsForRoom(availableProctors, room)
      .find((candidate) => !usedProctorIds.has(candidate.id));
    if (!extraProctor) continue;

    allocation.push({ room, proctor: extraProctor });
    usedProctorIds.add(extraProctor.id);
  }

  if (allocation.length < proctorsNeeded) return null;

  return allocation;
};

const isValidRoomAllocation = ({ exam, slot, allocation, usage, slotDayKey }) => {
  if (!allocation?.length) return false;
  if (!canSlotFitExam(slot, exam)) return false;
  if (hasStudentOverlap(usage, exam, slot)) return false;
  if (!hasStudentDailyLoadCapacity(usage, exam, slotDayKey)) return false;

  const checkedRoomIds = new Set();
  const proctorIds = new Set();

  for (const { room, proctor } of allocation) {
    if (!room || !proctor) return false;
    if (proctorIds.has(proctor.id)) return false;
    if (room.centerId !== proctor.centerId) return false;
    // Only check room availability on first occurrence (multiple proctors may share a room)
    if (!checkedRoomIds.has(room.id) && !isRoomAvailableForSlot(room, slot, usage)) return false;
    if (!isProctorAvailableForSlot(proctor, slot, usage, slotDayKey)) return false;

    checkedRoomIds.add(room.id);
    proctorIds.add(proctor.id);
  }

  // Capacity check uses unique rooms only (proctors can share a room)
  const uniqueRooms = [...new Map(allocation.map(({ room }) => [room.id, room])).values()];
  const uniqueProctorIds = new Set(allocation.map(({ proctor }) => proctor.id));
  return getTotalCapacity(uniqueRooms) >= exam.requiredSeats
    && uniqueProctorIds.size >= getRequiredProctorsForExam(exam);
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

const getProctorSampleLabel = (proctors) => proctors
  .slice(0, 4)
  .map((proctor) => proctor.user?.name ?? 'Unnamed proctor')
  .join(', ');

const getSlotLabel = (slot) => {
  if (!slot?.startTime || !slot?.endTime) return 'an available time slot';
  const start = new Date(slot.startTime).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const end = new Date(slot.endTime).toLocaleTimeString('en-US', { timeStyle: 'short' });
  return `${start} to ${end}`;
};

const getMaxSupervisedCapacity = (rooms, proctorCount) => {
  if (proctorCount <= 0) return 0;
  return getTotalCapacity(sortRoomsByCapacityDesc(rooms).slice(0, proctorCount));
};

const buildAssignmentFailureConflict = ({ scheduleId, exam, timeSlots, sortedRooms, proctors, usage, slotDayKeys }) => {
  const examLabel = getExamLabel(exam);
  const totalRoomCapacity = getTotalCapacity(sortedRooms);
  const requiredProctors = getRequiredProctorsForExam(exam);

  if (!hasEnrollmentConstraintSatisfied(exam)) {
    return buildConflictPayload(
      scheduleId,
      'RESOURCE_UNAVAILABLE',
      `${examLabel} has no enrolled students and cannot be scheduled until at least one enrollment exists.`,
    );
  }

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

  if (proctors.length === 0) {
    return buildConflictPayload(
      scheduleId,
      'RESOURCE_UNAVAILABLE',
      `No proctors are available to invigilate ${examLabel}. Every exam must have at least one proctor before generation can continue.`,
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

  if (proctors.length < requiredProctors) {
    const proctorLabel = getProctorSampleLabel(proctors);
    return buildConflictPayload(
      scheduleId,
      'RESOURCE_UNAVAILABLE',
      `${examLabel} has ${exam.studentCount} enrolled student${exam.studentCount !== 1 ? 's' : ''} and needs ${requiredProctors} proctor${requiredProctors !== 1 ? 's' : ''} (1 per ${PROCTOR_RATIO} students), but only ${proctors.length} proctor${proctors.length !== 1 ? 's' : ''} ${proctors.length === 1 ? 'is' : 'are'} available${proctorLabel ? `: ${proctorLabel}` : ''}.`,
    );
  }

  const everySlotHasStudentOverlap = timeSlots.every((slot) => hasStudentOverlap(usage, exam, slot));
  if (everySlotHasStudentOverlap) {
    const studentLabels = getSampleStudentLabels(exam);
    return buildConflictPayload(
      scheduleId,
      'STUDENT_OVERLAP',
      `Every available time slot conflicts with registered students for ${examLabel}${studentLabels.length ? `, including ${studentLabels.join(', ')}` : ''}.`,
    );
  }

  const everyFittingSlotExceedsStudentDailyLoad = fittingSlots.every((slot) => (
    !hasStudentDailyLoadCapacity(usage, exam, slotDayKeys.get(slot.id))
  ));
  if (everyFittingSlotExceedsStudentDailyLoad) {
    return buildConflictPayload(
      scheduleId,
      'STUDENT_OVERLAP',
      `${examLabel} cannot be assigned without exceeding the student daily load limit of ${MAX_STUDENT_EXAMS_PER_DAY} exam${MAX_STUDENT_EXAMS_PER_DAY !== 1 ? 's' : ''} per day.`,
    );
  }

  const everyNonOverlappingSlotHasNoProctor = timeSlots
    .filter((slot) => !hasStudentOverlap(usage, exam, slot))
    .every((slot) => getAvailableProctorsForSlot(proctors, slot, usage, slotDayKeys.get(slot.id)).length < requiredProctors);

  if (everyNonOverlappingSlotHasNoProctor) {
    const proctorLabel = getProctorSampleLabel(proctors);
    return buildConflictPayload(
      scheduleId,
      'PROCTOR_DOUBLE_BOOKED',
      `${examLabel} needs ${requiredProctors} proctor${requiredProctors !== 1 ? 's' : ''} for ${exam.studentCount} enrolled student${exam.studentCount !== 1 ? 's' : ''}, but no time slot has enough available proctors without violating availability, double-booking, or exceeding daily limits${proctorLabel ? `. Checked proctors: ${proctorLabel}.` : '.'}`,
    );
  }

  const capacityEligibleSlots = timeSlots.filter((slot) => {
    if (!canSlotFitExam(slot, exam) || hasStudentOverlap(usage, exam, slot)) return false;
    const availableRooms = getAvailableRoomsForSlot(sortedRooms, slot, usage);
    return getTotalCapacity(availableRooms) >= exam.requiredSeats;
  });

  if (capacityEligibleSlots.length > 0) {
    const everyCapacityEligibleSlotFailsProctorAllocation = capacityEligibleSlots.every((slot) => {
      const slotDayKey = slotDayKeys.get(slot.id);
      const allocation = buildRoomAllocation({ exam, slot, sortedRooms, proctors, usage, slotDayKey });
      return !isValidRoomAllocation({ exam, slot, allocation, usage, slotDayKey });
    });

    if (everyCapacityEligibleSlotFailsProctorAllocation) {
      const proctorLabel = getProctorSampleLabel(proctors);
      return buildConflictPayload(
        scheduleId,
        'PROCTOR_DOUBLE_BOOKED',
        `${examLabel} has enough room capacity, but cannot secure ${requiredProctors} proctor${requiredProctors !== 1 ? 's' : ''} for ${exam.studentCount} enrolled student${exam.studentCount !== 1 ? 's' : ''} without violating availability, double-booking proctors, or exceeding maxExamsPerDay${proctorLabel ? `. Checked proctors: ${proctorLabel}.` : '.'}`,
      );
    }
  }

  const canFitCapacityInAnySlot = timeSlots.some((slot) => {
    if (!canSlotFitExam(slot, exam) || hasStudentOverlap(usage, exam, slot)) return false;

    const slotDayKey = slotDayKeys.get(slot.id);
    const availableRooms = getAvailableRoomsForSlot(sortedRooms, slot, usage);
    const availableProctors = getAvailableProctorsForSlot(proctors, slot, usage, slotDayKey);

    return getTotalCapacity(availableRooms) >= exam.requiredSeats &&
      availableProctors.length >= requiredProctors;
  });

  if (!canFitCapacityInAnySlot) {
    return buildConflictPayload(
      scheduleId,
      'ROOM_OVERCAPACITY',
      `No time slot has enough unused room capacity and proctor coverage for ${examLabel}: requires ${exam.requiredSeats} seats.`,
    );
  }

  return buildConflictPayload(
    scheduleId,
    'RESOURCE_UNAVAILABLE',
    `No valid assignment found for ${examLabel} after checking timeslots, rooms, proctors, student overlaps, room reuse, and proctor daily limits.`,
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
      proctor: { include: { user: { select: { id: true, name: true, email: true } } } },
      timeSlot: true,
    },
  },
  _count: { select: { assignments: true } },
};

const orderTimeSlotsForStrategy = (timeSlots, strategyId) => {
  const ordered = [...timeSlots];

  if (strategyId === 'latest-slot-first') {
    return ordered.reverse();
  }

  if (strategyId === 'midpoint-balance') {
    const result = [];
    let left = 0;
    let right = ordered.length - 1;
    while (left <= right) {
      if (left === right) {
        result.push(ordered[left]);
      } else {
        result.push(ordered[left], ordered[right]);
      }
      left += 1;
      right -= 1;
    }
    return result;
  }

  return ordered;
};

const scoreSoftCandidate = ({ exam, slot, allocation, usage, slotDayKey }) => {
  const uniqueRooms = [...new Map(allocation.map(({ room }) => [room.id, room])).values()];
  const totalCapacity = getTotalCapacity(uniqueRooms);
  const unusedSeatsPenalty = Math.max(0, totalCapacity - exam.requiredSeats);
  const roomSpreadPenalty = Math.max(0, uniqueRooms.length - 1) * 12;
  const centerSpreadPenalty = Math.max(0, new Set(uniqueRooms.map((room) => room.centerId)).size - 1) * 25;
  const studentDailyLoadPenalty = exam.studentIds.reduce((total, studentId) => (
    total + ((usage.studentDailyLoadMap.get(`${studentId}:${slotDayKey}`) ?? 0) * 20)
  ), 0);
  const proctorDailyLoadPenalty = allocation.reduce((total, { proctor }) => (
    total + ((usage.proctorDailyLoadMap.get(`${proctor.id}:${slotDayKey}`) ?? 0) * 10)
  ), 0);

  return unusedSeatsPenalty + roomSpreadPenalty + centerSpreadPenalty + studentDailyLoadPenalty + proctorDailyLoadPenalty;
};

const buildValidCandidatesForExam = ({ exam, timeSlots, sortedRooms, proctors, usage, slotDayKeys, strategy }) => {
  if (!hasEnrollmentConstraintSatisfied(exam)) return [];

  const fittingSlots = orderTimeSlotsForStrategy(
    timeSlots.filter((slot) => canSlotFitExam(slot, exam)),
    strategy.id,
  );

  const candidates = [];
  for (const slot of fittingSlots) {
    if (hasStudentOverlap(usage, exam, slot)) continue;
    const slotDayKey = slotDayKeys.get(slot.id);
    if (!hasStudentDailyLoadCapacity(usage, exam, slotDayKey)) continue;
    const allocation = buildRoomAllocation({ exam, slot, sortedRooms, proctors, usage, slotDayKey });
    if (!isValidRoomAllocation({ exam, slot, allocation, usage, slotDayKey })) continue;

    const softPenalty = scoreSoftCandidate({ exam, slot, allocation, usage, slotDayKey });
    candidates.push({ slot, allocation, slotDayKey, softPenalty });
    if (strategy.earlyStopOnPerfectCandidate && softPenalty === 0) break;
  }

  return candidates.sort((a, b) => a.softPenalty - b.softPenalty || a.slot.startTime - b.slot.startTime);
};

const buildHybridDraft = ({ scheduleId, exams, rooms, proctors, timeSlots, existingAssignments, lookups = null, strategy = {} }) => {
  const usage = createUsageTracker(existingAssignments, lookups);
  const roomSorter = strategy.roomSorter ?? sortRoomsByCapacityDesc;
  const examComparator = strategy.examComparator ?? compareExamsForScheduling;
  const sortedRooms = roomSorter(rooms);
  const slotDayKeys = buildSlotDayKeyMap(timeSlots);
  const assignmentInserts = [];
  const conflictInserts = [];
  const scheduledExamIds = [];
  const candidateScores = [];

  const sortedExams = [...exams].sort(examComparator);

  for (const exam of sortedExams) {
    const candidates = buildValidCandidatesForExam({
      exam,
      timeSlots,
      sortedRooms,
      proctors,
      usage,
      slotDayKeys,
      strategy,
    });

    if (candidates.length === 0) {
      conflictInserts.push(buildAssignmentFailureConflict({
        scheduleId,
        exam,
        timeSlots,
        sortedRooms,
        proctors,
        usage,
        slotDayKeys,
      }));
      continue;
    }

    const bestCandidate = candidates[0];
    const assignments = bestCandidate.allocation.map(({ room, proctor }) => ({
      scheduleId,
      examId: exam.id,
      roomId: room.id,
      proctorId: proctor.id,
      timeSlotId: bestCandidate.slot.id,
    }));

    for (const [index, assignment] of assignments.entries()) {
      reserveAssignment(usage, assignment, exam, bestCandidate.slot, bestCandidate.slotDayKey, {
        reserveStudents: index === 0,
      });
    }

    assignmentInserts.push(...assignments);
    scheduledExamIds.push(exam.id);
    candidateScores.push({
      examId: exam.id,
      timeSlotId: bestCandidate.slot.id,
      roomIds: bestCandidate.allocation.map(({ room }) => room.id),
      proctorIds: bestCandidate.allocation.map(({ proctor }) => proctor.id),
      softPenalty: bestCandidate.softPenalty,
    });
  }

  return {
    assignmentInserts,
    conflictInserts,
    scheduledExamIds,
    candidateScores,
    softPenalty: candidateScores.reduce((total, score) => total + score.softPenalty, 0),
    hardConstraintViolations: conflictInserts.length,
    strategyId: strategy.id ?? 'greedy-priority-csp',
    strategyLabel: strategy.label ?? 'Greedy priority CSP draft',
  };
};

const clampScore = (value) => Math.max(0, Math.min(100, value));

const roundMetric = (value) => Math.round(value * 10) / 10;

const average = (values) => (values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length);

const standardDeviation = (values) => {
  if (values.length <= 1) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
};

const getDayDistance = (left, right) => Math.abs(
  (new Date(right).setHours(0, 0, 0, 0) - new Date(left).setHours(0, 0, 0, 0)) / 86400000,
);

const groupAssignmentsByExam = (assignments = []) => {
  const groups = new Map();
  for (const assignment of assignments) {
    if (!groups.has(assignment.examId)) groups.set(assignment.examId, []);
    groups.get(assignment.examId).push(assignment);
  }
  return groups;
};

const evaluateDraftSchedule = ({ normalized, draft }) => {
  const examById = new Map(normalized.exams.map((exam) => [exam.id, exam]));
  const roomById = new Map(normalized.rooms.map((room) => [room.id, room]));
  const proctorIds = normalized.proctors.map((proctor) => proctor.id);
  const slotById = new Map(normalized.timeSlots.map((slot) => [slot.id, slot]));
  const assignmentsByExam = groupAssignmentsByExam(draft.assignmentInserts);

  const roomUtilizationRatios = [];
  const proctorWorkloads = new Map(proctorIds.map((id) => [id, 0]));
  const studentSlotEntries = new Map();
  const dayExamCounts = new Map();
  const slotExamCounts = new Map();
  let centerSpreadPenalty = 0;

  for (const [examId, assignments] of assignmentsByExam.entries()) {
    const exam = examById.get(examId);
    const slot = slotById.get(assignments[0]?.timeSlotId);
    if (!exam || !slot) continue;

    const uniqueRooms = [...new Map(assignments
      .map((assignment) => roomById.get(assignment.roomId))
      .filter(Boolean)
      .map((room) => [room.id, room])).values()];
    const capacity = getTotalCapacity(uniqueRooms);
    if (capacity > 0) roomUtilizationRatios.push(Math.min(1, exam.requiredSeats / capacity));

    const uniqueProctorIds = new Set(assignments.map((assignment) => assignment.proctorId));
    for (const proctorId of uniqueProctorIds) {
      proctorWorkloads.set(proctorId, (proctorWorkloads.get(proctorId) ?? 0) + 1);
    }

    centerSpreadPenalty += Math.max(0, new Set(uniqueRooms.map((room) => room.centerId)).size - 1);

    const dayKey = toDateKey(slot.date ?? slot.startTime);
    dayExamCounts.set(dayKey, (dayExamCounts.get(dayKey) ?? 0) + 1);
    slotExamCounts.set(slot.id, (slotExamCounts.get(slot.id) ?? 0) + 1);

    for (const studentId of exam.studentIds) {
      if (!studentSlotEntries.has(studentId)) studentSlotEntries.set(studentId, []);
      studentSlotEntries.get(studentId).push(slot);
    }
  }

  const roomUtilization = clampScore(average(roomUtilizationRatios) * 100);

  const workloadValues = [...proctorWorkloads.values()];
  const workloadMean = average(workloadValues);
  const workloadStdDev = standardDeviation(workloadValues);
  const proctorWorkloadBalance = workloadValues.length === 0
    ? 0
    : clampScore(100 - ((workloadStdDev / Math.max(1, workloadMean)) * 45));

  const spacingScores = [];
  const preferredSpacingScores = [];
  for (const slots of studentSlotEntries.values()) {
    const orderedSlots = [...slots].sort((a, b) => a.startTime - b.startTime);
    for (let index = 1; index < orderedSlots.length; index += 1) {
      const gapDays = getDayDistance(orderedSlots[index - 1].startTime, orderedSlots[index].startTime);
      spacingScores.push(clampScore((gapDays / 2) * 100));
      preferredSpacingScores.push(gapDays >= 1 ? 100 : 35);
    }
  }
  const studentSpacing = spacingScores.length === 0 ? 100 : average(spacingScores);
  const preferredSpacing = preferredSpacingScores.length === 0 ? 100 : average(preferredSpacingScores);

  const distributionValues = [...dayExamCounts.values(), ...slotExamCounts.values()];
  const distributionMean = average(distributionValues);
  const distributionStdDev = standardDeviation(distributionValues);
  const examDistribution = distributionValues.length === 0
    ? 0
    : clampScore(100 - ((distributionStdDev / Math.max(1, distributionMean)) * 35));

  const centerProximity = clampScore(100 - (centerSpreadPenalty * 8));
  const metrics = {
    roomUtilization: roundMetric(roomUtilization),
    proctorWorkloadBalance: roundMetric(proctorWorkloadBalance),
    studentSpacing: roundMetric(studentSpacing),
    examDistribution: roundMetric(examDistribution),
    preferredSpacing: roundMetric(preferredSpacing),
    centerProximity: roundMetric(centerProximity),
  };
  const score = roundMetric(
    (metrics.roomUtilization * QUALITY_WEIGHTS.roomUtilization)
    + (metrics.proctorWorkloadBalance * QUALITY_WEIGHTS.proctorWorkloadBalance)
    + (metrics.studentSpacing * QUALITY_WEIGHTS.studentSpacing)
    + (metrics.examDistribution * QUALITY_WEIGHTS.examDistribution)
    + (metrics.preferredSpacing * QUALITY_WEIGHTS.preferredSpacing),
  );

  const weakAreas = Object.entries(metrics)
    .filter(([, value]) => value < 75)
    .map(([key, value]) => ({ area: key, score: value }));

  return {
    score,
    scorePercent: `${score}%`,
    weakAreas,
    metrics,
    qualityMetrics: {
      ...metrics,
      proctorWorkloadRange: workloadValues.length > 0
        ? Math.max(...workloadValues) - Math.min(...workloadValues)
        : 0,
      averageRoomUtilization: metrics.roomUtilization,
      examsPerDay: Object.fromEntries(dayExamCounts.entries()),
    },
  };
};

const withQualityEvaluation = (normalized, draft, originalEvaluation = null) => {
  const qualityEvaluation = evaluateDraftSchedule({ normalized, draft });
  return {
    ...draft,
    softPenalty: roundMetric(100 - qualityEvaluation.score),
    qualityEvaluation,
    ...(originalEvaluation ? { originalQualityEvaluation: originalEvaluation } : {}),
  };
};

const createUsageFromDraft = ({ normalized, draft, excludedExamId = null }) => {
  const usage = createUsageTracker(normalized.existingAssignments, normalized.lookups);
  const examById = new Map(normalized.exams.map((exam) => [exam.id, exam]));
  const slotById = new Map(normalized.timeSlots.map((slot) => [slot.id, slot]));
  const reservedStudentExamSlots = new Set();

  for (const assignment of draft.assignmentInserts) {
    if (assignment.examId === excludedExamId) continue;
    const exam = examById.get(assignment.examId);
    const slot = slotById.get(assignment.timeSlotId);
    if (!exam || !slot) continue;
    const slotDayKey = toDateKey(slot.date ?? slot.startTime);
    const studentReservationKey = `${assignment.examId}:${assignment.timeSlotId}`;
    reserveAssignment(usage, assignment, exam, slot, slotDayKey, {
      reserveStudents: !reservedStudentExamSlots.has(studentReservationKey),
    });
    reservedStudentExamSlots.add(studentReservationKey);
  }

  return usage;
};

const replaceExamAssignments = ({ draft, examId, candidate }) => {
  const nextAssignments = draft.assignmentInserts.filter((assignment) => assignment.examId !== examId);
  const replacementAssignments = candidate.allocation.map(({ room, proctor }) => ({
    scheduleId: 'preview',
    examId,
    roomId: room.id,
    proctorId: proctor.id,
    timeSlotId: candidate.slot.id,
  }));
  const nextCandidateScores = draft.candidateScores.filter((score) => score.examId !== examId);

  return {
    ...draft,
    assignmentInserts: [...nextAssignments, ...replacementAssignments],
    candidateScores: [
      ...nextCandidateScores,
      {
        examId,
        timeSlotId: candidate.slot.id,
        roomIds: candidate.allocation.map(({ room }) => room.id),
        proctorIds: candidate.allocation.map(({ proctor }) => proctor.id),
        softPenalty: candidate.softPenalty,
      },
    ],
  };
};

const optimizeDraftWithLocalSearch = ({ normalized, draft, originalEvaluation }) => {
  if (draft.conflictInserts.length > 0 || draft.scheduledExamIds.length !== normalized.exams.length) {
    return { preview: withQualityEvaluation(normalized, draft, originalEvaluation), repairs: [] };
  }

  const slotDayKeys = buildSlotDayKeyMap(normalized.timeSlots);
  const sortedRooms = sortRoomsByCapacityDesc(normalized.rooms);
  const examById = new Map(normalized.exams.map((exam) => [exam.id, exam]));
  const mutableExams = [...normalized.exams]
    .sort((a, b) => (draft.candidateScores.find((score) => score.examId === b.id)?.softPenalty ?? 0)
      - (draft.candidateScores.find((score) => score.examId === a.id)?.softPenalty ?? 0))
    .slice(0, LOCAL_SEARCH_EXAM_LIMIT);

  let bestDraft = withQualityEvaluation(normalized, draft, originalEvaluation);
  const repairs = [];

  for (const exam of mutableExams) {
    const currentScore = bestDraft.qualityEvaluation.score;
    const usage = createUsageFromDraft({ normalized, draft: bestDraft, excludedExamId: exam.id });
    const candidates = buildValidCandidatesForExam({
      exam,
      timeSlots: normalized.timeSlots,
      sortedRooms,
      proctors: normalized.proctors,
      usage,
      slotDayKeys,
      strategy: { id: 'local-search-nearby' },
    }).slice(0, LOCAL_SEARCH_CANDIDATE_LIMIT);

    for (const candidate of candidates) {
      const candidateDraft = replaceExamAssignments({ draft: bestDraft, examId: exam.id, candidate });
      const hardIssues = confirmHybridDraft({ draft: candidateDraft, normalized });
      if (hardIssues.length > 0) continue;

      const evaluatedDraft = withQualityEvaluation(normalized, candidateDraft, originalEvaluation);
      if (evaluatedDraft.qualityEvaluation.score > bestDraft.qualityEvaluation.score) {
        repairs.push({
          examId: exam.id,
          fromScore: currentScore,
          toScore: evaluatedDraft.qualityEvaluation.score,
          improvement: roundMetric(evaluatedDraft.qualityEvaluation.score - currentScore),
        });
        bestDraft = evaluatedDraft;
        break;
      }
    }
  }

  return { preview: bestDraft, repairs };
};

const BLOCKING_CATEGORY_BY_CONFLICT_TYPE = {
  ROOM_OVERCAPACITY: 'capacity',
  STUDENT_OVERLAP: 'studentOverlapRisks',
  PROCTOR_DOUBLE_BOOKED: 'proctors',
  RESOURCE_UNAVAILABLE: 'proctors',
  TIME_CONSTRAINT_VIOLATION: 'timeSlots',
};

const EMPTY_CONSTRAINT_PREVIEW = {
  assignmentInserts: [],
  conflictInserts: [],
  scheduledExamIds: [],
  candidateScores: [],
  softPenalty: 0,
  hardConstraintViolations: 0,
  strategyId: 'required-data-validation',
  strategyLabel: 'Required data validation',
};

const buildConstraintPreview = (normalized) => {
  return buildHybridDraft({
    scheduleId: 'preview',
    exams: normalized.exams,
    rooms: normalized.rooms,
    proctors: normalized.proctors,
    timeSlots: normalized.timeSlots,
    existingAssignments: normalized.existingAssignments,
    lookups: normalized.lookups,
  });
};

const OPTIMIZATION_STRATEGIES = [
  {
    id: 'largest-room-first',
    label: 'Capacity-first room selection',
    examComparator: compareExamsForScheduling,
    roomSorter: sortRoomsByCapacityDesc,
    earlyStopOnPerfectCandidate: true,
  },
  {
    id: 'latest-slot-first',
    label: 'Later-slot balancing',
    examComparator: compareExamsForScheduling,
    roomSorter: sortRoomsByCapacityDesc,
    earlyStopOnPerfectCandidate: true,
  },
  {
    id: 'least-constrained-first',
    label: 'Least-constrained local reordering',
    examComparator: compareExamsLeastConstrainedFirst,
    roomSorter: sortRoomsByCapacityDesc,
  },
  {
    id: 'priority-balance',
    label: 'High-priority protection',
    examComparator: compareExamsPriorityFirst,
    roomSorter: sortRoomsByCapacityDesc,
    earlyStopOnPerfectCandidate: true,
  },
  {
    id: 'midpoint-balance',
    label: 'Midpoint slot balance',
    examComparator: compareExamsShortestFirst,
    roomSorter: sortRoomsByCapacityAsc,
  },
];

const pickBetterConstraintPreview = (left, right) => {
  if (!left) return right;
  if (!right) return left;
  if (right.conflictInserts.length < left.conflictInserts.length) return right;
  if (right.conflictInserts.length > left.conflictInserts.length) return left;
  if (right.scheduledExamIds.length > left.scheduledExamIds.length) return right;
  if ((right.qualityEvaluation?.score ?? 0) > (left.qualityEvaluation?.score ?? 0)) return right;
  if ((right.softPenalty ?? 0) < (left.softPenalty ?? 0)) return right;
  return left;
};

const optimizeHybridDraft = (normalized) => {
  const attemptedStrategies = [];
  const originalDraft = buildConstraintPreview(normalized);
  const originalEvaluation = evaluateDraftSchedule({ normalized, draft: originalDraft });
  let bestPreview = withQualityEvaluation(normalized, originalDraft, originalEvaluation);
  let bestStrategy = {
    id: 'greedy-priority-csp',
    label: 'Greedy priority CSP draft',
  };

  for (const strategy of OPTIMIZATION_STRATEGIES) {
    attemptedStrategies.push(strategy.label);
    const preview = withQualityEvaluation(normalized, buildHybridDraft({
      scheduleId: 'preview',
      exams: normalized.exams,
      rooms: normalized.rooms,
      proctors: normalized.proctors,
      timeSlots: normalized.timeSlots,
      existingAssignments: normalized.existingAssignments,
      lookups: normalized.lookups,
      strategy,
    }), originalEvaluation);

    const betterPreview = pickBetterConstraintPreview(bestPreview, preview);
    if (betterPreview !== bestPreview) {
      bestPreview = preview;
      bestStrategy = strategy;
    }

    if (preview.conflictInserts.length === 0 && preview.qualityEvaluation?.score === 100) break;
  }

  let localSearchRepairs = [];
  if (bestPreview.conflictInserts.length === 0 && bestPreview.scheduledExamIds.length === normalized.exams.length) {
    attemptedStrategies.push('Assignment-level local search');
    const localSearch = optimizeDraftWithLocalSearch({
      normalized,
      draft: bestPreview,
      originalEvaluation,
    });
    bestPreview = localSearch.preview;
    localSearchRepairs = localSearch.repairs;
  }

  const beforeScore = originalEvaluation.score;
  const afterScore = bestPreview.qualityEvaluation?.score ?? beforeScore;
  const improvementPercentage = roundMetric(afterScore - beforeScore);

  return {
    attemptedStrategies,
    optimized: bestPreview.conflictInserts.length === 0,
    preview: bestPreview,
    strategy: bestStrategy,
    localSearchRepairs,
    evaluation: {
      beforeOptimization: originalEvaluation,
      afterOptimization: bestPreview.qualityEvaluation,
      improvementPercentage,
      improvementLabel: `${improvementPercentage >= 0 ? '+' : ''}${improvementPercentage}% Improved`,
      weakAreas: originalEvaluation.weakAreas,
      qualityMetrics: bestPreview.qualityEvaluation?.qualityMetrics ?? originalEvaluation.qualityMetrics,
    },
  };
};

const confirmHybridDraft = ({ draft, normalized }) => {
  const issues = [];
  const examById = new Map(normalized.exams.map((exam) => [exam.id, exam]));
  const roomById = new Map(normalized.rooms.map((room) => [room.id, room]));
  const proctorById = new Map(normalized.proctors.map((proctor) => [proctor.id, proctor]));
  const slotById = new Map(normalized.timeSlots.map((slot) => [slot.id, slot]));
  const roomTimeMap = new Map();
  const roomTimeRangeMap = new Map();
  const proctorTimeMap = new Map();
  const proctorTimeRangeMap = new Map();
  const studentTimeMap = new Map();
  const studentTimeRangeMap = new Map();
  const studentDayExamMap = new Map();
  const proctorDayExamMap = new Map();
  const examSlotCapacity = new Map();
  const examSlotProctors = new Map();

  const hasDraftTemporalOverlap = (rangeMap, entityId, slot, examId) => {
    if (!slot.startTime || !slot.endTime) return false;
    return (rangeMap.get(entityId) ?? []).some((range) => (
      range.examId !== examId && timeRangesOverlap(slot.startTime, slot.endTime, range.start, range.end)
    ));
  };

  const addDraftTimeRange = (rangeMap, entityId, slot, examId) => {
    if (!slot.startTime || !slot.endTime) return;
    const ranges = rangeMap.get(entityId) ?? [];
    ranges.push({ start: slot.startTime, end: slot.endTime, examId });
    rangeMap.set(entityId, ranges);
  };

  if (draft.conflictInserts.length > 0) {
    issues.push('The optimized draft still contains blocking hard-constraint issues.');
  }

  if (new Set(draft.scheduledExamIds).size !== normalized.exams.length) {
    issues.push('The optimized draft does not assign every active exam.');
  }

  for (const assignment of draft.assignmentInserts) {
    const exam = examById.get(assignment.examId);
    const room = roomById.get(assignment.roomId);
    const proctor = proctorById.get(assignment.proctorId);
    const slot = slotById.get(assignment.timeSlotId);
    if (!exam || !room || !proctor || !slot) {
      issues.push('The optimized draft references a missing exam, room, proctor, or time slot.');
      continue;
    }

    const slotDayKey = toDateKey(slot.date ?? slot.startTime);

    if (exam.studentCount <= 0 || exam.studentIds.length === 0) {
      issues.push('An exam without enrollments is present in the optimized draft.');
    }

    if (!canSlotFitExam(slot, exam)) {
      issues.push('A selected time slot does not fit the exam duration or has invalid dates.');
    }

    if (room.status !== 'AVAILABLE') {
      issues.push('A selected room is not available.');
    }

    if (room.centerId !== proctor.centerId) {
      issues.push('A selected proctor is assigned outside the room center.');
    }

    if (!proctor.availableTimeSlotIds?.has(slot.id)) {
      issues.push('A selected proctor is not available in the assigned time slot.');
    }

    const roomTimeKey = `${assignment.roomId}:${assignment.timeSlotId}`;
    const priorRoomExamId = roomTimeMap.get(roomTimeKey);
    if (priorRoomExamId && priorRoomExamId !== assignment.examId) {
      issues.push('A room is assigned to more than one exam in the same time slot.');
    }
    if (hasDraftTemporalOverlap(roomTimeRangeMap, assignment.roomId, slot, assignment.examId)) {
      issues.push('A room is assigned to overlapping exam times.');
    }
    roomTimeMap.set(roomTimeKey, assignment.examId);
    addDraftTimeRange(roomTimeRangeMap, assignment.roomId, slot, assignment.examId);

    const proctorTimeKey = `${assignment.proctorId}:${assignment.timeSlotId}`;
    const priorProctorExamId = proctorTimeMap.get(proctorTimeKey);
    if (priorProctorExamId && priorProctorExamId !== assignment.examId) {
      issues.push('A proctor is assigned to more than one exam in the same time slot.');
    }
    if (hasDraftTemporalOverlap(proctorTimeRangeMap, assignment.proctorId, slot, assignment.examId)) {
      issues.push('A proctor is assigned to overlapping exam times.');
    }
    proctorTimeMap.set(proctorTimeKey, assignment.examId);
    addDraftTimeRange(proctorTimeRangeMap, assignment.proctorId, slot, assignment.examId);

    const proctorDayKey = `${assignment.proctorId}:${slotDayKey}`;
    const proctorDaySet = proctorDayExamMap.get(proctorDayKey) ?? new Set();
    proctorDaySet.add(assignment.examId);
    proctorDayExamMap.set(proctorDayKey, proctorDaySet);
    if (proctorDaySet.size > proctor.maxExamsPerDay) {
      issues.push('A proctor exceeds their maximum exams per day.');
    }

    const examSlotKey = `${assignment.examId}:${assignment.timeSlotId}`;
    const capacityGroup = examSlotCapacity.get(examSlotKey) ?? { roomIds: new Set(), capacity: 0, requiredSeats: exam.requiredSeats };
    if (!capacityGroup.roomIds.has(room.id)) {
      capacityGroup.roomIds.add(room.id);
      capacityGroup.capacity += room.capacity;
    }
    examSlotCapacity.set(examSlotKey, capacityGroup);
    const proctorGroup = examSlotProctors.get(examSlotKey) ?? new Set();
    proctorGroup.add(assignment.proctorId);
    examSlotProctors.set(examSlotKey, proctorGroup);

    for (const studentId of exam.studentIds) {
      const studentTimeKey = `${studentId}:${assignment.timeSlotId}`;
      const priorStudentExamId = studentTimeMap.get(studentTimeKey);
      if (priorStudentExamId && priorStudentExamId !== assignment.examId) {
        issues.push('A student has more than one exam in the same time slot.');
      }
      if (hasDraftTemporalOverlap(studentTimeRangeMap, studentId, slot, assignment.examId)) {
        issues.push('A student is assigned to overlapping exam times.');
      }
      studentTimeMap.set(studentTimeKey, assignment.examId);
      addDraftTimeRange(studentTimeRangeMap, studentId, slot, assignment.examId);

      const studentDayKey = `${studentId}:${slotDayKey}`;
      const studentDaySet = studentDayExamMap.get(studentDayKey) ?? new Set();
      studentDaySet.add(assignment.examId);
      studentDayExamMap.set(studentDayKey, studentDaySet);
      if (studentDaySet.size > MAX_STUDENT_EXAMS_PER_DAY) {
        issues.push('A student exceeds the maximum exams per day.');
      }
    }
  }

  for (const [examSlotKey, { capacity, requiredSeats }] of examSlotCapacity.entries()) {
    if (capacity < requiredSeats) {
      issues.push('An exam assignment does not meet required room capacity.');
    }
    const [examId] = examSlotKey.split(':');
    const exam = examById.get(examId);
    if (exam && (examSlotProctors.get(examSlotKey)?.size ?? 0) < getRequiredProctorsForExam(exam)) {
      issues.push('An exam assignment does not meet the required proctor count.');
    }
  }

  return dedupeIssues(issues);
};

const buildBlockingIssuesFromConflicts = (conflictInserts = []) => {
  const grouped = {};

  for (const conflict of conflictInserts) {
    const key = BLOCKING_CATEGORY_BY_CONFLICT_TYPE[conflict.type] ?? 'capacity';
    if (!grouped[key]) grouped[key] = [];
    if (!grouped[key].includes(conflict.description)) {
      grouped[key].push(conflict.description);
    }
  }

  return grouped;
};

const dedupeIssues = (issues = []) => [...new Set(issues.filter(Boolean))];

const collectPreValidationState = async ({ normalized, semester, constraintPreview = null, includeConstraintPreview = true }) => {
  const groups = {
    rooms: [],
    proctors: [],
    timeSlots: [],
    courseOfferings: [],
    enrollments: [],
    studentOverlapRisks: [],
  };
  const warnings = [];

  if (normalized.rooms.length === 0) {
    groups.rooms.push('No rooms are marked as Available. Mark at least one room as Available before generating.');
  }

  if (normalized.proctors.length === 0) {
    groups.proctors.push('No proctors are registered. Add at least one proctor before generating.');
  }

  if (normalized.timeSlots.length === 0) {
    const semRange = `${fmtDate(semester.startDate)} – ${fmtDate(semester.endDate)}`;
    groups.timeSlots.push(
      `No time slots fall within the "${semester.name}" period (${semRange}). Create time slots with dates inside this range.`,
    );
  }

  if (normalized.timeSlots.some((slot) => !hasValidTimeSlotWindow(slot))) {
    groups.timeSlots.push(
      'One or more time slots are invalid. Each time slot must have a valid date, start time, end time, and positive duration before generating.',
    );
  }

  if (normalized.exams.length === 0) {
    groups.courseOfferings.push(`No active course offerings found for "${semester.name}". Activate or add offerings for this semester.`);
  }

  const emptyOfferings = normalized.exams.filter((exam) => exam.studentCount === 0);
  for (const exam of emptyOfferings) {
    const label = [exam.courseCode, exam.courseTitle].filter(Boolean).join(' — ') || 'an offering';
    groups.enrollments.push(`"${label}" has no enrolled students. Add at least one enrollment before generating.`);
  }

  const supervisedRooms = sortRoomsByCapacityDesc(normalized.rooms).slice(0, normalized.proctors.length);
  const supervisedCapacity = getTotalCapacity(supervisedRooms);

  if (normalized.proctors.length > 0 && normalized.rooms.length > 0 && supervisedCapacity === 0) {
    warnings.push('All available rooms report zero capacity. Resolve room setup before attempting generation.');
  }

  for (const exam of normalized.exams) {
    const examLabel = getExamLabel(exam);
    const fittingSlotCount = normalized.timeSlots.filter((slot) => canSlotFitExam(slot, exam)).length;
    if (fittingSlotCount === 0) {
      const courseLabel = [exam.courseCode, exam.courseTitle].filter(Boolean).join(' — ') || 'an offering';
      warnings.push(
        `"${courseLabel}" does not fit any currently valid time slot and will be reported as a blocking issue.`,
      );
    }

    const maxSlotCapacity = Math.max(0, ...normalized.lookups.timeslotCapacityMap.values());
    if (maxSlotCapacity < exam.requiredSeats) {
      groups.courseOfferings.push(`${examLabel} requires ${exam.requiredSeats} seats, but available room capacity supports at most ${maxSlotCapacity} seats in a time slot.`);
    }

    const requiredProctors = getRequiredProctorsForExam(exam);
    const maxProctorCoverage = normalized.timeSlots.reduce((max, slot) => {
      if (!canSlotFitExam(slot, exam)) return max;
      const availableCount = normalized.proctors.filter((proctor) => proctor.availableTimeSlotIds?.has(slot.id)).length;
      return Math.max(max, availableCount);
    }, 0);
    if (maxProctorCoverage < requiredProctors) {
      groups.proctors.push(`${examLabel} needs ${requiredProctors} proctor${requiredProctors !== 1 ? 's' : ''}, but the strongest valid time slot has only ${maxProctorCoverage} available proctor${maxProctorCoverage !== 1 ? 's' : ''}.`);
    }

    if (supervisedCapacity < exam.requiredSeats) {
      const courseLabel = [exam.courseCode, exam.courseTitle].filter(Boolean).join(' — ') || 'an offering';
      warnings.push(
        `"${courseLabel}" needs ${exam.requiredSeats} seats and ${requiredProctors} proctor${requiredProctors !== 1 ? 's' : ''} for ${exam.studentCount} enrolled student${exam.studentCount !== 1 ? 's' : ''}; current resources may be insufficient.`,
      );
    }
  }

  const allStudentIds = [...normalized.studentToExams.keys()];
  const studentUserMap = new Map();
  if (allStudentIds.length > 0) {
    const students = await prisma.student.findMany({
      where: { id: { in: allStudentIds } },
      select: { id: true, user: { select: { name: true, email: true } } },
    });
    for (const student of students) studentUserMap.set(student.id, student.user);
  }

  for (const [studentId, examIds] of normalized.studentToExams.entries()) {
    if (examIds.size > normalized.timeSlots.length && normalized.timeSlots.length > 0) {
      const user = studentUserMap.get(studentId);
      const studentLabel = user?.name
        ? user.email ? `${user.name} (${user.email})` : user.name
        : 'a student';
      warnings.push(
        `${studentLabel} has ${examIds.size} exams but only ${normalized.timeSlots.length} time slots in "${semester.name}".`,
      );
    }
  }

  const preview = includeConstraintPreview
    ? (constraintPreview ?? optimizeHybridDraft(normalized).preview)
    : EMPTY_CONSTRAINT_PREVIEW;
  const blockingIssues = includeConstraintPreview
    ? buildBlockingIssuesFromConflicts(preview.conflictInserts)
    : {};

  for (const [category, issues] of Object.entries(blockingIssues)) {
    if (category === 'proctors') {
      groups.proctors.push(...issues);
      continue;
    }
    if (category === 'timeSlots') {
      groups.timeSlots.push(...issues);
      continue;
    }
    if (category === 'studentOverlapRisks') {
      groups.studentOverlapRisks.push(...issues);
      continue;
    }
    groups.courseOfferings.push(...issues);
  }

  for (const key of Object.keys(groups)) {
    groups[key] = dedupeIssues(groups[key]);
  }

  return {
    groups,
    warnings: dedupeIssues(warnings),
    constraintPreview: preview,
  };
};

const buildValidationResponse = ({ normalized, semester, groups, warnings, constraintPreview, optimization = undefined }) => {
  const allIssues = [
    ...groups.rooms,
    ...groups.proctors,
    ...groups.timeSlots,
    ...groups.courseOfferings,
    ...groups.enrollments,
    ...groups.studentOverlapRisks,
  ];

  return {
    ready: allIssues.length === 0,
    isValid: allIssues.length === 0,
    semester: { name: semester.name },
    metrics: {
      roomsCount: normalized.rooms.length,
      proctorsCount: normalized.proctors.length,
      examsCount: normalized.exams.length,
      timeSlotsCount: normalized.timeSlots.length,
      studentsWithExamsCount: normalized.studentToExams.size,
      existingAssignmentsCount: normalized.existingAssignments.length,
      schedulableExamsCount: constraintPreview.scheduledExamIds.length,
      blockingIssuesCount: constraintPreview.conflictInserts.length,
      softPenalty: constraintPreview.softPenalty ?? 0,
      qualityScore: constraintPreview.qualityEvaluation?.score ?? 0,
    },
    algorithm: {
      type: HYBRID_ALGORITHM_TYPE,
      pipeline: PIPELINE_STAGES,
      strategy: constraintPreview.strategyLabel,
      usesBruteForce: false,
      lookupTables: [
        'studentExamMap',
        'proctorAvailabilityMap',
        'studentDailyLoadMap',
        'roomSlotMap',
        'studentTimeMap',
        'roomUsageMap',
        'roomAvailabilityMap',
        'timeslotCapacityMap',
      ],
    },
    warnings,
    errors: {
      ...(groups.rooms.length > 0 ? { rooms: groups.rooms } : {}),
      ...(groups.proctors.length > 0 ? { proctors: groups.proctors } : {}),
      ...(groups.timeSlots.length > 0 ? { timeSlots: groups.timeSlots } : {}),
      ...(groups.courseOfferings.length > 0 ? { courseOfferings: groups.courseOfferings } : {}),
      ...(groups.enrollments.length > 0 ? { enrollments: groups.enrollments } : {}),
      ...(groups.studentOverlapRisks.length > 0 ? { studentOverlapRisks: groups.studentOverlapRisks } : {}),
    },
    riskAnalysis: {
      blocking: constraintPreview.conflictInserts,
      blockingCount: constraintPreview.conflictInserts.length,
      schedulableExamsCount: constraintPreview.scheduledExamIds.length,
      totalExamsCount: normalized.exams.length,
      softPenalty: constraintPreview.softPenalty ?? 0,
      qualityEvaluation: constraintPreview.qualityEvaluation ?? null,
    },
    quality: {
      originalScore: constraintPreview.originalQualityEvaluation?.score ?? constraintPreview.qualityEvaluation?.score ?? 0,
      optimizedScore: constraintPreview.qualityEvaluation?.score ?? 0,
      weakAreas: constraintPreview.originalQualityEvaluation?.weakAreas ?? constraintPreview.qualityEvaluation?.weakAreas ?? [],
      qualityMetrics: constraintPreview.qualityEvaluation?.qualityMetrics ?? {},
    },
    groups: {
      rooms: { ok: groups.rooms.length === 0, issues: groups.rooms },
      proctors: { ok: groups.proctors.length === 0, issues: groups.proctors },
      timeSlots: { ok: groups.timeSlots.length === 0, issues: groups.timeSlots },
      courseOfferings: { ok: groups.courseOfferings.length === 0, issues: groups.courseOfferings },
      enrollments: { ok: groups.enrollments.length === 0, issues: groups.enrollments },
      studentOverlapRisks: { ok: groups.studentOverlapRisks.length === 0, issues: groups.studentOverlapRisks },
    },
    issues: allIssues,
    ...(optimization ? { optimization } : {}),
  };
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
      proctors: normalized.proctors.length,
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
  const { groups: g, warnings, constraintPreview } = await collectPreValidationState({
    normalized,
    semester,
    includeConstraintPreview: false,
  });

  return buildValidationResponse({
    normalized,
    semester,
    groups: g,
    warnings,
    constraintPreview,
  });
};

export const optimizeScheduling = async (data) => {
  const { normalized, semester } = await fetchSchedulingData(data.semesterId);
  const baseState = await collectPreValidationState({ normalized, semester, includeConstraintPreview: false });

  const requiredDataIssueCount = [
    ...baseState.groups.rooms,
    ...baseState.groups.proctors,
    ...baseState.groups.timeSlots,
    ...baseState.groups.courseOfferings,
    ...baseState.groups.enrollments,
  ].length;

  if (requiredDataIssueCount > 0) {
    return buildValidationResponse({
      normalized,
      semester,
      groups: baseState.groups,
      warnings: baseState.warnings,
      constraintPreview: EMPTY_CONSTRAINT_PREVIEW,
      optimization: {
        attempted: false,
        optimized: false,
        attemptedStrategies: [],
        message: 'Optimization cannot proceed because required data validation already shows the schedule is impossible with the current resources.',
      },
    });
  }

  const optimizationAttempt = optimizeHybridDraft(normalized);
  const nextState = await collectPreValidationState({
    normalized,
    semester,
    constraintPreview: optimizationAttempt.preview,
  });

  return buildValidationResponse({
    normalized,
    semester,
    groups: nextState.groups,
    warnings: nextState.warnings,
    constraintPreview: nextState.constraintPreview,
    optimization: {
      attempted: true,
      optimized: optimizationAttempt.optimized,
      strategy: optimizationAttempt.strategy.label,
      attemptedStrategies: optimizationAttempt.attemptedStrategies,
      softPenalty: optimizationAttempt.preview.softPenalty ?? 0,
      beforeScore: optimizationAttempt.evaluation.beforeOptimization.score,
      afterScore: optimizationAttempt.evaluation.afterOptimization?.score ?? optimizationAttempt.evaluation.beforeOptimization.score,
      beforeQualityMetrics: optimizationAttempt.evaluation.beforeOptimization.qualityMetrics,
      improvementPercentage: optimizationAttempt.evaluation.improvementPercentage,
      improvementLabel: optimizationAttempt.evaluation.improvementLabel,
      weakAreas: optimizationAttempt.evaluation.weakAreas,
      qualityMetrics: optimizationAttempt.evaluation.qualityMetrics,
      localSearchRepairs: optimizationAttempt.localSearchRepairs,
      message: optimizationAttempt.optimized
        ? `Optimization confirmed a clean allocation using: ${optimizationAttempt.strategy.label}. Before: ${optimizationAttempt.evaluation.beforeOptimization.score}%. After: ${optimizationAttempt.evaluation.afterOptimization?.score ?? optimizationAttempt.evaluation.beforeOptimization.score}%. ${optimizationAttempt.evaluation.improvementLabel}`
        : `Optimization evaluated ${optimizationAttempt.attemptedStrategies.length} bounded strateg${optimizationAttempt.attemptedStrategies.length === 1 ? 'y' : 'ies'} but blocking issues remain.`,
    },
  });
};

export const generateSchedule = async (data) => {
  const { semesterId, scheduleName } = data;
  const { normalized, semester } = await fetchSchedulingData(semesterId);

  if (
    normalized.rooms.length === 0
    || normalized.proctors.length === 0
    || normalized.timeSlots.length === 0
    || normalized.exams.length === 0
  ) {
    throw new AppError(NO_VALID_SCHEDULE_MESSAGE, 400);
  }

  const requiredDataState = await collectPreValidationState({
    normalized,
    semester,
    includeConstraintPreview: false,
  });
  const requiredDataBlockingIssueCount = [
    ...requiredDataState.groups.rooms,
    ...requiredDataState.groups.proctors,
    ...requiredDataState.groups.timeSlots,
    ...requiredDataState.groups.courseOfferings,
    ...requiredDataState.groups.enrollments,
  ].length;

  if (requiredDataBlockingIssueCount > 0) {
    throw new AppError(NO_VALID_SCHEDULE_MESSAGE, 400);
  }

  const optimizationAttempt = optimizeHybridDraft(normalized);
  const { groups, constraintPreview } = await collectPreValidationState({
    normalized,
    semester,
    constraintPreview: optimizationAttempt.preview,
  });
  const blockingIssueCount = [
    ...groups.rooms,
    ...groups.proctors,
    ...groups.timeSlots,
    ...groups.courseOfferings,
    ...groups.enrollments,
    ...groups.studentOverlapRisks,
  ].length;

  const effectivePreview = constraintPreview;
  const remainingBlockingIssueCount = blockingIssueCount;

  if (remainingBlockingIssueCount > 0 || effectivePreview.conflictInserts.length > 0) {
    throw new AppError(NO_VALID_SCHEDULE_MESSAGE, 400);
  }

  if (effectivePreview.scheduledExamIds.length !== normalized.exams.length) {
    throw new AppError(
      NO_VALID_SCHEDULE_MESSAGE,
      400,
    );
  }

  const confirmationIssues = confirmHybridDraft({ draft: effectivePreview, normalized });
  if (confirmationIssues.length > 0) {
    throw new AppError(NO_VALID_SCHEDULE_MESSAGE, 400);
  }

  const result = await prisma.$transaction(async (tx) => {
    const draftExamIdToPersistedId = new Map(
      normalized.exams
        .filter((exam) => exam.persistedExamId)
        .map((exam) => [exam.id, exam.persistedExamId]),
    );
    const missingExamDrafts = normalized.exams.filter((exam) => !exam.persistedExamId);
    for (const exam of missingExamDrafts) {
      const createdExam = await tx.exam.create({
        data: {
          courseOfferingId: exam.courseOfferingId,
          status: 'DRAFT',
          duration: exam.duration ?? DEFAULT_EXAM_DURATION,
        },
      });
      draftExamIdToPersistedId.set(exam.id, createdExam.id);
    }

    const schedule = await tx.schedule.create({
      data: {
        name: scheduleName,
        isFinal: false,
        algorithmType: HYBRID_ALGORITHM_TYPE,
        generationStage: GENERATION_STAGE.GENERATED,
        qualityScore: effectivePreview.qualityEvaluation?.score ?? Math.max(0, 100 - (effectivePreview.softPenalty ?? 0)),
        hardConstraintScore: 0,
        softConstraintScore: Math.round(effectivePreview.softPenalty ?? 0),
        algorithmMetadata: {
          pipeline: PIPELINE_STAGES,
          strategy: effectivePreview.strategyLabel,
          attemptedStrategies: optimizationAttempt.attemptedStrategies,
          lookupTables: [
            'studentExamMap',
            'proctorAvailabilityMap',
            'studentDailyLoadMap',
            'roomSlotMap',
            'studentTimeMap',
            'roomUsageMap',
            'roomAvailabilityMap',
            'timeslotCapacityMap',
          ],
          bruteForce: false,
          createdExamCount: missingExamDrafts.length,
          evaluation: optimizationAttempt.evaluation,
          localSearchRepairs: optimizationAttempt.localSearchRepairs,
        },
      },
    });

    const assignmentInserts = effectivePreview.assignmentInserts.map((assignment) => ({
      ...assignment,
      scheduleId: schedule.id,
      examId: draftExamIdToPersistedId.get(assignment.examId) ?? assignment.examId,
    }));
    const scheduledExamIds = [...effectivePreview.scheduledExamIds]
      .map((examId) => draftExamIdToPersistedId.get(examId) ?? examId);

    if (assignmentInserts.length > 0) {
      await tx.examAssignment.createMany({ data: assignmentInserts });
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

    return {
      fullSchedule,
      assignmentInserts,
      scheduledExamIds,
    };
  });

  const { fullSchedule, assignmentInserts } = result;

  return {
    scheduleId: fullSchedule.id,
    scheduleName,
    schedule: fullSchedule,
    assignmentsCount: assignmentInserts.length,
    message: 'Schedule generated successfully by the hybrid constraint-based engine with all hard constraints satisfied.',
    algorithm: {
      type: HYBRID_ALGORITHM_TYPE,
      pipeline: PIPELINE_STAGES,
      strategy: effectivePreview.strategyLabel,
      softPenalty: effectivePreview.softPenalty ?? 0,
      beforeScore: optimizationAttempt.evaluation.beforeOptimization.score,
      afterScore: optimizationAttempt.evaluation.afterOptimization?.score ?? optimizationAttempt.evaluation.beforeOptimization.score,
      improvementPercentage: optimizationAttempt.evaluation.improvementPercentage,
      improvementLabel: optimizationAttempt.evaluation.improvementLabel,
      weakAreas: optimizationAttempt.evaluation.weakAreas,
      qualityMetrics: optimizationAttempt.evaluation.qualityMetrics,
    },
  };
};

export const getScheduleAnalysis = async (scheduleId) => {
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
                  registrations: { select: { studentId: true } },
                },
              },
            },
          },
          room: true,
          proctor: { include: { user: { select: { id: true, name: true, email: true } } } },
          timeSlot: true,
        },
      },
    },
  });

  if (!schedule) throw new AppError('Schedule not found', 404);

  const studentSlotSeen = new Map();
  const roomCapacityViolations = [];
  const roomReuseViolations = [];
  const proctorCollisions = [];
  const studentOverlaps = [];
  const roomSlotCount = new Map();
  const proctorSlotExamIds = new Map();
  const proctorDayExamIds = new Map();
  const proctorDailyLoadViolations = [];
  const examSlotCapacity = new Map();

  // Build a map of proctors for quick lookup
  const proctorMap = new Map();
  for (const assignment of schedule.assignments) {
    if (!proctorMap.has(assignment.proctorId)) {
      proctorMap.set(assignment.proctorId, assignment.proctor);
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

    const proctorSlotKey = `${assignment.proctorId}:${assignment.timeSlotId}`;
    const proctorSlotGroup = proctorSlotExamIds.get(proctorSlotKey) ?? new Set();
    proctorSlotGroup.add(assignment.examId);
    proctorSlotExamIds.set(proctorSlotKey, proctorSlotGroup);

    const proctorDayKey = `${assignment.proctorId}:${toDateKey(assignment.timeSlot.date ?? assignment.timeSlot.startTime)}`;
    const proctorDayGroup = proctorDayExamIds.get(proctorDayKey) ?? new Set();
    proctorDayGroup.add(assignment.examId);
    proctorDayExamIds.set(proctorDayKey, proctorDayGroup);

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

  for (const [key, examIds] of proctorSlotExamIds.entries()) {
    if (examIds.size > 1) {
      const [proctorId, timeSlotId] = key.split(':');
      proctorCollisions.push({ proctorId, timeSlotId, count: examIds.size, examIds: [...examIds] });
    }
  }

  for (const [key, examIds] of proctorDayExamIds.entries()) {
    const [proctorId, date] = key.split(':');
    const proctor = proctorMap.get(proctorId);
    const maxExamsPerDay = proctor?.maxExamsPerDay ?? 2;
    if (examIds.size > maxExamsPerDay) {
      proctorDailyLoadViolations.push({
        proctorId,
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
    proctorConflicts: proctorCollisions,
    proctorDailyLoadViolations,
    roomCapacityViolations,
  };

  const derivedConflictCount =
    studentOverlaps.length
    + roomReuseViolations.length
    + proctorCollisions.length
    + proctorDailyLoadViolations.length
    + roomCapacityViolations.length;
  const totalConflicts = derivedConflictCount;

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
      derivedConflicts: derivedConflictCount,
      totalConflicts,
      averageRoomUtilization: Number(utilization.toFixed(3)),
    },
    conflicts: {
      derived: derivedConflicts,
    },
  };
};

const getPublishedScheduleConflicts = async (scheduleId) => {
  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    include: {
      assignments: {
        include: {
          timeSlot: true,
          exam: {
            include: {
              courseOffering: {
                include: {
                  registrations: { select: { studentId: true } },
                  course: true,
                },
              },
            },
          },
          room: true,
          proctor: { include: { user: { select: { name: true } } } },
        },
      },
    },
  });

  if (!schedule) throw new AppError('Schedule not found', 404);

  const roomConflicts = [];
  const proctorConflicts = [];
  const studentConflicts = [];
  const seen = new Set();

  for (const assignment of schedule.assignments) {
    const studentIds = getUniqueStudentIdsForExam(assignment.exam);
    const clashes = await prisma.examAssignment.findMany({
      where: {
        scheduleId: { not: schedule.id },
        schedule: { isFinal: true },
        timeSlot: {
          startTime: { lt: assignment.timeSlot.endTime },
          endTime: { gt: assignment.timeSlot.startTime },
        },
        OR: [
          { roomId: assignment.roomId },
          { proctorId: assignment.proctorId },
          ...(studentIds.length > 0
            ? [{ exam: { courseOffering: { registrations: { some: { studentId: { in: studentIds } } } } } }]
            : []),
        ],
      },
      select: {
        id: true,
        scheduleId: true,
        roomId: true,
        proctorId: true,
        exam: {
          select: {
            courseOffering: {
              select: {
                course: { select: { code: true, title: true } },
                registrations: {
                  where: { studentId: { in: studentIds } },
                  select: { studentId: true },
                },
              },
            },
          },
        },
      },
    });

    for (const clash of clashes) {
      const baseKey = `${assignment.id}:${clash.id}`;
      if (clash.roomId === assignment.roomId && !seen.has(`${baseKey}:room`)) {
        seen.add(`${baseKey}:room`);
        roomConflicts.push({ assignmentId: assignment.id, publishedAssignmentId: clash.id, scheduleId: clash.scheduleId, roomId: assignment.roomId });
      }
      if (clash.proctorId === assignment.proctorId && !seen.has(`${baseKey}:proctor`)) {
        seen.add(`${baseKey}:proctor`);
        proctorConflicts.push({ assignmentId: assignment.id, publishedAssignmentId: clash.id, scheduleId: clash.scheduleId, proctorId: assignment.proctorId });
      }
      const overlappingStudents = (clash.exam?.courseOffering?.registrations ?? []).map((registration) => registration.studentId);
      if (overlappingStudents.length > 0 && !seen.has(`${baseKey}:student`)) {
        seen.add(`${baseKey}:student`);
        studentConflicts.push({ assignmentId: assignment.id, publishedAssignmentId: clash.id, scheduleId: clash.scheduleId, studentIds: overlappingStudents });
      }
    }
  }

  return {
    roomConflicts,
    proctorConflicts,
    studentConflicts,
    total: roomConflicts.length + proctorConflicts.length + studentConflicts.length,
  };
};

export const publishSchedule = async (scheduleId) => {
  const existing = await prisma.schedule.findUnique({
    where: { id: scheduleId },
  });

  if (!existing) throw new AppError('Schedule not found', 404);

  const analysis = await getScheduleAnalysis(scheduleId);
  if (analysis.metrics.totalConflicts > 0) {
    throw new AppError('Cannot publish schedule while hard-constraint issues still exist', 400);
  }

  const publishedConflicts = await getPublishedScheduleConflicts(scheduleId);
  if (publishedConflicts.total > 0) {
    throw new AppError('Cannot publish schedule because it conflicts with an existing published schedule.', 400);
  }

  const schedule = await prisma.schedule.update({
    where: { id: scheduleId },
    data: { isFinal: true },
  });

  return { message: 'Schedule published successfully', schedule };
};