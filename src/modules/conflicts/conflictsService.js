import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

const getRequiredSeats = (assignment) => {
  const expected = assignment.exam?.courseOffering?.expectedStudents ?? 0;
  const registered = assignment.exam?.courseOffering?.registrations?.length ?? 0;
  return Math.max(expected, registered, 1);
};

export const detect = async (data) => {
  const { scheduleId } = data;
  if (!scheduleId) throw new AppError('scheduleId is required', 400);

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
          supervisor: { include: { user: { select: { id: true, name: true, email: true } } } },
          timeSlot: true,
        },
      },
    },
  });

  if (!schedule) throw new AppError('Schedule not found', 404);

  const conflicts = [];

  // 1) Student conflicts: same student in multiple exams in the same timeslot.
  const studentSlotMap = new Map();
  for (const assignment of schedule.assignments) {
    const regs = assignment.exam?.courseOffering?.registrations ?? [];
    for (const reg of regs) {
      const key = `${reg.studentId}:${assignment.timeSlotId}`;
      if (!studentSlotMap.has(key)) {
        studentSlotMap.set(key, []);
      }
      studentSlotMap.get(key).push(assignment);
    }
  }

  for (const [key, assignments] of studentSlotMap.entries()) {
    if (assignments.length < 2) continue;
    const [studentId, timeSlotId] = key.split(':');
    conflicts.push({
      conflictType: 'STUDENT_CONFLICT',
      entity: `student:${studentId}`,
      description: `Student ${studentId} has ${assignments.length} exams scheduled in timeslot ${timeSlotId}.`,
      suggestedFix: 'Move one of the exams to a different timeslot where this student has no other exam.',
    });
  }

  // 2) Room conflicts:
  //    A) same room used for multiple exams in the same timeslot
  const roomSlotMap = new Map();
  for (const assignment of schedule.assignments) {
    const key = `${assignment.roomId}:${assignment.timeSlotId}`;
    if (!roomSlotMap.has(key)) {
      roomSlotMap.set(key, []);
    }
    roomSlotMap.get(key).push(assignment);
  }

  for (const [key, assignments] of roomSlotMap.entries()) {
    if (assignments.length < 2) continue;
    const [roomId, timeSlotId] = key.split(':');
    conflicts.push({
      conflictType: 'ROOM_CONFLICT',
      entity: `room:${roomId}`,
      description: `Room ${roomId} is assigned to ${assignments.length} exams in timeslot ${timeSlotId}.`,
      suggestedFix: 'Reassign one of these exams to another available room or timeslot.',
    });
  }

  //    B) room capacity below required seats for assignment
  for (const assignment of schedule.assignments) {
    const neededSeats = getRequiredSeats(assignment);
    if (assignment.room.capacity < neededSeats) {
      conflicts.push({
        conflictType: 'ROOM_CONFLICT',
        entity: `room:${assignment.roomId}`,
        description: `Room ${assignment.roomId} capacity (${assignment.room.capacity}) is less than required seats (${neededSeats}) for exam ${assignment.examId}.`,
        suggestedFix: 'Move exam to a larger room or split students across additional sessions/rooms.',
      });
    }
  }

  // 3) Supervisor conflicts: same supervisor in multiple exams in the same timeslot.
  const supervisorSlotMap = new Map();
  for (const assignment of schedule.assignments) {
    const key = `${assignment.supervisorId}:${assignment.timeSlotId}`;
    if (!supervisorSlotMap.has(key)) {
      supervisorSlotMap.set(key, []);
    }
    supervisorSlotMap.get(key).push(assignment);
  }

  for (const [key, assignments] of supervisorSlotMap.entries()) {
    if (assignments.length < 2) continue;
    const [supervisorId, timeSlotId] = key.split(':');
    conflicts.push({
      conflictType: 'SUPERVISOR_CONFLICT',
      entity: `supervisor:${supervisorId}`,
      description: `Supervisor ${supervisorId} is assigned to ${assignments.length} exams in timeslot ${timeSlotId}.`,
      suggestedFix: 'Reassign one exam to another available supervisor or move the exam timeslot.',
    });
  }

  return {
    scheduleId,
    detectedCount: conflicts.length,
    conflicts,
  };
};