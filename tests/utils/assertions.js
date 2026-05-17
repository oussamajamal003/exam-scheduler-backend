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
          proctor: true,
        },
      },
    },
  });
  if (!schedule) throw new Error(`Schedule ${scheduleId} not found`);
  return schedule;
};

export const expectNoRoomDoubleBooking = (schedule) => {
  const seen = new Map();
  for (const a of schedule.assignments) {
    const key = `${a.roomId}:${a.timeSlotId}`;
    const existing = seen.get(key);
    if (existing && existing.examId !== a.examId) {
      throw new Error(
        `Room double-booked: room ${a.roomId} at slot ${a.timeSlotId} used by exams ${existing.examId} and ${a.examId}`,
      );
    }
    seen.set(key, a);
  }
};

export const expectNoProctorDoubleBooking = (schedule) => {
  const seen = new Map();
  for (const a of schedule.assignments) {
    const key = `${a.proctorId}:${a.timeSlotId}`;
    const existing = seen.get(key);
    if (existing && existing.examId !== a.examId) {
      throw new Error(
        `Proctor double-booked: proctor ${a.proctorId} at slot ${a.timeSlotId} used by exams ${existing.examId} and ${a.examId}`,
      );
    }
    seen.set(key, a);
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
