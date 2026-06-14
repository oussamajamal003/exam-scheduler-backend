// Reusable hard-constraint assertions for the Hybrid Constraint-Based scheduler.
// Each helper validates one invariant against a generated schedule loaded
// through `getScheduleAnalysis` or `schedule.assignments`.
import prisma from '../../src/config/prisma.js';

export const loadFullSchedule = async (scheduleId) => {
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
                  registrations: { select: { studentId: true } },
                },
              },
            },
          },
          room: true,
          timeSlot: true,
          proctor: { include: { user: true } },
        },
      },
    },
  });
  if (!schedule) throw new Error(`Schedule ${scheduleId} not found`);
  return schedule;
};

export const expectNoRoomDoubleBooking = (schedule) => {
  // Room sharing is allowed when total occupied seats for (room, slot) stays
  // within room capacity (room partitioning).
  const roomById = new Map(schedule.assignments.map((a) => [a.roomId, a.room]));

  // Deterministic seat allocation per (exam, slot): fill largest assigned rooms first.
  const roomsByExamSlot = new Map();
  for (const a of schedule.assignments) {
    const examSlotKey = `${a.examId}:${a.timeSlotId}`;
    if (!roomsByExamSlot.has(examSlotKey)) roomsByExamSlot.set(examSlotKey, new Map());
    roomsByExamSlot.get(examSlotKey).set(a.roomId, a.room);
  }

  const roomSlotUsedSeats = new Map(); // roomId:slotId -> usedSeats
  for (const [examSlotKey, roomsMap] of roomsByExamSlot.entries()) {
    const [examId, timeSlotId] = examSlotKey.split(':');
    const any = schedule.assignments.find((a) => a.examId === examId && a.timeSlotId === timeSlotId);
    const requiredSeats = (any?.exam?.courseOffering?.registrations ?? []).length;
    let remaining = requiredSeats;
    const rooms = [...roomsMap.values()]
      .filter(Boolean)
      .sort((a, b) => (b.capacity - a.capacity) || a.name.localeCompare(b.name));

    for (const room of rooms) {
      if (remaining <= 0) break;
      const allocated = Math.min(remaining, room.capacity ?? 0);
      remaining -= allocated;
      const roomSlotKey = `${room.id}:${timeSlotId}`;
      roomSlotUsedSeats.set(roomSlotKey, (roomSlotUsedSeats.get(roomSlotKey) ?? 0) + allocated);
    }
  }

  for (const [roomSlotKey, usedSeats] of roomSlotUsedSeats.entries()) {
    const [roomId, timeSlotId] = roomSlotKey.split(':');
    const room = roomById.get(roomId);
    const cap = room?.capacity ?? 0;
    if (usedSeats > cap) {
      throw new Error(
        `Room over-occupied: room ${roomId} at slot ${timeSlotId} usedSeats ${usedSeats} > capacity ${cap}`,
      );
    }
  }
};

export const expectNoProctorDoubleBooking = (schedule) => {
  // A proctor cannot supervise two different rooms in the same time slot.
  // Sharing the same proctor group across multiple exams is allowed when those
  // exams share the same (room, slot).
  const proctorSlotRoom = new Map(); // proctorId:slotId -> roomId
  for (const a of schedule.assignments) {
    const key = `${a.proctorId}:${a.timeSlotId}`;
    const existingRoomId = proctorSlotRoom.get(key);
    if (existingRoomId && existingRoomId !== a.roomId) {
      throw new Error(
        `Proctor double-booked: proctor ${a.proctorId} at slot ${a.timeSlotId} used in rooms ${existingRoomId} and ${a.roomId}`,
      );
    }
    proctorSlotRoom.set(key, a.roomId);
  }

  // Shared-room proctor group consistency: all exams in the same (room, slot)
  // must reference the exact same proctor set.
  const roomSlotProctors = new Map(); // roomId:slotId -> Set(proctorId)
  const roomSlotExams = new Map(); // roomId:slotId -> Set(examId)
  const examRoomSlotProctors = new Map(); // examId:roomId:slotId -> Set(proctorId)

  for (const a of schedule.assignments) {
    const roomSlotKey = `${a.roomId}:${a.timeSlotId}`;
    if (!roomSlotProctors.has(roomSlotKey)) roomSlotProctors.set(roomSlotKey, new Set());
    roomSlotProctors.get(roomSlotKey).add(a.proctorId);
    if (!roomSlotExams.has(roomSlotKey)) roomSlotExams.set(roomSlotKey, new Set());
    roomSlotExams.get(roomSlotKey).add(a.examId);

    const examRoomSlotKey = `${a.examId}:${a.roomId}:${a.timeSlotId}`;
    if (!examRoomSlotProctors.has(examRoomSlotKey)) examRoomSlotProctors.set(examRoomSlotKey, new Set());
    examRoomSlotProctors.get(examRoomSlotKey).add(a.proctorId);
  }

  for (const [roomSlotKey, proctors] of roomSlotProctors.entries()) {
    const [roomId, timeSlotId] = roomSlotKey.split(':');
    for (const examId of roomSlotExams.get(roomSlotKey) ?? []) {
      const examRoomSlotKey = `${examId}:${roomId}:${timeSlotId}`;
      const perExam = examRoomSlotProctors.get(examRoomSlotKey) ?? new Set();
      if (perExam.size !== proctors.size) {
        throw new Error(`Shared-room proctor group mismatch in ${roomSlotKey} for exam ${examId}`);
      }
      for (const pid of proctors) {
        if (!perExam.has(pid)) {
          throw new Error(`Shared-room proctor group mismatch in ${roomSlotKey} for exam ${examId}`);
        }
      }
    }
  }
};

export const expectNoStudentOverlap = (schedule) => {
  const byStudentSlot = new Map();
  for (const a of schedule.assignments) {
    const studentIds = (a.exam?.courseOffering?.registrations ?? []).map((r) => r.studentId);
    for (const sid of studentIds) {
      const key = `${sid}:${a.timeSlotId}`;
      const existing = byStudentSlot.get(key);
      if (existing && existing !== a.examId) {
        throw new Error(
          `Student ${sid} double-booked at slot ${a.timeSlotId} for exams ${existing} and ${a.examId}`,
        );
      }
      byStudentSlot.set(key, a.examId);
    }
  }
};

export const expectCapacityRespected = (schedule) => {
  // sum room capacities per (exam, slot) and compare to registration count
  const groups = new Map();
  for (const a of schedule.assignments) {
    const key = `${a.examId}:${a.timeSlotId}`;
    const g = groups.get(key) ?? {
      capacity: 0,
      required: (a.exam?.courseOffering?.registrations ?? []).length,
      seenRooms: new Set(),
    };
    if (!g.seenRooms.has(a.roomId)) {
      g.seenRooms.add(a.roomId);
      g.capacity += a.room?.capacity ?? 0;
    }
    groups.set(key, g);
  }
  for (const [key, g] of groups) {
    if (g.capacity < g.required) {
      throw new Error(`Capacity violation at ${key}: capacity ${g.capacity} < required ${g.required}`);
    }
  }
};

export const expectStudentDailyCap = (schedule, maxPerDay = 2) => {
  const counts = new Map();
  for (const a of schedule.assignments) {
    const day = (a.timeSlot.date ?? a.timeSlot.startTime).toISOString().slice(0, 10);
    const studentIds = (a.exam?.courseOffering?.registrations ?? []).map((r) => r.studentId);
    for (const sid of studentIds) {
      const key = `${sid}:${day}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  for (const [key, n] of counts) {
    if (n > maxPerDay) {
      throw new Error(`Student daily cap exceeded for ${key}: ${n} > ${maxPerDay}`);
    }
  }
};

export const expectDurationsFit = (schedule) => {
  for (const a of schedule.assignments) {
    const slotDuration = Math.round(
      (a.timeSlot.endTime.getTime() - a.timeSlot.startTime.getTime()) / 60000,
    );
    const examDuration = a.exam.duration ?? 120;
    if (examDuration > slotDuration) {
      throw new Error(
        `Exam ${a.examId} duration ${examDuration} > slot ${a.timeSlotId} duration ${slotDuration}`,
      );
    }
  }
};
