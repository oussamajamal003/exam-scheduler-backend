import { jest } from '@jest/globals';
import prisma, { truncateAll, disconnectPrisma } from '../utils/db.js';
import * as timeSlotsService from '../../src/modules/timeslots/timeslotsService.js';

const makeSlot = (date, start, end) => ({
  date: `${date}T00:00:00.000Z`,
  startTime: `${date}T${start}:00.000Z`,
  endTime: `${date}T${end}:00.000Z`,
});

beforeAll(async () => {
  jest.setTimeout(180000);
});

afterAll(async () => {
  await disconnectPrisma();
});

describe('timeslotsService validation', () => {
  beforeEach(async () => {
    await truncateAll();
    await prisma.semester.create({
      data: {
        name: 'Spring 2026',
        startDate: new Date('2026-05-01T00:00:00.000Z'),
        endDate: new Date('2026-05-31T23:59:59.999Z'),
      },
    });
  });

  it('allows overlapping candidate time slots', async () => {
    await timeSlotsService.create(makeSlot('2026-05-16', '08:00', '10:00'));

    const overlapping = await timeSlotsService.create(makeSlot('2026-05-16', '08:30', '10:30'));

    expect(overlapping).toMatchObject({
      duration: 120,
    });
  });

  it('blocks exact duplicate time slots', async () => {
    await timeSlotsService.create(makeSlot('2026-05-16', '08:00', '10:00'));

    await expect(timeSlotsService.create(makeSlot('2026-05-16', '08:00', '10:00'))).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('blocks time slots outside configured semester ranges', async () => {
    await expect(timeSlotsService.create(makeSlot('2026-06-01', '08:00', '10:00'))).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('blocks invalid time ranges', async () => {
    await expect(timeSlotsService.create(makeSlot('2026-05-16', '10:00', '08:00'))).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});
