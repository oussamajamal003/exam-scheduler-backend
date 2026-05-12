import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

export const proctorAvailabilityInclude = {
  availableTimeSlots: {
    select: {
      timeSlotId: true,
      timeSlot: {
        select: {
          id: true,
          date: true,
          startTime: true,
          endTime: true,
          duration: true,
        },
      },
    },
  },
};

export const normalizeTimeSlotIds = (timeSlotIds = []) => {
  return [...new Set((timeSlotIds ?? []).filter(Boolean))];
};

export const assertTimeSlotsExist = async (timeSlotIds = []) => {
  const ids = normalizeTimeSlotIds(timeSlotIds);
  if (ids.length === 0) return ids;

  const rows = await prisma.timeSlot.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });

  if (rows.length !== ids.length) {
    const found = new Set(rows.map((row) => row.id));
    const missing = ids.filter((id) => !found.has(id));
    throw new AppError(`Time slot not found: ${missing[0]}`, 404);
  }

  return ids;
};

export const buildAvailabilityWrite = (timeSlotIds = [], { replaceExisting = false } = {}) => {
  const ids = normalizeTimeSlotIds(timeSlotIds);
  return {
    ...(replaceExisting ? { deleteMany: {} } : {}),
    create: ids.map((timeSlotId) => ({
      timeSlot: { connect: { id: timeSlotId } },
    })),
  };
};

export const extractAvailableTimeSlotIds = (proctor) => {
  const ids = (proctor?.availableTimeSlots ?? []).map((entry) => entry.timeSlotId ?? entry.timeSlot?.id);
  return new Set(ids.filter(Boolean));
};

export const assertProctorAvailableForTimeSlot = async ({ proctorId, timeSlotId }) => {
  const availability = await prisma.proctorAvailability.findUnique({
    where: {
      proctorId_timeSlotId: { proctorId, timeSlotId },
    },
    select: { proctorId: true },
  });

  if (!availability) {
    throw new AppError('Selected proctor is not available for this time slot.', 400);
  }
};