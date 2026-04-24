import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

const getUniqueStudentIdsForExam = (exam) => {
  const ids = new Set();
  for (const reg of exam.courseOffering?.registrations ?? []) {
    if (reg.studentId) ids.add(reg.studentId);
  }
  return [...ids];
};

const getRequiredSeatsForExam = (exam) => {
  const registered = exam.courseOffering?.registrations?.length ?? 0;
  const expected = exam.courseOffering?.expectedStudents ?? 0;
  return Math.max(registered, expected, 1);
};

const getRoomCandidatesForExam = (exam, rooms) => {
  const neededSeats = getRequiredSeatsForExam(exam);
  return rooms
    .filter((room) => room.capacity >= neededSeats)
    .sort((a, b) => a.capacity - b.capacity);
};

const getTimeslotsInSemesterRange = (semester, timeSlots) => {
  return timeSlots
    .filter((slot) => slot.startTime >= semester.startDate && slot.endTime <= semester.endDate)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
};

export const prepareScheduling = async (data) => {
  const semester = await prisma.semester.findUnique({ where: { id: data.semesterId } });
  if (!semester) throw new AppError('Semester not found', 404);

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

  const [offerings, exams, roomsCount, supervisorsCount, timeSlots] = await Promise.all([
    prisma.courseOffering.findMany({
      where: { semesterId: data.semesterId },
      include: { registrations: true },
    }),
    prisma.exam.findMany({
      where: { courseOffering: { semesterId: data.semesterId } },
      include: {
        courseOffering: { include: { registrations: true } },
      },
    }),
    prisma.room.count(),
    prisma.supervisor.count(),
    prisma.timeSlot.findMany(),
  ]);

  const filteredTimeSlots = timeSlots.filter(
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
      courseOfferings: offerings.length,
      exams: exams.length,
      rooms: roomsCount,
      supervisors: supervisorsCount,
      timeSlotsInWindow: filteredTimeSlots.length,
    },
    message: `Scheduling preparation complete for ${semester.name}`,
  };
};

export const validateInput = async (data) => {
  const semester = await prisma.semester.findUnique({ where: { id: data.semesterId } });
  if (!semester) throw new AppError('Semester not found', 404);

  const [rooms, supervisors, allTimeSlots, exams] = await Promise.all([
    prisma.room.findMany(),
    prisma.supervisor.findMany(),
    prisma.timeSlot.findMany(),
    prisma.exam.findMany({
      where: { courseOffering: { semesterId: data.semesterId } },
      include: {
        courseOffering: {
          include: {
            registrations: { select: { studentId: true } },
          },
        },
      },
    }),
  ]);

  const timeSlots = getTimeslotsInSemesterRange(semester, allTimeSlots);
  const issues = [];

  if (rooms.length === 0) issues.push('No rooms available.');
  if (supervisors.length === 0) issues.push('No supervisors available.');
  if (timeSlots.length === 0) issues.push('No time slots found inside the semester range.');
  if (exams.length === 0) issues.push('No exams found for this semester.');

  for (const exam of exams) {
    const requiredSeats = getRequiredSeatsForExam(exam);
    const hasFittingRoom = rooms.some((room) => room.capacity >= requiredSeats);
    if (!hasFittingRoom) {
      issues.push(`No room can host exam ${exam.id} (required seats: ${requiredSeats}).`);
    }
  }

  const studentExamCounts = new Map();
  for (const exam of exams) {
    const studentIds = getUniqueStudentIdsForExam(exam);
    for (const studentId of studentIds) {
      studentExamCounts.set(studentId, (studentExamCounts.get(studentId) ?? 0) + 1);
    }
  }

  for (const [studentId, examCount] of studentExamCounts.entries()) {
    if (examCount > timeSlots.length && timeSlots.length > 0) {
      issues.push(
        `Student ${studentId} has ${examCount} exams but only ${timeSlots.length} available slots (overlap risk is unavoidable).`,
      );
    }
  }

  for (const slot of timeSlots) {
    if (slot.endTime <= slot.startTime) {
      issues.push(`Invalid timeslot ${slot.id}: endTime must be after startTime.`);
    }
  }

  const ready = issues.length === 0;

  return {
    ready,
    metrics: {
      roomsCount: rooms.length,
      supervisorsCount: supervisors.length,
      examsCount: exams.length,
      timeSlotsCount: timeSlots.length,
    },
    issues,
  };
};

export const generateSchedule = async (data) => {
  const { semesterId, scheduleName } = data;

  const semester = await prisma.semester.findUnique({ where: { id: semesterId } });
  if (!semester) throw new AppError('Semester not found', 404);

  const [rooms, supervisors, allTimeSlots, exams] = await Promise.all([
    prisma.room.findMany(),
    prisma.supervisor.findMany(),
    prisma.timeSlot.findMany(),
    prisma.exam.findMany({
      where: { courseOffering: { semesterId } },
      include: {
        courseOffering: {
          include: {
            registrations: { select: { studentId: true } },
          },
        },
      },
    }),
  ]);

  const timeSlots = getTimeslotsInSemesterRange(semester, allTimeSlots);

  if (rooms.length === 0 || supervisors.length === 0 || timeSlots.length === 0 || exams.length === 0) {
    throw new AppError('Insufficient scheduling resources. Run validate-input first.', 400);
  }

  const sortedExams = [...exams].sort((a, b) => {
    const aStudents = getUniqueStudentIdsForExam(a).length;
    const bStudents = getUniqueStudentIdsForExam(b).length;
    return bStudents - aStudents;
  });

  const roomSlotUsed = new Set();
  const supervisorSlotUsed = new Set();
  const studentSlotMap = new Map();

  const assignmentInserts = [];
  const examStatusUpdates = [];
  const conflictInserts = [];

  const schedule = await prisma.schedule.create({
    data: { name: scheduleName, isFinal: false },
  });

  for (const exam of sortedExams) {
    const studentIds = getUniqueStudentIdsForExam(exam);
    const roomCandidates = getRoomCandidatesForExam(exam, rooms);

    if (roomCandidates.length === 0) {
      conflictInserts.push({
        scheduleId: schedule.id,
        type: 'ROOM_OVERCAPACITY',
        description: `No room can host exam ${exam.id} (required seats: ${getRequiredSeatsForExam(exam)}).`,
      });
      continue;
    }

    let assigned = null;

    for (const slot of timeSlots) {
      const studentOverlap = studentIds.some((sid) => studentSlotMap.get(sid)?.has(slot.id));
      if (studentOverlap) continue;

      const freeSupervisor = supervisors.find(
        (s) => !supervisorSlotUsed.has(`${s.id}:${slot.id}`),
      );
      if (!freeSupervisor) continue;

      const freeRoom = roomCandidates.find((r) => !roomSlotUsed.has(`${r.id}:${slot.id}`));
      if (!freeRoom) continue;

      assigned = {
        examId: exam.id,
        roomId: freeRoom.id,
        supervisorId: freeSupervisor.id,
        timeSlotId: slot.id,
      };
      break;
    }

    if (!assigned) {
      conflictInserts.push({
        scheduleId: schedule.id,
        type: 'RESOURCE_UNAVAILABLE',
        description: `Unable to assign exam ${exam.id} without violating student overlap / room / supervisor constraints.`,
      });
      continue;
    }

    assignmentInserts.push({ scheduleId: schedule.id, ...assigned });
    examStatusUpdates.push(
      prisma.exam.update({
        where: { id: exam.id },
        data: { status: 'SCHEDULED' },
      }),
    );

    roomSlotUsed.add(`${assigned.roomId}:${assigned.timeSlotId}`);
    supervisorSlotUsed.add(`${assigned.supervisorId}:${assigned.timeSlotId}`);
    for (const sid of studentIds) {
      if (!studentSlotMap.has(sid)) studentSlotMap.set(sid, new Set());
      studentSlotMap.get(sid).add(assigned.timeSlotId);
    }
  }

  if (assignmentInserts.length > 0) {
    await prisma.examAssignment.createMany({ data: assignmentInserts });
  }

  if (conflictInserts.length > 0) {
    await prisma.conflict.createMany({ data: conflictInserts });
  }

  if (examStatusUpdates.length > 0) {
    await prisma.$transaction(examStatusUpdates);
  }

  return {
    scheduleId: schedule.id,
    scheduleName,
    assignedExams: assignmentInserts.length,
    unassignedExams: conflictInserts.length,
    totalExams: exams.length,
    message: `Schedule generated with ${assignmentInserts.length}/${exams.length} exams assigned.`,
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
  const supervisorCollisions = [];
  const studentOverlaps = [];

  const supervisorSlotCount = new Map();

  for (const assignment of schedule.assignments) {
    const requiredSeats = getRequiredSeatsForExam(assignment.exam);
    if (assignment.room.capacity < requiredSeats) {
      roomCapacityViolations.push({
        assignmentId: assignment.id,
        examId: assignment.examId,
        roomId: assignment.roomId,
        capacity: assignment.room.capacity,
        requiredSeats,
      });
    }

    const supKey = `${assignment.supervisorId}:${assignment.timeSlotId}`;
    supervisorSlotCount.set(supKey, (supervisorSlotCount.get(supKey) ?? 0) + 1);

    const studentIds = getUniqueStudentIdsForExam(assignment.exam);
    for (const sid of studentIds) {
      const key = `${sid}:${assignment.timeSlotId}`;
      const seen = studentSlotSeen.get(key);
      if (seen) {
        studentOverlaps.push({
          studentId: sid,
          timeSlotId: assignment.timeSlotId,
          assignmentIds: [seen, assignment.id],
        });
      } else {
        studentSlotSeen.set(key, assignment.id);
      }
    }
  }

  for (const [key, count] of supervisorSlotCount.entries()) {
    if (count > 1) {
      const [supervisorId, timeSlotId] = key.split(':');
      supervisorCollisions.push({ supervisorId, timeSlotId, count });
    }
  }

  const derivedConflicts = {
    studentOverlaps,
    supervisorConflicts: supervisorCollisions,
    roomCapacityViolations,
  };

  const totalConflicts =
    schedule.conflicts.length +
    studentOverlaps.length +
    supervisorCollisions.length +
    roomCapacityViolations.length;

  const utilization =
    schedule.assignments.length === 0
      ? 0
      : schedule.assignments.reduce((acc, item) => {
          const seats = getRequiredSeatsForExam(item.exam);
          return acc + seats / item.room.capacity;
        }, 0) / schedule.assignments.length;

  return {
    scheduleId: schedule.id,
    isFinal: schedule.isFinal,
    metrics: {
      totalAssignments: schedule.assignments.length,
      persistedConflicts: schedule.conflicts.length,
      derivedConflicts: totalConflicts - schedule.conflicts.length,
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

  if (existing.conflicts.some((c) => !c.resolved)) {
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