import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';
import {
  createSchedulePublicationNotifications,
  NOTIFICATION_TYPES,
} from '../notifications/notificationsService.js';
import { extractAvailableTimeSlotIds } from '../proctors/proctorAvailability.js';
import {
  assertScheduleNameAvailable,
  remapScheduleNameConflict,
} from '../schedules/scheduleNameService.js';

const DEFAULT_EXAM_DURATION = 120;
const MAX_STUDENT_EXAMS_PER_DAY = 2;
const DEFAULT_MAX_PROCTOR_ASSIGNMENTS_PER_DAY = 2;

const UNLIMITED_DAILY_LOAD = 999;
const resetSchedulingState = async () => {
};

const getEffectiveExamDuration = (examDuration = null) => (
  examDuration ?? DEFAULT_EXAM_DURATION
);

const computeRequiredProctors = (studentCount) => {
  const count = Number(studentCount ?? 0);

  if (!Number.isFinite(count) || count <= 0) return 1;
  return Math.max(1, Math.ceil(count / 20));
};

const getRequiredProctorsFromCount = (studentCount) => computeRequiredProctors(studentCount);
const MIN_MEANINGFUL_MOVE_GAIN = 0.35;
const MAX_NON_GREEDY_SCORE_DROP = 0.8;
const CANDIDATE_PENALTY_WEIGHTS = {
  unusedRoomSeats: 0.25,
  roomCount: 0.20,
  proctorWorkload: 0.20,
  studentDailyLoad: 0.20,
  roomCenterSpread: 0.15,
};
const LIGHTWEIGHT_REFINEMENT_LIMITS = {
  maxRefinementPasses: 2,
  maxMovesPerExam: 3,
  maxChangedExams: 20,
  timeBudgetMs: 8000,
};
const MAX_CANDIDATE_ROOM_SETS = 12;
const EXAM_PRIORITY_BAND = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  NORMAL: 'NORMAL',
};
const EXAM_PRIORITY_BAND_RANK = {
  [EXAM_PRIORITY_BAND.CRITICAL]: 3,
  [EXAM_PRIORITY_BAND.HIGH]: 2,
  [EXAM_PRIORITY_BAND.NORMAL]: 1,
};
const QUALITY_WEIGHTS = {
  roomUtilization: 0.25,
  proctorWorkloadBalance: 0.30,
  studentSpacing: 0.30,
  examDistribution: 0.15,
};
const WEAKEST_METRIC_PENALTY_WEIGHT = 0.18;
const HYBRID_ALGORITHM_TYPE = 'HYBRID_CONSTRAINT_BASED';
const NO_VALID_SCHEDULE_MESSAGE = 'No valid conflict-free schedule exists for the current data/resources.';
const GENERATION_STAGE = {
  PREPARED: 'PREPARED',
  VALIDATED: 'VALIDATED',
  DRAFT_BUILT: 'DRAFT_BUILT',
  CONFIRMED: 'CONFIRMED',
  GENERATED: 'GENERATED',
  BLOCKED: 'BLOCKED',
};

const PIPELINE_STAGES = [
  'Loading Resources',
  'Validation',
  'Exam Sorting',
  'Candidate Filtering',
  'Choose Best Valid Candidate',
  'Reserve Candidate',
  'Final Validation',
  'Save Schedule',
];

// --- Per-semester in-memory caches -------------------------------------------
// Both caches have a short TTL (minutes) that covers the typical workflow:
//   prepareScheduling ? validateInput ? generateSchedule
// They are keyed by semesterId and cleared on use or expiry.

const NORMALIZED_DATA_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const _normalizedDataCache = new Map(); // semesterId ? { data, expiresAt }

const _cacheGet = (cache, key) => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.data;
};
const _cacheSet = (cache, key, data, ttl) => cache.set(key, { data, expiresAt: Date.now() + ttl });
const _cacheDel = (cache, key) => cache.delete(key);

const stableSerialize = (value) => {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(String(value));
};

const createDeterministicHash = (value, length = 16) => createHash('sha256')
  .update(stableSerialize(value))
  .digest('hex')
  .slice(0, length);

const buildNormalizedFingerprint = (normalized, semester = null) => createDeterministicHash({
  semesterId: semester?.id ?? null,
  semesterName: semester?.name ?? null,
  counts: {
    exams: normalized.exams.length,
    rooms: normalized.rooms.length,
    proctors: normalized.proctors.length,
    timeSlots: normalized.timeSlots.length,
    existingAssignments: normalized.existingAssignments.length,
    students: normalized.studentToExams?.size ?? 0,
  },
  examIds: [...normalized.exams].map((exam) => exam.id).sort(),
  roomIds: [...normalized.rooms].map((room) => room.id).sort(),
  proctorIds: [...normalized.proctors].map((proctor) => proctor.id).sort(),
  timeSlotIds: [...normalized.timeSlots].map((slot) => slot.id).sort(),
});

const buildDraftFingerprint = (draft) => createDeterministicHash(
  [...draft.assignmentInserts]
    .map((assignment) => ({
      examId: assignment.examId,
      roomId: assignment.roomId,
      proctorId: assignment.proctorId,
      timeSlotId: assignment.timeSlotId,
    }))
    .sort((left, right) => (
      left.examId.localeCompare(right.examId)
      || left.timeSlotId.localeCompare(right.timeSlotId)
      || left.roomId.localeCompare(right.roomId)
      || left.proctorId.localeCompare(right.proctorId)
    )),
);

const buildAssignmentDiffClassification = (before, after) => {
  if (!before || !after) return 'MULTI_CHANGE';
  const roomChanged = !sameIdList(before.roomIds, after.roomIds);
  const proctorChanged = !sameIdList(before.proctorIds, after.proctorIds);
  const timeslotChanged = !sameIdList(before.timeSlotIds, after.timeSlotIds);
  const dateChanged = before.date !== after.date;
  const durationChanged = before.duration !== after.duration;

  if (!roomChanged && !proctorChanged && !timeslotChanged && !dateChanged && !durationChanged) return 'NO_CHANGE';
  if (roomChanged && !proctorChanged && !timeslotChanged && !dateChanged && !durationChanged) return 'ROOM_ONLY';
  if (!roomChanged && proctorChanged && !timeslotChanged && !dateChanged && !durationChanged) return 'PROCTOR_ONLY';
  if (!roomChanged && !proctorChanged && timeslotChanged && !dateChanged && !durationChanged) return 'TIMESLOT_CHANGE';
  if (!roomChanged && !proctorChanged && dateChanged && !durationChanged) return 'DATE_CHANGE';
  return 'MULTI_CHANGE';
};

const buildAssignmentDiffs = (normalized, beforeDraft, afterDraft) => {
  const beforeIds = [...new Set(beforeDraft.assignmentInserts.map((assignment) => assignment.examId))];
  const afterIds = [...new Set(afterDraft.assignmentInserts.map((assignment) => assignment.examId))];
  const trackedExamIds = [...new Set([...beforeIds, ...afterIds])];
  const beforeSnapshots = buildMoveSnapshots(normalized, beforeDraft, trackedExamIds);
  const afterSnapshots = buildMoveSnapshots(normalized, afterDraft, trackedExamIds);

  return trackedExamIds.map((examId, index) => {
    const before = beforeSnapshots[index] ?? null;
    const after = afterSnapshots[index] ?? null;
    const classification = buildAssignmentDiffClassification(before, after);
    const changed = classification !== 'NO_CHANGE';

    return changed ? {
      examId,
      examLabel: after?.examLabel ?? before?.examLabel ?? examId,
      classification,
      before,
      after,
      timingChanged: Boolean(before && after && (
        before.date !== after.date
        || before.timeslot !== after.timeslot
        || before.duration !== after.duration
      )),
    } : null;
  }).filter(Boolean);
};

const buildStudentSpacingContributionIndex = (normalized, draft) => {
  const examById = new Map(normalized.exams.map((exam) => [exam.id, exam]));
  const slotById = new Map(normalized.timeSlots.map((slot) => [slot.id, slot]));
  const studentSlotEntries = new Map();

  for (const assignment of draft.assignmentInserts) {
    const exam = examById.get(assignment.examId);
    const slot = slotById.get(assignment.timeSlotId);
    if (!exam || !slot) continue;
    for (const studentId of exam.studentIds) {
      if (!studentSlotEntries.has(studentId)) studentSlotEntries.set(studentId, []);
      studentSlotEntries.get(studentId).push({
        studentId,
        examId: exam.id,
        examLabel: exam.courseOffering?.course?.code ?? exam.courseOffering?.course?.title ?? exam.id,
        timeSlotId: slot.id,
        startTime: new Date(slot.startTime),
        endTime: new Date(slot.endTime),
        date: toDateKey(slot.date ?? slot.startTime),
      });
    }
  }

  const pairContributions = [];
  const aggregateByExamPair = new Map();

  for (const [studentId, slots] of studentSlotEntries.entries()) {
    const orderedSlots = [...slots].sort((left, right) => left.startTime - right.startTime);
    for (let leftIndex = 0; leftIndex < orderedSlots.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < orderedSlots.length; rightIndex += 1) {
        const left = orderedSlots[leftIndex];
        const right = orderedSlots[rightIndex];
        const gapDays = getDayDistance(left.startTime, right.startTime);
        const minuteGap = gapDays >= 1 ? null : getMinuteDistance(left, right);
        const penalty = gapDays >= 1 ? 0 : (minuteGap <= 30 ? 100 : 70);
        const preferredGapSatisfied = gapDays >= 1;
        const backToBack = !preferredGapSatisfied && minuteGap <= 30;
        const examIds = [left.examId, right.examId].sort();
        const aggregateKey = examIds.join('::');
        const contribution = {
          studentId,
          examIds,
          examLabels: [left.examLabel, right.examLabel],
          left,
          right,
          gapDays,
          minuteGap,
          penalty,
          preferredGapSatisfied,
          backToBack,
          aggregateKey,
        };

        pairContributions.push(contribution);
        const aggregate = aggregateByExamPair.get(aggregateKey) ?? {
          aggregateKey,
          examIds,
          examLabels: [left.examLabel, right.examLabel],
          totalPenalty: 0,
          studentCount: 0,
          sameDayPairCount: 0,
          backToBackPairCount: 0,
          preferredGapSatisfied: 0,
          studentExamples: [],
        };

        aggregate.totalPenalty += penalty;
        aggregate.studentCount += 1;
        if (preferredGapSatisfied) {
          aggregate.preferredGapSatisfied += 1;
        } else {
          aggregate.sameDayPairCount += 1;
          if (backToBack) aggregate.backToBackPairCount += 1;
        }
        if (aggregate.studentExamples.length < 3) {
          aggregate.studentExamples.push({
            studentId,
            leftExamId: left.examId,
            rightExamId: right.examId,
            gapDays,
            minuteGap,
            penalty,
            preferredGapSatisfied,
            backToBack,
          });
        }
        aggregateByExamPair.set(aggregateKey, aggregate);
      }
    }
  }

  const aggregatePairs = [...aggregateByExamPair.values()].sort((left, right) => (
    right.totalPenalty - left.totalPenalty || right.studentCount - left.studentCount || left.aggregateKey.localeCompare(right.aggregateKey)
  ));
  const contributingPairs = [...pairContributions]
    .filter((contribution) => contribution.penalty > 0)
    .sort((left, right) => right.penalty - left.penalty || left.studentId.localeCompare(right.studentId));

  return {
    aggregatePairs,
    contributingPairs,
    pairContributionMap: new Map(pairContributions.map((contribution) => [
      `${contribution.studentId}:${contribution.aggregateKey}:${contribution.left.timeSlotId}:${contribution.right.timeSlotId}`,
      contribution,
    ])),
  };
};

const getRequiredProctorCount = (studentCount) => {
  return getRequiredProctorsFromCount(studentCount);
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

const buildSchedulingLookups = ({ exams, rooms, proctors, timeSlots, existingAssignments, totalAvailableRoomCapacity = null }) => {
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
  const proctorGlobalLoadMap = new Map();
  const roomTimeRangeMap = new Map();
  const proctorTimeRangeMap = new Map();
  const slotDayKeyMap = new Map(timeSlots.map((slot) => [slot.id, toDateKey(slot.date ?? slot.startTime)]));
  const availableRooms = rooms.filter((room) => room.status === 'AVAILABLE');
  // Compute total available capacity once and reuse for every slot (it never varies).
  const totalCapacity = totalAvailableRoomCapacity ?? getTotalCapacity(availableRooms);

  for (const proctor of proctors) {
    proctorAvailabilityMap.set(proctor.id, new Set(proctor.availableTimeSlotIds ?? []));
    proctorGlobalLoadMap.set(proctor.id, 0);
  }

  for (const room of rooms) {
    roomAvailabilityMap.set(
      room.id,
      new Set(room.status === 'AVAILABLE' ? timeSlots.map((slot) => slot.id) : []),
    );
  }

  for (const slot of timeSlots) {
    timeslotCapacityMap.set(slot.id, totalCapacity);
  }

  const reservedStudentExamSlots = new Set();

  for (const assignment of existingAssignments) {
    if (!assignment.schedule?.isFinal) continue;
    const slot = assignment.timeSlot;
    const slotDayKey = slotDayKeyMap.get(assignment.timeSlotId) ?? (slot ? toDateKey(slot.date ?? slot.startTime) : null);

    addToNestedSet(roomSlotMap, assignment.roomId, assignment.timeSlotId);
    addToNestedSet(roomUsageMap, assignment.timeSlotId, assignment.roomId);
    addToNestedSet(proctorSlotMap, assignment.proctorId, assignment.timeSlotId);
    proctorGlobalLoadMap.set(assignment.proctorId, (proctorGlobalLoadMap.get(assignment.proctorId) ?? 0) + 1);

    if (slotDayKey) {
      const proctorDayKey = `${assignment.proctorId}:${slotDayKey}`;
      proctorDailyLoadMap.set(proctorDayKey, (proctorDailyLoadMap.get(proctorDayKey) ?? 0) + 1);
    }

    if (slot?.startTime && slot?.endTime) {
      addTimeRange(proctorTimeRangeMap, assignment.proctorId, slot.startTime, slot.endTime);
      addTimeRange(roomTimeRangeMap, assignment.roomId, slot.startTime, slot.endTime);
    }

    const studentReservationKey = `${assignment.examId}:${assignment.timeSlotId}`;
    if (!reservedStudentExamSlots.has(studentReservationKey)) {
      reservedStudentExamSlots.add(studentReservationKey);
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
    totalAvailableRoomCapacity: totalCapacity,
    proctorSlotMap,
    proctorDailyLoadMap,
    proctorGlobalLoadMap,
    roomTimeRangeMap,
    proctorTimeRangeMap,
    slotDayKeyMap,
  };
};

const getStaticFeasibleTimeSlotCount = ({ exam, timeSlots, proctorsBySlotId, totalRoomCapacity }) => {
  const requiredProctors = getRequiredProctorsForExam(exam);
  // Fast-path: if total room capacity can never cover required seats, zero slots fit
  if (totalRoomCapacity < exam.requiredSeats) return 0;

  return timeSlots.filter((slot) => {
    if (!canSlotFitExam(slot, exam)) return false;
    // Use pre-indexed proctor list instead of O(proctors) scan
    return (proctorsBySlotId.get(slot.id)?.length ?? 0) >= requiredProctors;
  }).length;
};

const getStaticFeasibleOptionCount = ({ exam, timeSlots, proctorsBySlotId, totalRoomCapacity }) => {
  const requiredProctors = getRequiredProctorsForExam(exam);
  // Fast-path: if total room capacity can never cover required seats, zero options exist
  if (totalRoomCapacity < exam.requiredSeats) return 0;
  let count = 0;

  for (const slot of timeSlots) {
    if (!canSlotFitExam(slot, exam)) continue;
    // Use pre-indexed proctor list instead of O(proctors) scan
    if ((proctorsBySlotId.get(slot.id)?.length ?? 0) < requiredProctors) continue;
    count += 1;
  }

  return count;
};

const addExamFeasibilityStats = ({ exams, timeSlots, proctorsBySlotId, totalRoomCapacity }) => exams.map((exam) => ({
  ...exam,
  resourceDemand: exam.requiredSeats + (getRequiredProctorsForExam(exam) * 20),
  feasibleTimeSlotCount: getStaticFeasibleTimeSlotCount({ exam, timeSlots, proctorsBySlotId, totalRoomCapacity }),
  feasibleOptionCount: getStaticFeasibleOptionCount({ exam, timeSlots, proctorsBySlotId, totalRoomCapacity }),
}));

const percentile = (values, ratio) => {
  if (!values.length) return 0;

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );

  return sorted[index];
};

const getCourseLevel = (courseCode) => {
  const match = `${courseCode ?? ''}`.match(/(\d{3})/);
  return match ? Number.parseInt(match[1], 10) : null;
};

const getPriorityText = (exam) => [
  exam.courseCode,
  exam.courseTitle,
  exam.courseOffering?.notes,
  exam.courseOffering?.section,
]
  .filter(Boolean)
  .join(' ')
  .toLowerCase();

const getExamProgramIds = (exam) => {
  const programIds = new Set();

  if (exam.courseOffering?.course?.programId) {
    programIds.add(exam.courseOffering.course.programId);
  }

  for (const registration of exam.courseOffering?.registrations ?? []) {
    if (registration.student?.programId) {
      programIds.add(registration.student.programId);
    }
  }

  return programIds;
};

const isGraduationOrFinalYearCourse = (exam) => {
  const priorityText = getPriorityText(exam);
  const courseLevel = getCourseLevel(exam.courseCode);

  return courseLevel >= 400
    || /(capstone|thesis|dissertation|graduation|final\s*year|senior\s*project|project\s*(ii|2)|internship|practicum)/i.test(priorityText);
};

const isCoreMandatoryCourse = (exam) => {
  const priorityText = getPriorityText(exam);

  return /(mandatory|required|core|fundamentals?|foundation|foundations|principles|introduction|intro\b)/i.test(priorityText);
};

const isUniversityWideSharedCourse = (exam, totalProgramCount) => {
  const priorityText = getPriorityText(exam);
  const coveredPrograms = getExamProgramIds(exam).size;
  const broadCoverageThreshold = totalProgramCount > 0
    ? Math.max(2, Math.ceil(totalProgramCount * 0.6))
    : 3;

  return coveredPrograms >= broadCoverageThreshold
    || coveredPrograms >= 3
    || /(shared|common|general\s+education|university[-\s]*wide|interdisciplinary)/i.test(priorityText);
};

const addExamPriorityBands = (exams) => {
  const studentCounts = exams.map((exam) => exam.studentCount ?? 0);
  const resourceDemands = exams.map((exam) => exam.resourceDemand ?? 0);
  const requiredProctors = exams.map((exam) => getRequiredProctorsForExam(exam));
  const allProgramIds = new Set();

  for (const exam of exams) {
    for (const programId of getExamProgramIds(exam)) {
      allProgramIds.add(programId);
    }
  }

  const largeStudentThreshold = Math.max(35, percentile(studentCounts, 0.75));
  const highResourceThreshold = Math.max(60, percentile(resourceDemands, 0.75));
  const highProctorThreshold = Math.max(3, percentile(requiredProctors, 0.75));

  return exams.map((exam) => {
    const largeStudentCount = (exam.studentCount ?? 0) >= largeStudentThreshold;
    const graduationOrFinalYear = isGraduationOrFinalYearCourse(exam);
    const coreOrMandatory = isCoreMandatoryCourse(exam);
    const universityWideShared = isUniversityWideSharedCourse(exam, allProgramIds.size);
    const highResourceDemand = (exam.resourceDemand ?? 0) >= highResourceThreshold
      || getRequiredProctorsForExam(exam) >= highProctorThreshold
      || getEffectiveExamDuration(exam.duration) >= 180;

    const inferredPriorityScore = [
      largeStudentCount ? 2 : 0,
      graduationOrFinalYear ? 3 : 0,
      coreOrMandatory ? 2 : 0,
      universityWideShared ? 3 : 0,
      highResourceDemand ? 2 : 0,
    ].reduce((total, value) => total + value, 0);

    let priorityBand = EXAM_PRIORITY_BAND.NORMAL;
    if (
      (graduationOrFinalYear && (largeStudentCount || coreOrMandatory || universityWideShared || highResourceDemand))
      || (universityWideShared && (largeStudentCount || highResourceDemand))
      || inferredPriorityScore >= 6
    ) {
      priorityBand = EXAM_PRIORITY_BAND.CRITICAL;
    } else if (inferredPriorityScore >= 3) {
      priorityBand = EXAM_PRIORITY_BAND.HIGH;
    }

    return {
      ...exam,
      priorityBand,
      priorityBandRank: EXAM_PRIORITY_BAND_RANK[priorityBand],
      priorityScore: inferredPriorityScore,
      prioritySignals: {
        largeStudentCount,
        graduationOrFinalYear,
        coreOrMandatory,
        universityWideShared,
        highResourceDemand,
      },
    };
  });
};

const comparePriorityBands = (a, b) => (
  (b.priorityBandRank ?? EXAM_PRIORITY_BAND_RANK.NORMAL)
  - (a.priorityBandRank ?? EXAM_PRIORITY_BAND_RANK.NORMAL)
  || (b.priorityScore ?? 0) - (a.priorityScore ?? 0)
);

const comparePlacementDifficulty = (a, b) => (
  (a.feasibleOptionCount ?? Number.POSITIVE_INFINITY) - (b.feasibleOptionCount ?? Number.POSITIVE_INFINITY)
  || (a.feasibleTimeSlotCount ?? Number.POSITIVE_INFINITY) - (b.feasibleTimeSlotCount ?? Number.POSITIVE_INFINITY)
  || (b.resourceDemand ?? 0) - (a.resourceDemand ?? 0)
  || (b.studentCount ?? 0) - (a.studentCount ?? 0)
  || (a.courseCode ?? '').localeCompare(b.courseCode ?? '')
);

const compareExamsForScheduling = (a, b) => (
  comparePriorityBands(a, b)
  || comparePlacementDifficulty(a, b)
);

const compareExamsLeastConstrainedFirst = (a, b) => (
  comparePriorityBands(a, b)
  || a.conflictCount - b.conflictCount
  || a.studentCount - b.studentCount
  || (a.courseCode ?? '').localeCompare(b.courseCode ?? '')
);

const compareExamsPriorityFirst = (a, b) => (
  comparePriorityBands(a, b)
  || b.studentCount - a.studentCount
  || b.conflictCount - a.conflictCount
  || (a.courseCode ?? '').localeCompare(b.courseCode ?? '')
);

const compareExamsShortestFirst = (a, b) => (
  comparePriorityBands(a, b)
  || getEffectiveExamDuration(a.duration) - getEffectiveExamDuration(b.duration)
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
      duration: getEffectiveExamDuration(exam.duration),
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
    user: proctor.user,
    maxExamsPerDay: (proctor.maxExamsPerDay ?? DEFAULT_MAX_PROCTOR_ASSIGNMENTS_PER_DAY),
    availableTimeSlotIds: extractAvailableTimeSlotIds(proctor),
  }));

  // Pre-compute total available room capacity once (same for every slot).
  const totalAvailableRoomCapacity = getTotalCapacity(normalizedRooms);

  // Build a reverse index: slotId ? Proctor[] for O(1) proctor-per-slot lookups.
  // Avoids the O(proctors) linear scan in every slot � exam iteration.
  const proctorsBySlotId = new Map();
  for (const proctor of normalizedProctors) {
    for (const slotId of proctor.availableTimeSlotIds) {
      if (!proctorsBySlotId.has(slotId)) proctorsBySlotId.set(slotId, []);
      proctorsBySlotId.get(slotId).push(proctor);
    }
  }

  const studentExamMap = buildStudentExamMap(exams);
  const examConflictCountMap = buildExamConflictCountMap(studentExamMap);
  const examsWithConflictCounts = addExamFeasibilityStats({
    exams: exams.map((exam) => ({
      ...exam,
      conflictCount: examConflictCountMap.get(exam.id) ?? 0,
    })),
    timeSlots,
    proctorsBySlotId,
    totalRoomCapacity: totalAvailableRoomCapacity,
  });
  const prioritizedExams = addExamPriorityBands(examsWithConflictCounts);
  const draftBlockingAssignments = [];

  return {
    exams: prioritizedExams,
    rooms: normalizedRooms,
    proctors: normalizedProctors,
    proctorsBySlotId,
    timeSlots,
    existingAssignments,
    studentExamMap,
    studentToExams: studentExamMap,
    lookups: buildSchedulingLookups({
      exams: prioritizedExams,
      rooms: normalizedRooms,
      proctors: normalizedProctors,
      timeSlots,
      existingAssignments: draftBlockingAssignments,
      totalAvailableRoomCapacity,
    }),
  };
};

const ensureExamRecords = async (courseOfferings) => {
  const missingOfferings = courseOfferings.filter((offering) => (
    offering.hasExam !== false
    && offering.courseType !== 'PROJECT'
    && offering.exams.length === 0
  ));

  if (missingOfferings.length > 0) {
    const createdExams = await prisma.$transaction(
      missingOfferings.map((offering) => prisma.exam.create({
        data: {
          courseOfferingId: offering.id,
          status: 'DRAFT',
          duration: getEffectiveExamDuration(),
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
  // Skip cache when ensureExams is requested � that may mutate DB state.
  if (!options.ensureExams) {
    const cached = _cacheGet(_normalizedDataCache, semesterId);
    if (cached) return cached;
  }

  const semester = await prisma.semester.findUnique({ where: { id: semesterId } });
  if (!semester) throw new AppError('Semester not found', 404);

  const [courseOfferings, rooms, proctors, allTimeSlots, existingAssignments] = await Promise.all([
    prisma.courseOffering.findMany({
      where: {
        semesterId,
        status: 'ACTIVE',
        courseType: 'COURSE',
        hasExam: true,
      },
      include: {
        course: true,
        semester: true,
        registrations: {
          select: {
            id: true,
            studentId: true,
            status: true,
            student: {
              select: {
                programId: true,
                user: { select: { name: true, email: true } },
              },
            },
          },
        },
        exams: true,
        _count: { select: { registrations: true } },
      },
      orderBy: [{ course: { code: 'asc' } }, { section: 'asc' }],
    }),
    prisma.room.findMany({
      where: { status: 'AVAILABLE' },
      include: { center: true },
      orderBy: [{ capacity: 'asc' }, { name: 'asc' }],
    }),
    prisma.proctor.findMany({
      include: {
        user: { select: { id: true, name: true, email: true } },
        availableTimeSlots: {
          select: {
            timeSlotId: true,
          },
        },
      },
      orderBy: [{ user: { name: 'asc' } }],
    }),
    prisma.timeSlot.findMany({ orderBy: [{ startTime: 'asc' }, { endTime: 'asc' }] }),
    prisma.examAssignment.findMany({
      where: {
        exam: {
          courseOffering: {
            semesterId,
            courseType: 'COURSE',
            hasExam: true,
          },
        },
      },
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

  const result = { semester, normalized, createdExamCount };
  if (!options.ensureExams) {
    _cacheSet(_normalizedDataCache, semesterId, result, NORMALIZED_DATA_CACHE_TTL_MS);
  }
  return result;
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
      proctorGlobalLoadMap: cloneCountMap(lookups.proctorGlobalLoadMap),
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
    proctorGlobalLoadMap: new Map(),
    proctorTimeRangeMap: new Map(),
    roomTimeRangeMap: new Map(),
  };

  const reservedStudentExamSlots = new Set();

  for (const assignment of existingAssignments) {
    if (!assignment.schedule?.isFinal) continue;

    addToNestedSet(usage.roomSlotMap, assignment.roomId, assignment.timeSlotId);
    addToNestedSet(usage.proctorSlotMap, assignment.proctorId, assignment.timeSlotId);
    usage.proctorGlobalLoadMap.set(assignment.proctorId, (usage.proctorGlobalLoadMap.get(assignment.proctorId) ?? 0) + 1);

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
  usage.proctorGlobalLoadMap.set(assignment.proctorId, (usage.proctorGlobalLoadMap.get(assignment.proctorId) ?? 0) + 1);

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

const getAvailableProctorsForSlot = (proctors, slot, usage, slotDayKey, proctorsBySlotId = null) => {
  // When the pre-built reverse index is provided, start from only the proctors
  // that declared availability for this slot � avoids an O(all proctors) scan.
  const candidates = proctorsBySlotId !== null
    ? (proctorsBySlotId.get(slot.id) ?? [])
    : proctors;
  return candidates
    .filter((proctor) => isProctorAvailableForSlot(proctor, slot, usage, slotDayKey))
    .sort((a, b) => (
      (usage.proctorGlobalLoadMap.get(a.id) ?? 0)
      - (usage.proctorGlobalLoadMap.get(b.id) ?? 0)
      || (usage.proctorDailyLoadMap.get(`${a.id}:${slotDayKey}`) ?? 0)
      - (usage.proctorDailyLoadMap.get(`${b.id}:${slotDayKey}`) ?? 0)
      || (a.user?.name ?? '').localeCompare(b.user?.name ?? '')
    ));
};

const getProctorsForRoom = (proctors) => {
  return proctors;
};

const getTotalCapacity = (rooms) => rooms.reduce((total, room) => total + room.capacity, 0);

const getUniqueRooms = (rooms) => [...new Map(rooms.map((room) => [room.id, room])).values()];

const roomSetKey = (rooms) => rooms.map((room) => room.id).sort().join(':');

const buildMinimalRoomSets = ({ rooms, requiredSeats, requiredRoomCount = 1, preSorted = false }) => {
  // Skip the sort when the caller guarantees rooms are already sorted desc by capacity.
  const sorted = preSorted ? rooms : sortRoomsByCapacityDesc(rooms);
  const sets = [];

  let selectedCapacity = 0;
  for (let count = Math.max(1, requiredRoomCount); count <= sorted.length; count += 1) {
    const selected = sorted.slice(0, count);
    selectedCapacity = selectedCapacity || getTotalCapacity(selected);
    if (selectedCapacity >= requiredSeats) {
      sets.push(selected);
      break;
    }
    selectedCapacity += sorted[count]?.capacity ?? 0;
  }

  for (const anchor of sorted) {
    const selected = [anchor];
    let capacity = anchor.capacity;
    for (const room of sorted) {
      if (room.id === anchor.id) continue;
      selected.push(room);
      capacity += room.capacity;
      if (selected.length >= requiredRoomCount && capacity >= requiredSeats) break;
    }
    if (selected.length >= requiredRoomCount && capacity >= requiredSeats) {
      sets.push(getUniqueRooms(selected));
    }
  }

  return sets;
};

const buildCandidateRoomSets = ({ rooms, requiredSeats, requiredProctors, preSorted = false }) => {
  const roomSets = [];
  const seen = new Set();
  const addSet = (set) => {
    const unique = getUniqueRooms(set);
    if (unique.length === 0 || getTotalCapacity(unique) < requiredSeats) return;
    const key = roomSetKey(unique);
    if (seen.has(key)) return;
    seen.add(key);
    roomSets.push(unique);
  };

  const centerGroups = new Map();
  for (const room of rooms) {
    const key = room.centerId ?? room.id;
    const list = centerGroups.get(key) ?? [];
    list.push(room);
    centerGroups.set(key, list);
  }

  // When rooms are pre-sorted desc by capacity (from getAvailableRoomsForSlot), pass the
  // flag through so buildMinimalRoomSets can skip redundant re-sorting of the same data.
  for (const centerRooms of centerGroups.values()) {
    for (const set of buildMinimalRoomSets({ rooms: centerRooms, requiredSeats, preSorted })) addSet(set);
  }

  for (const set of buildMinimalRoomSets({ rooms, requiredSeats, preSorted })) addSet(set);
  for (const set of buildMinimalRoomSets({ rooms, requiredSeats, requiredRoomCount: Math.min(requiredProctors, rooms.length), preSorted })) addSet(set);

  return roomSets.sort((left, right) => (
    left.length - right.length
    || new Set(left.map((room) => room.centerId)).size - new Set(right.map((room) => room.centerId)).size
    || getTotalCapacity(left) - getTotalCapacity(right)
  )).slice(0, MAX_CANDIDATE_ROOM_SETS);
};

const buildAllocationForRoomSet = ({ roomSet, availableProctors, requiredProctors, usage, slotDayKey }) => {
  const allocation = [];
  const usedProctorIds = new Set();

  for (const room of roomSet) {
    const proctor = availableProctors.find((candidate) => !usedProctorIds.has(candidate.id));
    if (!proctor) return null;
    allocation.push({ room, proctor });
    usedProctorIds.add(proctor.id);
  }

  const proctorsNeeded = Math.max(roomSet.length, requiredProctors);
  while (allocation.length < proctorsNeeded) {
    const proctor = availableProctors.find((candidate) => !usedProctorIds.has(candidate.id));
    if (!proctor) return null;
    allocation.push({ room: roomSet[allocation.length % roomSet.length], proctor });
    usedProctorIds.add(proctor.id);
  }

  return allocation;
};

const compareAllocations = ({ exam, usage, slotDayKey }) => (left, right) => {
  const leftRooms = getUniqueRooms(left.map(({ room }) => room));
  const rightRooms = getUniqueRooms(right.map(({ room }) => room));
  const leftCenters = new Set(leftRooms.map((room) => room.centerId)).size;
  const rightCenters = new Set(rightRooms.map((room) => room.centerId)).size;
  const leftCapacity = getTotalCapacity(leftRooms);
  const rightCapacity = getTotalCapacity(rightRooms);
  const leftWorkload = getProctorWorkloadPenalty({ allocation: left, usage, slotDayKey });
  const rightWorkload = getProctorWorkloadPenalty({ allocation: right, usage, slotDayKey });

  return leftRooms.length - rightRooms.length
    || leftCenters - rightCenters
    || Math.abs(leftCapacity - exam.requiredSeats) - Math.abs(rightCapacity - exam.requiredSeats)
    || leftWorkload - rightWorkload;
};

const getSlotDurationMinutes = (slot) => {
  if (slot.duration) return slot.duration;
  return Math.max(0, Math.round((slot.endTime.getTime() - slot.startTime.getTime()) / 60000));
};

const getSlotStartHour = (slot) => {
  if (!slot?.startTime) return null;
  const startTime = slot.startTime instanceof Date ? slot.startTime : new Date(slot.startTime);
  if (Number.isNaN(startTime.getTime())) return null;
  return startTime.getUTCHours();
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
  return getSlotDurationMinutes(slot) >= getEffectiveExamDuration(exam.duration);
};

const isValidAssignment = ({ exam, slot, room, proctor, usage, slotDayKey }) => {
  if (!canSlotFitExam(slot, exam)) return false;
  if (hasStudentOverlap(usage, exam, slot)) return false;
  if (!isRoomAvailableForSlot(room, slot, usage)) return false;
  if (room.capacity < exam.requiredSeats) return false;
  return isProctorAvailableForSlot(proctor, slot, usage, slotDayKey);
};

const buildRoomAllocation = ({ exam, slot, sortedRooms, proctors, usage, slotDayKey, proctorsBySlotId = null }) => {
  if (!canSlotFitExam(slot, exam)) return null;
  if (hasStudentOverlap(usage, exam, slot)) return null;

  // getAvailableRoomsForSlot filters from sortedRooms which is already sorted desc by
  // capacity � Array.filter preserves order, so availableRooms is also sorted desc.
  const availableRooms = getAvailableRoomsForSlot(sortedRooms, slot, usage);
  const availableProctors = getAvailableProctorsForSlot(proctors, slot, usage, slotDayKey, proctorsBySlotId);
  const requiredProctors = getRequiredProctorsForExam(exam);

  if (availableProctors.length < requiredProctors) return null;

  const roomSets = buildCandidateRoomSets({
    rooms: availableRooms.filter((room) => getProctorsForRoom(availableProctors, room).length > 0),
    requiredSeats: exam.requiredSeats,
    requiredProctors,
    preSorted: true,
  });

  let bestAllocation = null;
  const compare = compareAllocations({ exam, usage, slotDayKey });
  for (const roomSet of roomSets) {
    const allocation = buildAllocationForRoomSet({ roomSet, availableProctors, requiredProctors, usage, slotDayKey });
    if (!isValidRoomAllocation({ exam, slot, allocation, usage, slotDayKey })) continue;
    if (!bestAllocation || compare(allocation, bestAllocation) < 0) {
      bestAllocation = allocation;
    }
    break; // room sets are pre-sorted by quality; first valid set is already optimal
  }

  return bestAllocation;
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

const getExamLabel = (exam) => [exam.courseCode, exam.courseTitle].filter(Boolean).join(' � ') || 'an exam';

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

const buildAssignmentFailureConflict = ({ scheduleId, exam, timeSlots, sortedRooms, proctors, usage, slotDayKeys, proctorsBySlotId = null }) => {
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
      `${examLabel} requires ${getEffectiveExamDuration(exam.duration)} minutes, but every available time slot is shorter.`,
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
      `${examLabel} has ${exam.studentCount} enrolled student${exam.studentCount !== 1 ? 's' : ''} and needs ${requiredProctors} proctor${requiredProctors !== 1 ? 's' : ''} (1 per 20 students), but only ${proctors.length} proctor${proctors.length !== 1 ? 's' : ''} ${proctors.length === 1 ? 'is' : 'are'} available${proctorLabel ? `: ${proctorLabel}` : ''}.`,
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
    .every((slot) => getAvailableProctorsForSlot(proctors, slot, usage, slotDayKeys.get(slot.id), proctorsBySlotId).length < requiredProctors);

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
      const allocation = buildRoomAllocation({ exam, slot, sortedRooms, proctors, usage, slotDayKey, proctorsBySlotId });
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
    const availableProctors = getAvailableProctorsForSlot(proctors, slot, usage, slotDayKey, proctorsBySlotId);

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

const buildFittingSlotCache = (exams, timeSlots, strategyId) => {
  const cache = new Map();
  for (const exam of exams) {
    cache.set(
      exam.id,
      orderTimeSlotsForStrategy(
        timeSlots.filter((slot) => canSlotFitExam(slot, exam)),
        strategyId,
      ),
    );
  }
  return cache;
};

const getUniqueAllocationRooms = (allocation) => [...new Map(
  allocation.map(({ room }) => [room.id, room]),
).values()];

const getUniqueAllocationProctors = (allocation) => [...new Map(
  allocation.map(({ proctor }) => [proctor.id, proctor]),
).values()];

const normalizePenaltyRatio = (value, max = 1) => {
  if (max <= 0) return 0;
  return clampScore((Math.max(0, value) / max) * 100);
};

const getUnusedRoomSeatsPenalty = (exam, uniqueRooms) => {
  const totalCapacity = getTotalCapacity(uniqueRooms);
  if (totalCapacity <= 0) return 100;

  return normalizePenaltyRatio(
    Math.max(0, totalCapacity - exam.requiredSeats),
    totalCapacity,
  );
};

const getProctorWorkloadPenalty = ({ allocation, usage, slotDayKey }) => {
  const uniqueProctors = getUniqueAllocationProctors(allocation);
  if (uniqueProctors.length === 0) return 100;

  const projectedDailyLoadRatios = uniqueProctors.map((proctor) => {
    const currentLoad = usage.proctorDailyLoadMap.get(`${proctor.id}:${slotDayKey}`) ?? 0;
    const maxDailyLoad = Math.max(1, proctor.maxExamsPerDay ?? 1);
    return Math.min(1, (currentLoad + 1) / maxDailyLoad);
  });

  const globalLoads = [...(usage.proctorGlobalLoadMap ?? new Map()).values()];
  const averageGlobalLoad = globalLoads.length === 0 ? 0 : average(globalLoads);
  const projectedGlobalLoads = uniqueProctors.map((proctor) => (usage.proctorGlobalLoadMap?.get(proctor.id) ?? 0) + 1);
  const globalLoadPenalty = averageGlobalLoad <= 0
    ? 0
    : clampScore(average(projectedGlobalLoads.map((load) => Math.max(0, load - averageGlobalLoad) / Math.max(1, averageGlobalLoad))) * 100);

  return clampScore((average(projectedDailyLoadRatios) * 55) + (globalLoadPenalty * 45));
};

const getStudentDailyLoadPenalty = ({ exam, usage, slotDayKey }) => {
  const studentIds = exam.studentIds ?? [];
  if (!studentIds.length) return 100;

  const currentLoadRatios = studentIds.map((studentId) => {
    const currentLoad = usage.studentDailyLoadMap.get(`${studentId}:${slotDayKey}`) ?? 0;
    return Math.min(1, currentLoad / Math.max(1, MAX_STUDENT_EXAMS_PER_DAY - 1));
  });

  return clampScore(average(currentLoadRatios) * 100);
};

const getRoomCenterSpreadPenalty = (exam, uniqueRooms) => {
  if (uniqueRooms.length <= 1) return 0;

  const centerCount = new Set(uniqueRooms.map((room) => room.centerId ?? room.id)).size;
  const maxSpread = Math.max(1, getRequiredProctorsForExam(exam) - 1, uniqueRooms.length - 1);
  const roomSpreadPenalty = normalizePenaltyRatio(uniqueRooms.length - 1, maxSpread);
  const centerSpreadPenalty = normalizePenaltyRatio(centerCount - 1, maxSpread);

  return clampScore((roomSpreadPenalty * 0.4) + (centerSpreadPenalty * 0.6));
};

const getRoomCountPenalty = (exam, uniqueRooms) => {
  if (uniqueRooms.length <= 1) return 0;
  const maxRooms = Math.max(1, getRequiredProctorsForExam(exam), uniqueRooms.length);
  return normalizePenaltyRatio(uniqueRooms.length - 1, maxRooms - 1);
};

const buildDraftCandidateAssignments = ({ scheduleId, exam, candidate }) => candidate.allocation.map(({ room, proctor }) => ({
  scheduleId,
  examId: exam.id,
  roomId: room.id,
  proctorId: proctor.id,
  timeSlotId: candidate.slot.id,
}));

const scoreNormalizedCandidatePenalty = ({ exam, allocation, usage, slotDayKey }) => {
  const uniqueRooms = getUniqueAllocationRooms(allocation);
  const components = {
    unusedRoomSeats: getUnusedRoomSeatsPenalty(exam, uniqueRooms),
    roomCount: getRoomCountPenalty(exam, uniqueRooms),
    proctorWorkload: getProctorWorkloadPenalty({ allocation, usage, slotDayKey }),
    studentDailyLoad: getStudentDailyLoadPenalty({ exam, usage, slotDayKey }),
    roomCenterSpread: getRoomCenterSpreadPenalty(exam, uniqueRooms),
  };
  const total = Object.entries(CANDIDATE_PENALTY_WEIGHTS).reduce((score, [key, weight]) => (
    score + ((components[key] ?? 0) * weight)
  ), 0);

  return {
    total: roundMetric(total),
    components: Object.fromEntries(
      Object.entries(components).map(([key, value]) => [key, roundMetric(value)]),
    ),
  };
};

const scoreQualityAwareCandidatePenalty = ({ projectedEvaluation, localPenalty }) => {
  const metrics = projectedEvaluation?.metrics ?? {};
  const qualityMetrics = projectedEvaluation?.qualityMetrics ?? {};
  const components = {
    roomUtilization: roundMetric(100 - (metrics.roomUtilization ?? 0)),
    proctorWorkloadBalance: roundMetric(100 - (metrics.proctorWorkloadBalance ?? 0)),
    studentSpacing: roundMetric(100 - (metrics.studentSpacing ?? 0)),
    examDistribution: roundMetric(100 - (metrics.examDistribution ?? 0)),
    unusedSeats: roundMetric(localPenalty.components.unusedRoomSeats ?? 0),
    roomSpread: roundMetric(localPenalty.components.roomCenterSpread ?? 0),
    proctorImbalance: roundMetric(qualityMetrics.normalizedProctorBalancePenalty ?? (100 - (metrics.proctorWorkloadBalance ?? 0))),
    studentSameDay: roundMetric(qualityMetrics.sameDayPairCount ?? 0),
    backToBack: roundMetric(qualityMetrics.backToBackPairCount ?? 0),
    distributionVariance: roundMetric(qualityMetrics.normalizedDistributionVariance ?? (100 - (metrics.examDistribution ?? 0))),
    preferredSpacingViolations: roundMetric((qualityMetrics.totalStudentExamPairs ?? 0) - (qualityMetrics.preferredGapSatisfied ?? 0)),
  };

  return {
    total: roundMetric(
      (components.roomUtilization * QUALITY_WEIGHTS.roomUtilization)
      + (components.proctorWorkloadBalance * QUALITY_WEIGHTS.proctorWorkloadBalance)
      + (components.studentSpacing * QUALITY_WEIGHTS.studentSpacing)
      + (components.examDistribution * QUALITY_WEIGHTS.examDistribution)
    ),
    components,
    qualityScore: projectedEvaluation?.score ?? 0,
  };
};

const buildValidCandidatesForExam = ({ exam, timeSlots, sortedRooms, proctors, usage, slotDayKeys, strategy, fittingSlotCache = null, proctorsBySlotId = null, scheduleId = 'preview', partialDraft = null, normalized = null }) => {
  if (!hasEnrollmentConstraintSatisfied(exam)) return [];

  const fittingSlots = fittingSlotCache?.get(exam.id) ?? orderTimeSlotsForStrategy(
    timeSlots.filter((slot) => canSlotFitExam(slot, exam)),
    strategy.id,
  );

  const candidates = [];
  for (const slot of fittingSlots) {
    if (hasStudentOverlap(usage, exam, slot)) continue;
    const slotDayKey = slotDayKeys.get(slot.id);
    if (!hasStudentDailyLoadCapacity(usage, exam, slotDayKey)) continue;
    const allocation = buildRoomAllocation({ exam, slot, sortedRooms, proctors, usage, slotDayKey, proctorsBySlotId });
    if (!isValidRoomAllocation({ exam, slot, allocation, usage, slotDayKey })) continue;

    const localPenalty = scoreNormalizedCandidatePenalty({ exam, allocation, usage, slotDayKey });
    const candidate = { slot, allocation, slotDayKey };
    const projectedDraft = normalized ? {
      assignmentInserts: [
        ...(partialDraft?.assignmentInserts ?? []),
        ...buildDraftCandidateAssignments({ scheduleId, exam, candidate }),
      ],
      conflictInserts: [...(partialDraft?.conflictInserts ?? [])],
      scheduledExamIds: [...(partialDraft?.scheduledExamIds ?? []), exam.id],
      candidateScores: [...(partialDraft?.candidateScores ?? [])],
      softPenalty: 0,
      hardConstraintViolations: partialDraft?.conflictInserts?.length ?? 0,
      strategyId: strategy.id ?? 'greedy-priority-csp',
      strategyLabel: strategy.label ?? 'Greedy priority CSP draft',
    } : null;
    const projectedEvaluation = projectedDraft
      ? evaluateDraftSchedule({ normalized, draft: projectedDraft })
      : null;
    const penalty = projectedEvaluation
      ? scoreQualityAwareCandidatePenalty({ projectedEvaluation, localPenalty })
      : localPenalty;

    candidates.push({
      ...candidate,
      penalty,
      localPenalty,
      projectedEvaluation,
      softPenalty: penalty.total,
    });
    if (strategy.earlyStopOnPerfectCandidate && penalty.total === 0) break;
  }

  return candidates.sort((a, b) => (
    a.softPenalty - b.softPenalty
    || ((b.projectedEvaluation?.score ?? 0) - (a.projectedEvaluation?.score ?? 0))
    || a.slot.startTime - b.slot.startTime
  ));
};

const buildHybridDraft = ({ scheduleId, exams, rooms, proctors, timeSlots, existingAssignments, lookups = null, strategy = {}, proctorsBySlotId = null }) => {
  const usage = createUsageTracker(existingAssignments, lookups);
  const normalizedDraftContext = {
    exams,
    rooms,
    proctors,
    timeSlots,
    proctorsBySlotId,
  };
  const roomSorter = strategy.roomSorter ?? sortRoomsByCapacityDesc;
  const examComparator = strategy.examComparator ?? compareExamsForScheduling;
  const sortedRooms = roomSorter(rooms);
  const slotDayKeys = buildSlotDayKeyMap(timeSlots);
  const fittingSlotCache = buildFittingSlotCache(exams, timeSlots, strategy.id);
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
      fittingSlotCache,
      proctorsBySlotId,
      scheduleId,
      partialDraft: {
        assignmentInserts,
        conflictInserts,
        scheduledExamIds,
        candidateScores,
      },
      normalized: normalizedDraftContext,
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
        proctorsBySlotId,
      }));
      break;
    }

    const bestCandidate = candidates[0];
    const assignments = buildDraftCandidateAssignments({ scheduleId, exam, candidate: bestCandidate });

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
      normalizedPenalty: bestCandidate.penalty,
      penaltyComponents: bestCandidate.penalty.components,
      projectedScore: bestCandidate.projectedEvaluation?.score ?? null,
    });
  }

  const draft = {
    assignmentInserts,
    conflictInserts,
    scheduledExamIds,
    candidateScores,
    softPenalty: candidateScores.reduce((total, score) => total + score.softPenalty, 0),
    hardConstraintViolations: conflictInserts.length,
    strategyId: strategy.id ?? 'greedy-priority-csp',
    strategyLabel: strategy.label ?? 'Greedy priority CSP draft',
  };

  return {
    ...draft,
    qualityEvaluation: evaluateDraftSchedule({ normalized: normalizedDraftContext, draft }),
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

const variance = (values) => {
  if (values.length <= 1) return 0;
  const mean = average(values);
  return average(values.map((value) => (value - mean) ** 2));
};

// eligibleProctorCount: proctors who declared availability for at least one slot.
// When omitted it falls back to workloadValues.length (all known proctors), which
// correctly penalises under-utilisation when more proctors could have been used.
const calculateProctorWorkloadBalance = (workloadValues, eligibleProctorCount = null) => {
  const totalAssignments = workloadValues.reduce((total, load) => total + load, 0);
  if (totalAssignments === 0) {
    return {
      totalAssignments,
      idealLoad: 0,
      idealActiveLoad: 0,
      scoringProctorCount: 0,
      activeProctorCount: 0,
      unusedProctorCount: workloadValues.length,
      scoredLoads: [],
      proctorBalancePenalty: 0,
      maxProctorBalancePenalty: 0,
      balanceAmongActive: 100,
      coverageScore: 100,
      proctorWorkloadBalance: 100,
      proctorLoadHistogram: {},
    };
  }

  // -- Active-only balance ---------------------------------------------------
  // Measures how evenly the *assigned* proctors share load.
  const activeLoads = workloadValues.filter((load) => load > 0);
  const activeProctorCount = activeLoads.length;

  let balanceAmongActive;
  if (activeProctorCount <= 1) {
    balanceAmongActive = activeProctorCount === 0 || totalAssignments === 1 ? 100 : 0;
  } else {
    const idealActiveLoad = totalAssignments / activeProctorCount;
    const activePenalty = activeLoads.reduce((t, l) => t + Math.abs(l - idealActiveLoad), 0);
    const maxActivePenalty = (totalAssignments - idealActiveLoad) + (activeProctorCount - 1) * idealActiveLoad;
    balanceAmongActive = maxActivePenalty === 0
      ? 100
      : clampScore(100 - (activePenalty / maxActivePenalty) * 100);
  }

  // -- Coverage breadth ------------------------------------------------------
  // Rewards spreading across more unique proctors.
  // Denominator = min(assignments, ELIGIBLE proctors) � proctors who could ever
  // be assigned (have declared availability for at least one slot).  Using the
  // full 199-proctor pool as denominator incorrectly penalises when 169 of them
  // have zero availability for any slot in the semester.
  const feasiblePoolSize = eligibleProctorCount !== null
    ? eligibleProctorCount
    : workloadValues.length;
  const idealUniqueProctors = Math.max(1, Math.min(totalAssignments, feasiblePoolSize));
  const coverageScore = clampScore((activeProctorCount / idealUniqueProctors) * 100);

  // -- Combined score: 65% balance quality + 35% coverage breadth -----------
  const proctorWorkloadBalance = clampScore(balanceAmongActive * 0.65 + coverageScore * 0.35);

  // -- Legacy penalty fields (kept for diagnostics / qualityMetrics export) -
  const sortedLoads = [...workloadValues].sort((a, b) => b - a);
  const scoringProctorCount = Math.max(1, Math.min(totalAssignments, workloadValues.length));
  const scoredLoads = sortedLoads.slice(0, scoringProctorCount);
  while (scoredLoads.length < scoringProctorCount) scoredLoads.push(0);
  const idealLoad = totalAssignments / scoringProctorCount;
  const proctorBalancePenalty = scoredLoads.reduce((total, load) => total + Math.abs(load - idealLoad), 0);
  const maxProctorBalancePenalty = scoringProctorCount <= 1
    ? 0
    : (totalAssignments - idealLoad) + ((scoringProctorCount - 1) * idealLoad);

  const proctorLoadHistogram = Object.fromEntries(
    [...workloadValues.reduce((histogram, load) => {
      histogram.set(load, (histogram.get(load) ?? 0) + 1);
      return histogram;
    }, new Map()).entries()].sort((a, b) => Number(a[0]) - Number(b[0])),
  );

  return {
    totalAssignments,
    idealLoad,
    idealActiveLoad: activeProctorCount > 0 ? totalAssignments / activeProctorCount : 0,
    scoringProctorCount,
    activeProctorCount,
    unusedProctorCount: workloadValues.filter((load) => load === 0).length,
    scoredLoads,
    proctorBalancePenalty,
    maxProctorBalancePenalty,
    balanceAmongActive,
    coverageScore,
    proctorWorkloadBalance,
    proctorLoadHistogram,
  };
};

const getDayDistance = (left, right) => Math.abs(
  (new Date(right).setHours(0, 0, 0, 0) - new Date(left).setHours(0, 0, 0, 0)) / 86400000,
);

const getMinuteDistance = (leftSlot, rightSlot) => Math.max(
  0,
  Math.round((rightSlot.startTime.getTime() - leftSlot.endTime.getTime()) / 60000),
);

const groupAssignmentsByExam = (assignments = []) => {
  const groups = new Map();
  for (const assignment of assignments) {
    if (!groups.has(assignment.examId)) groups.set(assignment.examId, []);
    groups.get(assignment.examId).push(assignment);
  }
  return groups;
};

const formatMetricLabel = (key) => key
  .replace(/([A-Z])/g, ' $1')
  .replace(/^./, (char) => char.toUpperCase());

const buildQualitySuggestions = (metrics) => {
  const suggestions = [];

  if (metrics.roomUtilization < 75) {
    suggestions.push('Use smaller rooms or combine compatible room allocations to reduce unused seats.');
  }
  if (metrics.proctorWorkloadBalance < 75) {
    suggestions.push('Rebalance assignments across available proctors so workload stays closer to the ideal load.');
  }
  if (metrics.studentSpacing < 75) {
    suggestions.push('Move same-student exams away from same-day or back-to-back slots.');
  }
  if (metrics.examDistribution < 75) {
    suggestions.push('Spread exams more evenly across exam days to reduce daily peaks.');
  }
  if (metrics.spacingBalance < 75) {
    suggestions.push('Increase one-day-or-more gaps between exams sharing students.');
  }

  return suggestions.length > 0
    ? suggestions
    : ['Schedule quality is strong across utilization, proctor balance, spacing, and distribution.'];
};

const calculateStudentSpacingMetrics = (studentSlotEntries) => {
  let totalPairs = 0;
  let preferredGapSatisfied = 0;
  let spacingPenalty = 0;
  let sameDayPairCount = 0;
  let backToBackPairCount = 0;

  for (const slots of studentSlotEntries.values()) {
    const orderedSlots = [...slots].sort((a, b) => a.startTime - b.startTime);
    for (let leftIndex = 0; leftIndex < orderedSlots.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < orderedSlots.length; rightIndex += 1) {
        const leftSlot = orderedSlots[leftIndex];
        const rightSlot = orderedSlots[rightIndex];
        const gapDays = getDayDistance(leftSlot.startTime, rightSlot.startTime);

        totalPairs += 1;
        if (gapDays >= 1) {
          preferredGapSatisfied += 1;
          continue;
        }

        sameDayPairCount += 1;
        const minuteGap = getMinuteDistance(leftSlot, rightSlot);
        const isBackToBack = minuteGap <= 30;
        if (isBackToBack) backToBackPairCount += 1;
        spacingPenalty += isBackToBack ? 100 : 70;
      }
    }
  }

  return {
    totalPairs,
    preferredGapSatisfied,
    sameDayPairCount,
    backToBackPairCount,
    studentSpacing: totalPairs === 0 ? 100 : clampScore(100 - (spacingPenalty / totalPairs)),
    spacingBalance: totalPairs === 0 ? 100 : clampScore((preferredGapSatisfied / totalPairs) * 100),
  };
};

const evaluateDraftSchedule = ({ normalized, draft }) => {
  const examById = new Map(normalized.exams.map((exam) => [exam.id, exam]));
  const roomById = new Map(normalized.rooms.map((room) => [room.id, room]));
  const proctorIds = normalized.proctors.map((proctor) => proctor.id);
  const slotById = new Map(normalized.timeSlots.map((slot) => [slot.id, slot]));
  const assignmentsByExam = groupAssignmentsByExam(draft.assignmentInserts);

  let totalUsedSeats = 0;
  let totalAvailableSeats = 0;
  const proctorWorkloads = new Map(proctorIds.map((id) => [id, 0]));
  const studentSlotEntries = new Map();
  const dayExamCounts = new Map(
    [...new Set(normalized.timeSlots.map((slot) => toDateKey(slot.date ?? slot.startTime)))]
      .map((dayKey) => [dayKey, 0]),
  );
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
    totalUsedSeats += Math.min(exam.requiredSeats, capacity);
    totalAvailableSeats += capacity;

    const uniqueProctorIds = new Set(assignments.map((assignment) => assignment.proctorId));
    for (const proctorId of uniqueProctorIds) {
      proctorWorkloads.set(proctorId, (proctorWorkloads.get(proctorId) ?? 0) + 1);
    }

    centerSpreadPenalty += Math.max(0, new Set(uniqueRooms.map((room) => room.centerId)).size - 1);

    const dayKey = toDateKey(slot.date ?? slot.startTime);
    dayExamCounts.set(dayKey, (dayExamCounts.get(dayKey) ?? 0) + 1);

    for (const studentId of exam.studentIds) {
      if (!studentSlotEntries.has(studentId)) studentSlotEntries.set(studentId, []);
      studentSlotEntries.get(studentId).push(slot);
    }
  }

  const roomUtilization = totalAvailableSeats === 0
    ? 0
    : clampScore((totalUsedSeats / totalAvailableSeats) * 100);

  const workloadValues = [...proctorWorkloads.values()];
  // Eligible proctors = those with availability for at least one slot in THIS semester.
  // proctorsBySlotId is built from current-semester slots only, so it correctly
  // excludes proctors whose declared availability belongs to other semesters.
  const semesterEligibleProctors = new Set();
  for (const slot of normalized.timeSlots) {
    for (const p of (normalized.proctorsBySlotId?.get(slot.id) ?? [])) {
      semesterEligibleProctors.add(p.id);
    }
  }
  const eligibleProctorCount = semesterEligibleProctors.size;
  const proctorBalance = calculateProctorWorkloadBalance(workloadValues, eligibleProctorCount);

  const spacingMetrics = calculateStudentSpacingMetrics(studentSlotEntries);
  const distributionValues = [...dayExamCounts.values()];
  const distributionVariance = variance(distributionValues);
  const maxDistributionVariance = assignmentsByExam.size > 0 && distributionValues.length > 1
    ? ((assignmentsByExam.size ** 2) * (distributionValues.length - 1)) / (distributionValues.length ** 2)
    : 0;
  const examDistribution = maxDistributionVariance === 0
    ? (assignmentsByExam.size > 0 ? 100 : 0)
    : clampScore(100 - ((distributionVariance / maxDistributionVariance) * 100));

  const centerProximity = clampScore(100 - (centerSpreadPenalty * 8));
  const metrics = {
    roomUtilization: roundMetric(roomUtilization),
    proctorWorkloadBalance: roundMetric(proctorBalance.proctorWorkloadBalance),
    studentSpacing: roundMetric(spacingMetrics.studentSpacing),
    examDistribution: roundMetric(examDistribution),
    spacingBalance: roundMetric(spacingMetrics.spacingBalance),
    centerProximity: roundMetric(centerProximity),
  };
  const weakestMetricScore = Math.min(
    metrics.roomUtilization,
    metrics.proctorWorkloadBalance,
    metrics.studentSpacing,
    metrics.examDistribution,
  );
  const weightedScore = roundMetric(
    (metrics.roomUtilization * QUALITY_WEIGHTS.roomUtilization)
    + (metrics.proctorWorkloadBalance * QUALITY_WEIGHTS.proctorWorkloadBalance)
    + (metrics.studentSpacing * QUALITY_WEIGHTS.studentSpacing)
    + (metrics.examDistribution * QUALITY_WEIGHTS.examDistribution)
  );
  const weakestMetricPenalty = (100 - weakestMetricScore) * WEAKEST_METRIC_PENALTY_WEIGHT;
  const score = roundMetric(clampScore(weightedScore - weakestMetricPenalty));

  const weakAreas = Object.entries(metrics)
    .filter(([key]) => key !== 'centerProximity')
    .filter(([, value]) => value < 75)
    .map(([key, value]) => ({ area: key, label: formatMetricLabel(key), score: value }));
  const suggestions = buildQualitySuggestions(metrics);

  return {
    score,
    scorePercent: `${score}%`,
    weakAreas,
    suggestions,
    metrics,
    qualityMetrics: {
      ...metrics,
      totalUsedSeats,
      totalAvailableSeats,
      totalAssignments: proctorBalance.totalAssignments,
      totalProctors: proctorIds.length,
      activeProctorCount: proctorBalance.activeProctorCount,
      unusedProctorCount: proctorBalance.unusedProctorCount,
      proctorBalanceScoringPool: proctorBalance.scoringProctorCount,
      idealProctorLoad: roundMetric(proctorBalance.idealLoad),
      idealActiveProctorLoad: roundMetric(proctorBalance.idealActiveLoad),
      proctorBalancePenalty: roundMetric(proctorBalance.proctorBalancePenalty),
      normalizedProctorBalancePenalty: roundMetric(100 - proctorBalance.proctorWorkloadBalance),
      proctorBalanceAmongActive: roundMetric(proctorBalance.balanceAmongActive),
      proctorCoverageScore: roundMetric(proctorBalance.coverageScore),
      proctorLoadHistogram: proctorBalance.proctorLoadHistogram,
      proctorScoredLoads: proctorBalance.scoredLoads,
      totalStudentExamPairs: spacingMetrics.totalPairs,
      preferredGapSatisfied: spacingMetrics.preferredGapSatisfied,
      sameDayPairCount: spacingMetrics.sameDayPairCount,
      backToBackPairCount: spacingMetrics.backToBackPairCount,
      weightedScore,
      weakestMetricScore,
      weakestMetricPenalty: roundMetric(weakestMetricPenalty),
      distributionVariance: roundMetric(distributionVariance),
      normalizedDistributionVariance: roundMetric(100 - examDistribution),
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

const createUsageFromDraft = ({ normalized, draft, excludedExamId = null, excludedExamIds = null }) => {
  const usage = createUsageTracker(normalized.existingAssignments, normalized.lookups);
  const examById = new Map(normalized.exams.map((exam) => [exam.id, exam]));
  const slotById = new Map(normalized.timeSlots.map((slot) => [slot.id, slot]));
  const reservedStudentExamSlots = new Set();
  const excludedSet = excludedExamIds instanceof Set
    ? excludedExamIds
    : excludedExamId
      ? new Set([excludedExamId])
      : null;

  for (const assignment of draft.assignmentInserts) {
    if (excludedSet?.has(assignment.examId)) continue;
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

const isSameDraftAssignment = (left, right) => left.examId === right.examId
  && left.roomId === right.roomId
  && left.proctorId === right.proctorId
  && left.timeSlotId === right.timeSlotId;

const createUsageFromDraftExcludingAssignment = ({ normalized, draft, excludedAssignment }) => {
  const usage = createUsageTracker(normalized.existingAssignments, normalized.lookups);
  const examById = new Map(normalized.exams.map((exam) => [exam.id, exam]));
  const slotById = new Map(normalized.timeSlots.map((slot) => [slot.id, slot]));
  const reservedStudentExamSlots = new Set();
  let skipped = false;

  for (const assignment of draft.assignmentInserts) {
    if (!skipped && isSameDraftAssignment(assignment, excludedAssignment)) {
      skipped = true;
      continue;
    }
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

const replaceAssignmentProctor = ({ draft, targetAssignment, replacementProctorId }) => {
  let replaced = false;
  return {
    ...draft,
    assignmentInserts: draft.assignmentInserts.map((assignment) => {
      if (!replaced && isSameDraftAssignment(assignment, targetAssignment)) {
        replaced = true;
        return { ...assignment, proctorId: replacementProctorId };
      }
      return assignment;
    }),
  };
};

// Computes the theoretical maximum ProctorBalance score achievable given current
// proctor availability declarations. Uses a greedy round-robin that assigns each
// "proctor slot" in the draft to the least-loaded eligible proctor.
// Result tells us whether the current score is near the feasibility ceiling or
// whether the refiner is leaving improvements on the table.
const computeProctorBalanceCeiling = ({ normalized, draft }) => {
  const slotById = new Map(normalized.timeSlots.map((slot) => [slot.id, slot]));

  // Group draft assignments by slot
  const assignmentsBySlot = new Map();
  for (const assignment of draft.assignmentInserts) {
    if (!assignmentsBySlot.has(assignment.timeSlotId)) {
      assignmentsBySlot.set(assignment.timeSlotId, []);
    }
    assignmentsBySlot.get(assignment.timeSlotId).push(assignment);
  }

  // For each slot, count eligible proctors (availability only, no load/booking constraint)
  const eligibleCountBySlot = new Map();
  for (const slotId of assignmentsBySlot.keys()) {
    const count = normalized.proctors.filter((p) => p.availableTimeSlotIds?.has(slotId)).length;
    eligibleCountBySlot.set(slotId, count);
  }

  const slotEligibleCounts = [...eligibleCountBySlot.values()];
  const minEligible = slotEligibleCounts.length > 0 ? Math.min(...slotEligibleCounts) : 0;
  const maxEligible = slotEligibleCounts.length > 0 ? Math.max(...slotEligibleCounts) : 0;
  const avgEligible = slotEligibleCounts.length > 0
    ? slotEligibleCounts.reduce((t, v) => t + v, 0) / slotEligibleCounts.length
    : 0;

  // Greedy assignment: most-constrained slots first, pick least-loaded eligible proctor
  const sortedSlots = [...assignmentsBySlot.entries()]
    .sort((a, b) => (eligibleCountBySlot.get(a[0]) ?? 0) - (eligibleCountBySlot.get(b[0]) ?? 0));

  const greedyLoad = new Map(normalized.proctors.map((p) => [p.id, 0]));
  const greedySlotBooked = new Map();
  let unassignable = 0;

  for (const [slotId, assignments] of sortedSlots) {
    const eligible = normalized.proctors
      .filter((p) => p.availableTimeSlotIds?.has(slotId));
    const booked = greedySlotBooked.get(slotId) ?? new Set();

    for (let i = 0; i < assignments.length; i++) {
      const available = eligible
        .filter((p) => !booked.has(p.id))
        .sort((a, b) => (greedyLoad.get(a.id) ?? 0) - (greedyLoad.get(b.id) ?? 0));

      if (available.length === 0) { unassignable += 1; continue; }
      const chosen = available[0];
      greedyLoad.set(chosen.id, (greedyLoad.get(chosen.id) ?? 0) + 1);
      booked.add(chosen.id);
      greedySlotBooked.set(slotId, booked);
    }
  }

  const workloadValues = [...greedyLoad.values()];
  // Eligible = unique proctors available for any slot in this semester
  const ceilingEligibleSet = new Set();
  for (const slot of normalized.timeSlots) {
    for (const p of (normalized.proctorsBySlotId?.get(slot.id) ?? [])) {
      ceilingEligibleSet.add(p.id);
    }
  }
  const ceilingEligible = ceilingEligibleSet.size;
  const ceiling = calculateProctorWorkloadBalance(workloadValues, ceilingEligible);

  return {
    minEligiblePerSlot: minEligible,
    maxEligiblePerSlot: maxEligible,
    avgEligiblePerSlot: avgEligible,
    unassignable,
    ceilingScore: ceiling.proctorWorkloadBalance,
    ceilingActiveProctors: ceiling.activeProctorCount,
    ceilingBalanceAmongActive: ceiling.balanceAmongActive,
    ceilingCoverageScore: ceiling.coverageScore,
    ceilingHistogram: ceiling.proctorLoadHistogram,
  };
};

const buildDraftProctorLoadStats = ({ normalized, draft }) => {
  const proctorIds = normalized.proctors.map((proctor) => proctor.id);
  const loadByProctorId = new Map(proctorIds.map((id) => [id, 0]));
  for (const assignment of draft.assignmentInserts) {
    loadByProctorId.set(assignment.proctorId, (loadByProctorId.get(assignment.proctorId) ?? 0) + 1);
  }
  const totalAssignments = [...loadByProctorId.values()].reduce((total, load) => total + load, 0);
  const scoringProctorCount = Math.max(1, Math.min(totalAssignments, proctorIds.length));
  const idealLoad = totalAssignments === 0 ? 0 : totalAssignments / scoringProctorCount;
  const stats = normalized.proctors.map((proctor) => {
    const load = loadByProctorId.get(proctor.id) ?? 0;
    return {
      proctor,
      load,
      idealLoad,
      deviation: Math.abs(load - idealLoad),
      overload: load - idealLoad,
    };
  });
  const activeStats = stats.filter((entry) => entry.load > 0);

  return {
    idealLoad,
    scoringProctorCount,
    loadByProctorId,
    overloaded: activeStats.filter((entry) => entry.overload > 0.25).sort((a, b) => b.overload - a.overload || b.deviation - a.deviation),
    underused: stats.filter((entry) => entry.load < idealLoad).sort((a, b) => a.load - b.load || b.deviation - a.deviation),
  };
};

const runProctorRebalancePass = ({ normalized, draft, originalEvaluation }) => {
  if ((draft.qualityEvaluation?.metrics?.proctorWorkloadBalance ?? 100) >= 85) {
    return { draft, repairs: [] };
  }

  let bestDraft = draft;
  const repairs = [];
  const examById = new Map(normalized.exams.map((exam) => [exam.id, exam]));
  const slotById = new Map(normalized.timeSlots.map((slot) => [slot.id, slot]));
  let reassignmentCount = 0;

  while (reassignmentCount < PROCTOR_REBALANCE_MAX_REASSIGNMENTS) {
    const stats = buildDraftProctorLoadStats({ normalized, draft: bestDraft });

    // -- First-iteration diagnosis (printed once per rebalance call) ----------
    if (reassignmentCount === 0) {
      const diagUnderused = stats.underused.length;
      const diagOverloaded = stats.overloaded.length;
      const diagTotalProctors = normalized.proctors.length;
      const diagActiveProctors = normalized.proctors.filter(
        (p) => (stats.loadByProctorId.get(p.id) ?? 0) > 0,
      ).length;
      console.warn(
        `[PROCTOR_DIAG] Pool: total=${diagTotalProctors} active=${diagActiveProctors}`
        + ` overloaded=${diagOverloaded} underused=${diagUnderused}`
        + ` idealLoad=${stats.idealLoad.toFixed(2)}`,
      );

      // Theoretical ceiling under availability constraints
      const ceiling = computeProctorBalanceCeiling({ normalized, draft: bestDraft });
      console.warn(
        `[PROCTOR_DIAG] Ceiling: score=${ceiling.ceilingScore.toFixed(1)}%`
        + ` active=${ceiling.ceilingActiveProctors}`
        + ` balanceAmongActive=${ceiling.ceilingBalanceAmongActive.toFixed(1)}%`
        + ` coverage=${ceiling.ceilingCoverageScore.toFixed(1)}%`
        + ` eligiblePerSlot=min:${ceiling.minEligiblePerSlot} avg:${ceiling.avgEligiblePerSlot.toFixed(1)} max:${ceiling.maxEligiblePerSlot}`
        + ` unassignable=${ceiling.unassignable}`,
      );

      // Per-assignment availability probe for top overloaded proctors
      // Now probes ALL proctors with lower load (not just underused ones)
      let rejNoAvailSlot = 0;
      let rejAlreadyBooked = 0;
      let rejDailyMax = 0;
      let rejHardConstraint = 0;
      let rejNoBalanceGain = 0;
      let diagFeasible = 0;

      for (const overloadedEntry of stats.overloaded.slice(0, 3)) {
        const diagAssignments = bestDraft.assignmentInserts.filter(
          (a) => a.proctorId === overloadedEntry.proctor.id,
        );
        for (const diagAssign of diagAssignments) {
          const diagSlot = slotById.get(diagAssign.timeSlotId);
          if (!diagSlot) continue;
          const diagDayKey = toDateKey(diagSlot.date ?? diagSlot.startTime);
          const diagUsage = createUsageFromDraftExcludingAssignment({
            normalized, draft: bestDraft, excludedAssignment: diagAssign,
          });
          // Probe ALL proctors with lower load (includes active low-load proctors)
          const probePool = normalized.proctors
            .filter((p) => p.id !== diagAssign.proctorId)
            .filter((p) => (stats.loadByProctorId.get(p.id) ?? 0) < overloadedEntry.load)
            .slice(0, 80);
          for (const rp of probePool) {
            if (!rp.availableTimeSlotIds?.has(diagSlot.id)) { rejNoAvailSlot += 1; continue; }
            if (diagUsage.proctorSlotMap.get(rp.id)?.has(diagSlot.id)) { rejAlreadyBooked += 1; continue; }
            const rpDayKey = `${rp.id}:${diagDayKey}`;
            if ((diagUsage.proctorDailyLoadMap.get(rpDayKey) ?? 0) >= rp.maxExamsPerDay) {
              rejDailyMax += 1; continue;
            }
            diagFeasible += 1;
            const diagCandidate = replaceAssignmentProctor({
              draft: bestDraft,
              targetAssignment: diagAssign,
              replacementProctorId: rp.id,
            });
            const diagIssues = confirmHybridDraft({ draft: diagCandidate, normalized });
            if (diagIssues.length > 0) { rejHardConstraint += 1; diagFeasible -= 1; continue; }
            const diagEval = withQualityEvaluation(normalized, diagCandidate, originalEvaluation);
            const diagBal = diagEval.qualityEvaluation.metrics.proctorWorkloadBalance
              - bestDraft.qualityEvaluation.metrics.proctorWorkloadBalance;
            if (diagBal <= 0) { rejNoBalanceGain += 1; }
          }
        }
      }
      console.warn(
        `[PROCTOR_DIAG] Rejection reasons (top-3 overloaded � lower-load pool):`
        + ` noAvailability=${rejNoAvailSlot}`
        + ` alreadyBooked=${rejAlreadyBooked}`
        + ` dailyMax=${rejDailyMax}`
        + ` hardConstraint=${rejHardConstraint}`
        + ` noBalanceGain=${rejNoBalanceGain}`
        + ` actuallyFeasible=${diagFeasible}`,
      );
    }
    // -- End diagnosis --------------------------------------------------------

    // Break only if there are no overloaded proctors (underused-pool exhaustion is
    // no longer a reliable exit: we now use a broader candidate pool below).
    if (stats.overloaded.length === 0) break;

    let bestMove = null;

    for (const overloadedEntry of stats.overloaded.slice(0, PROCTOR_REBALANCE_OVERLOADED_SCAN_LIMIT)) {
      const overloadedAssignments = bestDraft.assignmentInserts
        .filter((assignment) => assignment.proctorId === overloadedEntry.proctor.id)
        .sort((a, b) => {
          const examA = examById.get(a.examId);
          const examB = examById.get(b.examId);
          return (examB?.studentIds?.length ?? 0) - (examA?.studentIds?.length ?? 0);
        });

      for (const assignment of overloadedAssignments) {
        const exam = examById.get(assignment.examId);
        const slot = slotById.get(assignment.timeSlotId);
        const room = normalized.rooms.find((candidateRoom) => candidateRoom.id === assignment.roomId);
        if (!exam || !slot || !room) continue;

        const slotDayKey = toDateKey(slot.date ?? slot.startTime);
        const usage = createUsageFromDraftExcludingAssignment({ normalized, draft: bestDraft, excludedAssignment: assignment });

        // -- Broader candidate pool -----------------------------------------
        // Previously only zero-load proctors (load < idealLoad=1) were candidates.
        // That excluded active proctors with low loads who could absorb assignments
        // from overloaded proctors and improve balanceAmongActive.
        // Now: any proctor with load strictly less than the overloaded proctor's
        // load is eligible, sorted least-loaded first so least-loaded gets priority.
        const replacementCandidates = normalized.proctors
          .filter((proctor) => proctor.id !== assignment.proctorId)
          .filter((proctor) => (stats.loadByProctorId.get(proctor.id) ?? 0) < overloadedEntry.load)
          .sort((a, b) => (stats.loadByProctorId.get(a.id) ?? 0) - (stats.loadByProctorId.get(b.id) ?? 0))
          .filter((proctor) => isProctorAvailableForSlot(proctor, slot, usage, slotDayKey))
          .slice(0, PROCTOR_REBALANCE_CANDIDATE_LIMIT);

        for (const replacementProctor of replacementCandidates) {
          const candidateDraft = replaceAssignmentProctor({
            draft: bestDraft,
            targetAssignment: assignment,
            replacementProctorId: replacementProctor.id,
          });
          const hardIssues = confirmHybridDraft({ draft: candidateDraft, normalized });
          if (hardIssues.length > 0) continue;

          const evaluatedDraft = withQualityEvaluation(normalized, candidateDraft, originalEvaluation);
          const scoreGain = evaluatedDraft.qualityEvaluation.score - bestDraft.qualityEvaluation.score;
          const balanceGain = evaluatedDraft.qualityEvaluation.metrics.proctorWorkloadBalance
            - bestDraft.qualityEvaluation.metrics.proctorWorkloadBalance;
          if (balanceGain <= 0) continue;

          const recipientLoad = stats.loadByProctorId.get(replacementProctor.id) ?? 0;
          const moveRank = (balanceGain * 5) + scoreGain + Math.max(0, stats.idealLoad - recipientLoad);
          if (!bestMove
            || moveRank > bestMove.moveRank + PROTECTED_METRIC_TIE_TOLERANCE
            || (
              Math.abs(moveRank - bestMove.moveRank) <= PROTECTED_METRIC_TIE_TOLERANCE
              && isProtectedCandidatePreferred(evaluatedDraft, bestMove.evaluatedDraft)
            )) {
            bestMove = {
              assignment,
              replacementProctor,
              evaluatedDraft,
              scoreGain,
              balanceGain,
              moveRank,
            };
          }
        }
      }
    }

    if (!bestMove) break;

    repairs.push({
      examId: bestMove.assignment.examId,
      fromProctorId: bestMove.assignment.proctorId,
      toProctorId: bestMove.replacementProctor.id,
      fromScore: bestDraft.qualityEvaluation.score,
      toScore: bestMove.evaluatedDraft.qualityEvaluation.score,
      improvement: roundMetric(bestMove.scoreGain),
      proctorBalanceImprovement: roundMetric(bestMove.balanceGain),
      focusMetric: 'proctorWorkloadBalance',
      moveAudit: buildMoveAudit({ normalized, beforeDraft: bestDraft, afterDraft: bestMove.evaluatedDraft }),
    });
    bestDraft = bestMove.evaluatedDraft;
    reassignmentCount += 1;

    if ((bestDraft.qualityEvaluation.metrics.proctorWorkloadBalance ?? 0) >= 85) break;
  }

  return { draft: bestDraft, repairs };
};

const formatClockLabel = (date) => `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;

const getAssignmentBundleSignature = (draft, examId) => {
  const assignments = draft.assignmentInserts.filter((assignment) => assignment.examId === examId);
  const roomIds = [...new Set(assignments.map((assignment) => assignment.roomId))].sort();
  const proctorIds = [...new Set(assignments.map((assignment) => assignment.proctorId))].sort();
  const timeSlotIds = [...new Set(assignments.map((assignment) => assignment.timeSlotId))].sort();
  return { roomIds, proctorIds, timeSlotIds };
};

const buildAssignmentBundleSnapshot = ({ normalized, draft, examId }) => {
  const exam = normalized.exams.find((candidate) => candidate.id === examId) ?? null;
  const signature = getAssignmentBundleSignature(draft, examId);
  const timeSlot = signature.timeSlotIds.length > 0
    ? normalized.timeSlots.find((candidate) => candidate.id === signature.timeSlotIds[0])
    : null;

  return {
    examId,
    examCode: exam?.courseOffering?.course?.code ?? null,
    examTitle: exam?.courseOffering?.course?.title ?? null,
    roomIds: signature.roomIds,
    roomNames: signature.roomIds.map((roomId) => normalized.rooms.find((room) => room.id === roomId)?.name ?? roomId),
    proctorIds: signature.proctorIds,
    proctorNames: signature.proctorIds.map((proctorId) => normalized.proctors.find((proctor) => proctor.id === proctorId)?.user?.name ?? proctorId),
    timeSlotIds: signature.timeSlotIds,
    timeslot: timeSlot ? `${formatClockLabel(timeSlot.startTime)}�${formatClockLabel(timeSlot.endTime)}` : null,
    date: timeSlot ? toDateKey(timeSlot.date ?? timeSlot.startTime) : null,
    duration: getEffectiveExamDuration(exam?.duration ?? null),
  };
};

const sameIdList = (left = [], right = []) => left.length === right.length && left.every((value, index) => value === right[index]);

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
        normalizedPenalty: candidate.penalty,
        penaltyComponents: candidate.penalty.components,
      },
    ],
  };
};

const formatClock = (date) => `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;

const uniqueSortedIds = (values = []) => [...new Set(values)].sort();

const areIdListsEqual = (left = [], right = []) => {
  const normalizedLeft = uniqueSortedIds(left);
  const normalizedRight = uniqueSortedIds(right);
  if (normalizedLeft.length !== normalizedRight.length) return false;
  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
};

const buildMoveSnapshots = (normalized, draft, examIds = []) => {
  const examById = new Map(normalized.exams.map((exam) => [exam.id, exam]));
  const roomById = new Map(normalized.rooms.map((room) => [room.id, room]));
  const proctorById = new Map(normalized.proctors.map((proctor) => [proctor.id, proctor]));
  const slotById = new Map(normalized.timeSlots.map((slot) => [slot.id, slot]));

  return examIds.map((examId) => {
    const exam = examById.get(examId) ?? null;
    const assignments = draft.assignmentInserts.filter((assignment) => assignment.examId === examId);
    const roomIds = uniqueSortedIds(assignments.map((assignment) => assignment.roomId));
    const proctorIds = uniqueSortedIds(assignments.map((assignment) => assignment.proctorId));
    const timeSlotIds = uniqueSortedIds(assignments.map((assignment) => assignment.timeSlotId));
    const slot = slotById.get(timeSlotIds[0]) ?? null;

    return {
      examId,
      examLabel: exam?.title ?? exam?.courseOffering?.course?.title ?? examId,
      room: roomIds.map((roomId) => roomById.get(roomId)?.name ?? roomId).join(', '),
      proctor: proctorIds.map((proctorId) => proctorById.get(proctorId)?.user?.name ?? proctorId).join(', '),
      timeslot: slot ? `${formatClock(slot.startTime)}�${formatClock(slot.endTime)}` : null,
      date: slot ? toDateKey(slot.date ?? slot.startTime) : null,
      duration: getEffectiveExamDuration(exam?.duration),
      roomIds,
      proctorIds,
      timeSlotIds,
    };
  });
};

const classifyMoveType = (beforeSnapshots, afterSnapshots) => {
  if (beforeSnapshots.length !== 1 || afterSnapshots.length !== 1) return 'MULTI_CHANGE';

  const before = beforeSnapshots[0];
  const after = afterSnapshots[0];
  const roomChanged = !areIdListsEqual(before.roomIds, after.roomIds);
  const proctorChanged = !areIdListsEqual(before.proctorIds, after.proctorIds);
  const slotChanged = !areIdListsEqual(before.timeSlotIds, after.timeSlotIds)
    || before.date !== after.date
    || before.timeslot !== after.timeslot;

  if (slotChanged && roomChanged && proctorChanged) return 'MULTI_CHANGE';
  if (slotChanged && roomChanged) return 'ROOM+TIMESLOT';
  if (slotChanged && proctorChanged) return 'MULTI_CHANGE';
  if (slotChanged) return 'TIMESLOT_CHANGE';
  if (roomChanged && proctorChanged) return 'MULTI_CHANGE';
  if (roomChanged) return 'ROOM_ONLY';
  if (proctorChanged) return 'PROCTOR_ONLY';
  return 'MULTI_CHANGE';
};

const buildMetricDeltas = (beforeMetrics = {}, afterMetrics = {}) => ({
  score: roundMetric((afterMetrics.score ?? 0) - (beforeMetrics.score ?? 0)),
  roomUtilization: roundMetric((afterMetrics.roomUtilization ?? 0) - (beforeMetrics.roomUtilization ?? 0)),
  proctorWorkloadBalance: roundMetric((afterMetrics.proctorWorkloadBalance ?? 0) - (beforeMetrics.proctorWorkloadBalance ?? 0)),
  studentSpacing: roundMetric((afterMetrics.studentSpacing ?? 0) - (beforeMetrics.studentSpacing ?? 0)),
  examDistribution: roundMetric((afterMetrics.examDistribution ?? 0) - (beforeMetrics.examDistribution ?? 0)),
  spacingBalance: roundMetric((afterMetrics.spacingBalance ?? 0) - (beforeMetrics.spacingBalance ?? 0)),
});

const buildMoveAudit = ({ normalized, beforeDraft, afterDraft, examIds = [] }) => {
  const beforeIds = [...new Set(beforeDraft.assignmentInserts.map((assignment) => assignment.examId))];
  const afterIds = [...new Set(afterDraft.assignmentInserts.map((assignment) => assignment.examId))];
  const trackedExamIds = examIds.length > 0
    ? examIds
    : [...new Set([...beforeIds, ...afterIds])].filter((examId) => {
      const beforeSignature = getAssignmentBundleSignature(beforeDraft, examId);
      const afterSignature = getAssignmentBundleSignature(afterDraft, examId);
      return !sameIdList(beforeSignature.roomIds, afterSignature.roomIds)
        || !sameIdList(beforeSignature.proctorIds, afterSignature.proctorIds)
        || !sameIdList(beforeSignature.timeSlotIds, afterSignature.timeSlotIds);
    });
  const beforeSnapshots = buildMoveSnapshots(normalized, beforeDraft, trackedExamIds);
  const afterSnapshots = buildMoveSnapshots(normalized, afterDraft, trackedExamIds);
  const metricDeltas = buildMetricDeltas(
    beforeDraft.qualityEvaluation?.metrics ?? {},
    afterDraft.qualityEvaluation?.metrics ?? {},
  );
  const entries = trackedExamIds.map((examId, index) => {
    const before = beforeSnapshots[index] ?? null;
    const after = afterSnapshots[index] ?? null;
    const timingChanged = Boolean(before && after && (
      before.date !== after.date
      || before.timeslot !== after.timeslot
      || before.duration !== after.duration
    ));

    return {
      examId,
      examLabel: after?.examLabel ?? before?.examLabel ?? examId,
      moveType: classifyMoveType(before ? [before] : [], after ? [after] : []),
      timingChanged,
      before,
      after,
      metricDeltas,
    };
  });
  return {
    moveType: classifyMoveType(beforeSnapshots, afterSnapshots),
    examIds: trackedExamIds,
    before: beforeSnapshots.length === 1 ? beforeSnapshots[0] : beforeSnapshots,
    after: afterSnapshots.length === 1 ? afterSnapshots[0] : afterSnapshots,
    metricDeltas,
    entries,
  };
};

const getLocalSearchMoveAudits = (repairs = []) => repairs
  .map((repair) => repair.moveAudit)
  .filter(Boolean);

const PROTECTED_METRIC_TIE_TOLERANCE = 0.5;

const compareProtectedMetricCandidates = (leftDraft, rightDraft) => {
  const leftScore = leftDraft?.qualityEvaluation?.score ?? -Infinity;
  const rightScore = rightDraft?.qualityEvaluation?.score ?? -Infinity;
  const scoreDiff = leftScore - rightScore;
  if (Math.abs(scoreDiff) > PROTECTED_METRIC_TIE_TOLERANCE) return scoreDiff;

  const leftMetrics = leftDraft?.qualityEvaluation?.metrics ?? {};
  const rightMetrics = rightDraft?.qualityEvaluation?.metrics ?? {};
  const spacingDiff = (leftMetrics.studentSpacing ?? 0) - (rightMetrics.studentSpacing ?? 0);
  if (spacingDiff !== 0) return spacingDiff;

  const spacingBalanceDiff = (leftMetrics.spacingBalance ?? 0) - (rightMetrics.spacingBalance ?? 0);
  if (spacingBalanceDiff !== 0) return spacingBalanceDiff;

  return scoreDiff;
};

const isProtectedCandidatePreferred = (candidateDraft, currentBestDraft) => compareProtectedMetricCandidates(candidateDraft, currentBestDraft) > 0;

const shouldAcceptProtectedMetricRecovery = (beforeDraft, afterDraft) => {
  if (!beforeDraft || !afterDraft) return false;
  const beforeMetrics = beforeDraft.qualityEvaluation?.metrics ?? {};
  const afterMetrics = afterDraft.qualityEvaluation?.metrics ?? {};
  const beforeScore = beforeDraft.qualityEvaluation?.score ?? 0;
  const afterScore = afterDraft.qualityEvaluation?.score ?? 0;

  return afterMetrics.studentSpacing >= beforeMetrics.studentSpacing
    && afterMetrics.spacingBalance >= beforeMetrics.spacingBalance
    && afterMetrics.roomUtilization >= beforeMetrics.roomUtilization
    && afterScore >= beforeScore - 1;
};

const runProtectedSpacingRecoveryPass = ({ normalized, draft, originalEvaluation, sortedRooms, fittingSlotCache, slotDayKeys }) => {
  const recovery = runFocusedRelocationPass({
    normalized,
    draft,
    originalEvaluation,
    sortedRooms,
    fittingSlotCache,
    slotDayKeys,
    focusMetric: 'studentSpacing',
    maxExams: 8,
    candidateLimit: 8,
    maxEvaluations: 6,
    minGain: -1,
  });

  if (recovery.draft === draft) return { draft, repairs: [] };
  if (!shouldAcceptProtectedMetricRecovery(draft, recovery.draft)) return { draft, repairs: [] };

  return recovery;
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

const buildConstraintPreview = (normalized) => buildHybridDraft({
  scheduleId: 'preview',
  exams: normalized.exams,
  rooms: normalized.rooms,
  proctors: normalized.proctors,
  timeSlots: normalized.timeSlots,
  existingAssignments: normalized.existingAssignments,
  lookups: normalized.lookups,
  proctorsBySlotId: normalized.proctorsBySlotId,
});

const buildSinglePassNarrative = ({ preview, normalized }) => {
  const qualityEvaluation = preview.qualityEvaluation ?? { score: 0, weakAreas: [] };
  const weakestArea = [...(qualityEvaluation.weakAreas ?? [])].sort((left, right) => left.score - right.score)[0] ?? null;
  const blocked = preview.conflictInserts.length > 0 || preview.scheduledExamIds.length !== normalized.exams.length;

  return {
    highBaseline: false,
    lowGain: false,
    weakestMetric: weakestArea?.area ?? null,
    weakestMetricScore: weakestArea?.score ?? null,
    headline: blocked
      ? 'Smart scheduling stopped at the first unschedulable exam.'
      : 'Smart generation and bounded refinement produced the final schedule.',
    detailLines: blocked
      ? [NO_VALID_SCHEDULE_MESSAGE]
      : [
        `Final schedule quality settled at ${qualityEvaluation.score ?? 0}% after bounded refinement.`,
        weakestArea ? `Current weakest quality area: ${weakestArea.label} (${weakestArea.score}%).` : 'No material weak area remains in the generated draft.',
      ],
    emphasis: blocked ? 'blocked' : 'stable',
  };
};

const buildSchedulingDraftAttempt = (normalized) => {
  const preview = buildConstraintPreview(normalized);

  return {
    preview,
    originalDraft: preview,
    refined: false,
    isComplete: preview.conflictInserts.length === 0 && preview.scheduledExamIds.length === normalized.exams.length,
    strategy: {
      id: preview.strategyId,
      label: preview.strategyLabel,
    },
    evaluation: {
      current: preview.qualityEvaluation,
      qualityMetrics: preview.qualityEvaluation?.qualityMetrics ?? {},
      weakAreas: preview.qualityEvaluation?.weakAreas ?? [],
      narrative: buildSinglePassNarrative({ preview, normalized }),
    },
  };
};

const buildRefinementPartialDraft = (draft, examId) => ({
  assignmentInserts: draft.assignmentInserts.filter((assignment) => assignment.examId !== examId),
  conflictInserts: [...draft.conflictInserts],
  scheduledExamIds: draft.scheduledExamIds.filter((scheduledExamId) => scheduledExamId !== examId),
  candidateScores: draft.candidateScores.filter((candidateScore) => candidateScore.examId !== examId),
});

const refineDraftSchedule = ({ normalized, draft }) => {
  let bestDraft = withQualityEvaluation(normalized, draft);
  const repairs = [];
  const sortedRooms = sortRoomsByCapacityDesc(normalized.rooms);
  const slotDayKeys = buildSlotDayKeyMap(normalized.timeSlots);
  const orderedExams = [...normalized.exams].sort(compareExamsForScheduling);
  const startedAt = Date.now();
  const changedExamIds = new Set();
  let passesExecuted = 0;

  for (let passIndex = 0; passIndex < LIGHTWEIGHT_REFINEMENT_LIMITS.maxRefinementPasses; passIndex += 1) {
    passesExecuted = passIndex + 1;
    let passImproved = false;

    for (const exam of orderedExams) {
      if (changedExamIds.size >= LIGHTWEIGHT_REFINEMENT_LIMITS.maxChangedExams) break;
      if (Date.now() - startedAt >= LIGHTWEIGHT_REFINEMENT_LIMITS.timeBudgetMs) break;

      const currentAssignments = bestDraft.assignmentInserts.filter((assignment) => assignment.examId === exam.id);
      if (currentAssignments.length === 0) continue;

      const currentBundle = buildAssignmentBundleSnapshot({ normalized, draft: bestDraft, examId: exam.id });
      const currentScore = bestDraft.qualityEvaluation?.score ?? 0;
      const usage = createUsageFromDraft({ normalized, draft: bestDraft, excludedExamId: exam.id });
      const partialDraft = buildRefinementPartialDraft(bestDraft, exam.id);
      const candidates = buildValidCandidatesForExam({
        exam,
        timeSlots: normalized.timeSlots,
        sortedRooms,
        proctors: normalized.proctors,
        usage,
        slotDayKeys,
        strategy: { id: 'lightweight-refinement', label: 'Lightweight refinement' },
        fittingSlotCache: null,
        proctorsBySlotId: normalized.proctorsBySlotId,
        scheduleId: 'preview',
        partialDraft,
        normalized,
      }).slice(0, LIGHTWEIGHT_REFINEMENT_LIMITS.maxMovesPerExam);

      let bestCandidateDraft = null;
      let bestCandidate = null;

      for (const candidate of candidates) {
        const candidateBundle = {
          roomIds: candidate.allocation.map(({ room }) => room.id),
          proctorIds: candidate.allocation.map(({ proctor }) => proctor.id),
          timeSlotIds: [candidate.slot.id],
        };
        if (
          sameIdList(currentBundle.roomIds, candidateBundle.roomIds)
          && sameIdList(currentBundle.proctorIds, candidateBundle.proctorIds)
          && sameIdList(currentBundle.timeSlotIds, candidateBundle.timeSlotIds)
        ) {
          continue;
        }

        const candidateDraft = replaceExamAssignments({ draft: bestDraft, examId: exam.id, candidate });
        const evaluatedDraft = withQualityEvaluation(normalized, candidateDraft, bestDraft.qualityEvaluation);
        if (evaluatedDraft.qualityEvaluation.score > currentScore && (!bestCandidateDraft || evaluatedDraft.qualityEvaluation.score > bestCandidateDraft.qualityEvaluation.score)) {
          bestCandidate = candidate;
          bestCandidateDraft = evaluatedDraft;
        }
      }

      if (!bestCandidateDraft) continue;

      repairs.push({
        examId: exam.id,
        moveType: classifyMoveType([currentBundle], [buildAssignmentBundleSnapshot({ normalized, draft: bestCandidateDraft, examId: exam.id })]),
        fromScore: currentScore,
        toScore: bestCandidateDraft.qualityEvaluation.score,
        improvement: roundMetric(bestCandidateDraft.qualityEvaluation.score - currentScore),
        moveAudit: buildMoveAudit({ normalized, beforeDraft: bestDraft, afterDraft: bestCandidateDraft, examIds: [exam.id] }),
      });

      bestDraft = bestCandidateDraft;
      changedExamIds.add(exam.id);
      passImproved = true;
    }

    if (!passImproved) break;
  }

  return {
    draft: bestDraft,
    repairs,
    passes: passesExecuted,
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
    issues.push('The refined draft still contains blocking hard-constraint issues.');
  }

  if (new Set(draft.scheduledExamIds).size !== normalized.exams.length) {
    issues.push('The refined draft does not assign every active exam.');
  }

  for (const assignment of draft.assignmentInserts) {
    const exam = examById.get(assignment.examId);
    const room = roomById.get(assignment.roomId);
    const proctor = proctorById.get(assignment.proctorId);
    const slot = slotById.get(assignment.timeSlotId);
    if (!exam || !room || !proctor || !slot) {
      issues.push('The refined draft references a missing exam, room, proctor, or time slot.');
      continue;
    }

    const slotDayKey = toDateKey(slot.date ?? slot.startTime);

    if (exam.studentCount <= 0 || exam.studentIds.length === 0) {
      issues.push('An exam without enrollments is present in the refined draft.');
    }

    if (!canSlotFitExam(slot, exam)) {
      issues.push('A selected time slot does not fit the exam duration or has invalid dates.');
    }

    if (room.status !== 'AVAILABLE') {
      issues.push('A selected room is not available.');
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

const collectPreValidationState = async ({ normalized, semester, constraintPreview = null, includeConstraintPreview = true, cachedStudentUserMap = null }) => {
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
    const semRange = `${fmtDate(semester.startDate)} � ${fmtDate(semester.endDate)}`;
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
    const label = [exam.courseCode, exam.courseTitle].filter(Boolean).join(' � ') || 'an offering';
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
      const courseLabel = [exam.courseCode, exam.courseTitle].filter(Boolean).join(' � ') || 'an offering';
      warnings.push(
        `"${courseLabel}" does not fit any currently valid time slot and will be reported as a blocking issue.`,
      );
    }

    const maxSlotCapacity = normalized.lookups.totalAvailableRoomCapacity ?? 0;
    if (maxSlotCapacity < exam.requiredSeats) {
      groups.courseOfferings.push(`${examLabel} requires ${exam.requiredSeats} seats, but available room capacity supports at most ${maxSlotCapacity} seats in a time slot.`);
    }

    const requiredProctors = getRequiredProctorsForExam(exam);
    // Use pre-indexed reverse map instead of O(slots � proctors) scan.
    const maxProctorCoverage = normalized.timeSlots.reduce((max, slot) => {
      if (!canSlotFitExam(slot, exam)) return max;
      return Math.max(max, normalized.proctorsBySlotId.get(slot.id)?.length ?? 0);
    }, 0);
    if (maxProctorCoverage < requiredProctors) {
      groups.proctors.push(`${examLabel} needs ${requiredProctors} proctor${requiredProctors !== 1 ? 's' : ''}, but the strongest valid time slot has only ${maxProctorCoverage} available proctor${maxProctorCoverage !== 1 ? 's' : ''}.`);
    }

    if (supervisedCapacity < exam.requiredSeats) {
      const courseLabel = [exam.courseCode, exam.courseTitle].filter(Boolean).join(' � ') || 'an offering';
      warnings.push(
        `"${courseLabel}" needs ${exam.requiredSeats} seats and ${requiredProctors} proctor${requiredProctors !== 1 ? 's' : ''} for ${exam.studentCount} enrolled student${exam.studentCount !== 1 ? 's' : ''}; current resources may be insufficient.`,
      );
    }
  }

  const allStudentIds = [...normalized.studentToExams.keys()];
  // Reuse student data if caller already fetched it (avoids a redundant DB round-trip
  // when collectPreValidationState is called twice in the same request).
  let studentUserMap;
  if (cachedStudentUserMap !== null) {
    studentUserMap = cachedStudentUserMap;
  } else {
    studentUserMap = new Map();
    if (allStudentIds.length > 0) {
      const students = await prisma.student.findMany({
        where: { id: { in: allStudentIds } },
        select: { id: true, user: { select: { name: true, email: true } } },
      });
      for (const student of students) studentUserMap.set(student.id, student.user);
    }
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
    ? (constraintPreview ?? buildSchedulingDraftAttempt(normalized).preview)
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
    studentUserMap,
  };
};

const buildValidationResponse = ({ normalized, semester, groups, warnings, constraintPreview }) => {
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
  await resetSchedulingState();
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

export const generateSchedule = async (data) => {
  await resetSchedulingState();
  const { semesterId, scheduleName } = data;
  const normalizedScheduleName = await assertScheduleNameAvailable(prisma, scheduleName);

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

  const draftAttempt = buildSchedulingDraftAttempt(normalized);
  const refinementAttempt = refineDraftSchedule({ normalized, draft: draftAttempt.preview });
  const effectivePreview = refinementAttempt.draft;
  const { groups, constraintPreview } = await collectPreValidationState({
    normalized,
    semester,
    constraintPreview: effectivePreview,
    cachedStudentUserMap: requiredDataState.studentUserMap,
  });
  const blockingIssueCount = [
    ...groups.rooms,
    ...groups.proctors,
    ...groups.timeSlots,
    ...groups.courseOfferings,
    ...groups.enrollments,
    ...groups.studentOverlapRisks,
  ].length;

  const effectivePreviewFromValidation = constraintPreview;
  const remainingBlockingIssueCount = blockingIssueCount;

  if (remainingBlockingIssueCount > 0 || effectivePreviewFromValidation.conflictInserts.length > 0) {
    throw new AppError(NO_VALID_SCHEDULE_MESSAGE, 400);
  }

  if (effectivePreviewFromValidation.scheduledExamIds.length !== normalized.exams.length) {
    throw new AppError(
      NO_VALID_SCHEDULE_MESSAGE,
      400,
    );
  }

  const confirmationIssues = confirmHybridDraft({ draft: effectivePreviewFromValidation, normalized });
  if (confirmationIssues.length > 0) {
    throw new AppError(NO_VALID_SCHEDULE_MESSAGE, 400);
  }

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
    // Note: name availability was already checked prior to the transaction.
    // Skip the redundant assert here to avoid an extra query and reduce
    // transaction duration. Rely on the DB unique constraint to catch any
    // rare race and remapScheduleNameConflict to handle it.

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
          duration: getEffectiveExamDuration(exam.duration),
        },
      });
      draftExamIdToPersistedId.set(exam.id, createdExam.id);
    }

    const schedule = await tx.schedule.create({
      data: {
        name: normalizedScheduleName,
        isFinal: false,
        algorithmType: HYBRID_ALGORITHM_TYPE,
        generationStage: GENERATION_STAGE.GENERATED,
        qualityScore: effectivePreviewFromValidation.qualityEvaluation?.score ?? Math.max(0, 100 - (effectivePreviewFromValidation.softPenalty ?? 0)),
        hardConstraintScore: 0,
        softConstraintScore: Math.round(effectivePreviewFromValidation.softPenalty ?? 0),
        algorithmMetadata: {
          pipeline: PIPELINE_STAGES,
          strategy: effectivePreviewFromValidation.strategyLabel,
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
          evaluation: effectivePreviewFromValidation.qualityEvaluation,
          refinement: {
            applied: refinementAttempt.repairs.length > 0,
            passes: refinementAttempt.passes,
            changedExams: refinementAttempt.repairs.length,
            repairs: refinementAttempt.repairs.slice(0, 10),
          },
        },
      },
    });

    const assignmentInserts = effectivePreviewFromValidation.assignmentInserts.map((assignment) => ({
      ...assignment,
      scheduleId: schedule.id,
      examId: draftExamIdToPersistedId.get(assignment.examId) ?? assignment.examId,
    }));
    const scheduledExamIds = [...effectivePreviewFromValidation.scheduledExamIds]
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

    // Avoid loading the full schedule (with all nested relations) inside the
    // transaction — this can be slow for large schedules. Instead return a
    // lightweight summary immediately and perform any expensive post-processing
    // (detailed analysis, notifications, analytics) asynchronously after the
    // transaction completes.
    const lightweightSchedule = {
      id: schedule.id,
      name: schedule.name,
      isFinal: schedule.isFinal,
      algorithmType: schedule.algorithmType,
      generationStage: schedule.generationStage,
      qualityScore: schedule.qualityScore,
      hardConstraintScore: schedule.hardConstraintScore,
      softConstraintScore: schedule.softConstraintScore,
      algorithmMetadata: schedule.algorithmMetadata,
      createdAt: schedule.createdAt,
      updatedAt: schedule.updatedAt,
      _count: { assignments: assignmentInserts.length },
    };

    return {
      fullSchedule: lightweightSchedule,
      assignmentInserts,
      scheduledExamIds,
    };
    }, {
      // Use ReadCommitted to reduce locking contention and latency while
      // preserving reasonable consistency for this workflow.
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      // Reduce timeout so clients fail faster on unexpected delays.
      timeout: 20000,
      maxWait: 5000,
    });
  } catch (error) {
    await remapScheduleNameConflict(prisma, normalizedScheduleName, error);
  }

  const { fullSchedule, assignmentInserts } = result;
  // Spawn background post-processing to perform any expensive loads or
  // analyses without delaying the response to the client. This warms caches
  // and runs validation/analytics asynchronously.
  if (result?.fullSchedule?.id) {
    const _scheduleId = result.fullSchedule.id;
    // run async, don't await
    void (async () => {
      try {
        // Load the full schedule with relations and run analysis to warm any
        // downstream consumers. Errors here are non-fatal for the generation
        // request and should be logged only.
        const full = await prisma.schedule.findUnique({ where: { id: _scheduleId }, include: generatedScheduleInclude });
        if (full) {
          // compute analysis (this is CPU/DB intensive) but useful for later
          await getScheduleAnalysis(_scheduleId);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Background schedule post-processing failed', err);
      }
    })();
  }

  return {
    scheduleId: fullSchedule.id,
    scheduleName: normalizedScheduleName,
    schedule: fullSchedule,
    assignmentsCount: assignmentInserts.length,
    message: 'Draft schedule generated successfully by the hybrid constraint-based engine with all internal hard constraints satisfied.',
    algorithm: {
      type: HYBRID_ALGORITHM_TYPE,
      pipeline: PIPELINE_STAGES,
      strategy: effectivePreviewFromValidation.strategyLabel,
      softPenalty: effectivePreviewFromValidation.softPenalty ?? 0,
      qualityMetrics: effectivePreviewFromValidation.qualityEvaluation?.qualityMetrics ?? {},
      narrative: buildSinglePassNarrative({ preview: effectivePreviewFromValidation, normalized }),
      refinement: {
        applied: refinementAttempt.repairs.length > 0,
        passes: refinementAttempt.passes,
        changedExams: refinementAttempt.repairs.length,
      },
    },
  };
};

export const getScheduleAnalysis = async (scheduleId, client = prisma) => {
  const schedule = await client.schedule.findUnique({
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
  const roomTimeRangeMap = new Map();
  const proctorSlotExamIds = new Map();
  const proctorTimeRangeMap = new Map();
  const proctorDayExamIds = new Map();
  const proctorDailyLoadViolations = [];
  const examSlotCapacity = new Map();
  const studentTimeRangeMap = new Map();
  const studentReservationKeys = new Set();
  const analysisSeen = new Set();

  const pushUnique = (list, key, value) => {
    if (analysisSeen.has(key)) return;
    analysisSeen.add(key);
    list.push(value);
  };

  const findRangeOverlap = (rangeMap, entityId, slot, examId) => {
    if (!slot?.startTime || !slot?.endTime) return null;
    return (rangeMap.get(entityId) ?? []).find((range) => (
      range.examId !== examId && timeRangesOverlap(slot.startTime, slot.endTime, range.start, range.end)
    )) ?? null;
  };

  const rememberRange = (rangeMap, entityId, assignment) => {
    const slot = assignment.timeSlot;
    if (!slot?.startTime || !slot?.endTime) return;
    const ranges = rangeMap.get(entityId) ?? [];
    ranges.push({
      start: slot.startTime,
      end: slot.endTime,
      examId: assignment.examId,
      assignmentId: assignment.id,
      timeSlotId: assignment.timeSlotId,
    });
    rangeMap.set(entityId, ranges);
  };

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
    const roomOverlap = findRangeOverlap(roomTimeRangeMap, assignment.roomId, assignment.timeSlot, assignment.examId);
    if (roomOverlap) {
      pushUnique(
        roomReuseViolations,
        `room-range:${assignment.roomId}:${assignment.id}:${roomOverlap.assignmentId}`,
        {
          roomId: assignment.roomId,
          timeSlotId: assignment.timeSlotId,
          assignmentIds: [roomOverlap.assignmentId, assignment.id],
          examIds: [roomOverlap.examId, assignment.examId],
        },
      );
    }
    rememberRange(roomTimeRangeMap, assignment.roomId, assignment);

    const proctorSlotKey = `${assignment.proctorId}:${assignment.timeSlotId}`;
    const proctorSlotGroup = proctorSlotExamIds.get(proctorSlotKey) ?? new Set();
    proctorSlotGroup.add(assignment.examId);
    proctorSlotExamIds.set(proctorSlotKey, proctorSlotGroup);
    const proctorOverlap = findRangeOverlap(proctorTimeRangeMap, assignment.proctorId, assignment.timeSlot, assignment.examId);
    if (proctorOverlap) {
      pushUnique(
        proctorCollisions,
        `proctor-range:${assignment.proctorId}:${assignment.id}:${proctorOverlap.assignmentId}`,
        {
          proctorId: assignment.proctorId,
          timeSlotId: assignment.timeSlotId,
          assignmentIds: [proctorOverlap.assignmentId, assignment.id],
          examIds: [proctorOverlap.examId, assignment.examId],
        },
      );
    }
    rememberRange(proctorTimeRangeMap, assignment.proctorId, assignment);

    const proctorDayKey = `${assignment.proctorId}:${toDateKey(assignment.timeSlot.date ?? assignment.timeSlot.startTime)}`;
    const proctorDayGroup = proctorDayExamIds.get(proctorDayKey) ?? new Set();
    proctorDayGroup.add(assignment.examId);
    proctorDayExamIds.set(proctorDayKey, proctorDayGroup);

    const studentIds = getUniqueStudentIdsForExam(assignment.exam);
    const studentReservationKey = `${assignment.examId}:${assignment.timeSlotId}`;
    const shouldCheckStudents = !studentReservationKeys.has(studentReservationKey);
    studentReservationKeys.add(studentReservationKey);
    if (!shouldCheckStudents) continue;

    for (const studentId of studentIds) {
      const key = `${studentId}:${assignment.timeSlotId}`;
      const seen = studentSlotSeen.get(key);
      if (seen && seen.examId !== assignment.examId) {
        pushUnique(
          studentOverlaps,
          `student-slot:${studentId}:${seen.assignmentId}:${assignment.id}`,
          {
            studentId,
            timeSlotId: assignment.timeSlotId,
            assignmentIds: [seen.assignmentId, assignment.id],
          },
        );
      } else if (!seen) {
        studentSlotSeen.set(key, { assignmentId: assignment.id, examId: assignment.examId });
      }

      const studentOverlap = findRangeOverlap(studentTimeRangeMap, studentId, assignment.timeSlot, assignment.examId);
      if (studentOverlap) {
        pushUnique(
          studentOverlaps,
          `student-range:${studentId}:${studentOverlap.assignmentId}:${assignment.id}`,
          {
            studentId,
            timeSlotId: assignment.timeSlotId,
            assignmentIds: [studentOverlap.assignmentId, assignment.id],
          },
        );
      }
      rememberRange(studentTimeRangeMap, studentId, assignment);
    }
  }

  for (const [key, examIds] of roomSlotCount.entries()) {
    if (examIds.size > 1) {
      const [roomId, timeSlotId] = key.split(':');
      pushUnique(
        roomReuseViolations,
        `room-slot:${roomId}:${timeSlotId}`,
        { roomId, timeSlotId, count: examIds.size, examIds: [...examIds] },
      );
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
      pushUnique(
        proctorCollisions,
        `proctor-slot:${proctorId}:${timeSlotId}`,
        { proctorId, timeSlotId, count: examIds.size, examIds: [...examIds] },
      );
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

const getPublishedScheduleConflicts = async (scheduleId, semesterId) => {
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
        exam: { courseOffering: { semesterId } },
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

const normalizeExamPeriod = (value) => String(value ?? '').trim();

const getExamPeriodKey = (value) => normalizeExamPeriod(value).toLowerCase();

const getScheduleSemesterId = async (scheduleId) => {
  const assignments = await prisma.examAssignment.findMany({
    where: { scheduleId },
    select: { exam: { select: { courseOffering: { select: { semesterId: true } } } } },
  });

  const semesterIds = new Set(
    assignments
      .map((assignment) => assignment.exam?.courseOffering?.semesterId)
      .filter(Boolean),
  );

  if (semesterIds.size === 0) {
    throw new AppError('Cannot publish a schedule with no semester-linked assignments.', 400);
  }

  if (semesterIds.size > 1) {
    throw new AppError('Cannot publish a schedule that contains assignments from multiple semesters.', 400);
  }

  return [...semesterIds][0];
};

const validatePublishedSchedulePeriod = async ({ scheduleId, examPeriod, semesterId }) => {
  const publishedSchedules = await prisma.schedule.findMany({
    where: {
      id: { not: scheduleId },
      isFinal: true,
      assignments: { some: { exam: { courseOffering: { semesterId } } } },
    },
    select: { id: true, name: true, examPeriod: true },
  });

  if (publishedSchedules.length >= 2) {
    throw new AppError('Cannot publish more than 2 schedules for the same semester.', 400);
  }

  const periodKey = getExamPeriodKey(examPeriod);
  const samePeriod = publishedSchedules.find(
    (schedule) => getExamPeriodKey(schedule.examPeriod) === periodKey,
  );

  if (samePeriod) {
    throw new AppError(`A published ${examPeriod} schedule already exists for this semester.`, 400);
  }
};

export const publishSchedule = async (scheduleId, payload = {}) => {
  const existing = await prisma.schedule.findUnique({
    where: { id: scheduleId },
  });

  if (!existing) throw new AppError('Schedule not found', 404);

  const examPeriod = normalizeExamPeriod(payload.examPeriod ?? payload.periodName ?? existing.examPeriod);
  if (!examPeriod) {
    throw new AppError('Schedule exam period is required before publishing. Use a period such as Midterm or Final.', 400);
  }

  const semesterId = await getScheduleSemesterId(scheduleId);
  const semester = await prisma.semester.findUnique({
    where: { id: semesterId },
    select: { id: true, isActive: true },
  });

  if (!semester) {
    throw new AppError('Semester not found', 404);
  }

  if (!semester.isActive) {
    throw new AppError('Cannot publish a schedule from an inactive semester.', 400);
  }

  await validatePublishedSchedulePeriod({ scheduleId, examPeriod, semesterId });

  const analysis = await getScheduleAnalysis(scheduleId);
  if (analysis.metrics.totalConflicts > 0) {
    throw new AppError('Cannot publish schedule while hard-constraint issues still exist', 400);
  }

  const publishedConflicts = await getPublishedScheduleConflicts(scheduleId, semesterId);
  if (publishedConflicts.total > 0) {
    throw new AppError('Cannot publish schedule because it conflicts with an existing published schedule.', 400);
  }

  // Publish lifecycle:
  //   - draft -> publish  : SCHEDULE_PUBLISHED (publishedVersion 0 -> 1)
  //   - draft -> publish (after a prior unpublish) : SCHEDULE_REPUBLISHED (n -> n+1)
  //   - already published : no-op, no notification
  if (existing.isFinal) {
    return { message: 'Schedule is already published', schedule: existing };
  }

  const previousVersion = existing.publishedVersion ?? 0;
  const newVersion = previousVersion + 1;
  const eventType = previousVersion === 0
    ? NOTIFICATION_TYPES.SCHEDULE_PUBLISHED
    : NOTIFICATION_TYPES.SCHEDULE_REPUBLISHED;

  // Run the schedule update and notification fan-out in a single transaction so
  // a partial failure cannot leave the schedule published without notifications
  // (or vice-versa). The DB-level unique constraint plus skipDuplicates makes
  // any retried publish for the same (scheduleId, version) safely idempotent.
  const { schedule, notificationResult } = await prisma.$transaction(
    async (tx) => {
      const updated = await tx.schedule.update({
        where: { id: scheduleId },
        data: {
          isFinal: true,
          examPeriod,
          publishedVersion: newVersion,
          lastPublishedAt: new Date(),
        },
      });

      const result = await createSchedulePublicationNotifications({
        scheduleId,
        eventType,
        scheduleVersion: newVersion,
        client: tx,
      });

      return { schedule: updated, notificationResult: result };
    },
    { timeout: 30000, maxWait: 10000 },
  );

  return {
    message: eventType === NOTIFICATION_TYPES.SCHEDULE_REPUBLISHED
      ? 'Schedule republished successfully'
      : 'Schedule published successfully',
    schedule,
    eventType,
    scheduleVersion: newVersion,
    notificationResult,
  };
};
