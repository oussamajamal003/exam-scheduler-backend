import prisma from '../../src/config/prisma.js';
import { generateDemoData } from '../../src/modules/demoData/demoDataService.js';

export const seedOptimizationShowcaseScenario = async (options = {}) => {
  const dataset = options.dataset ?? 'FEIT2027';
  const result = await generateDemoData({ dataset });
  const semester = await prisma.semester.findFirstOrThrow({
    where: { createdBy: `demo-data:${dataset}` },
    orderBy: { createdAt: 'asc' },
  });

  const [rooms, timeSlots, proctors, students, offerings] = await Promise.all([
    prisma.room.findMany({
      where: { createdBy: `demo-data:${dataset}` },
      orderBy: [{ name: 'asc' }],
    }),
    prisma.timeSlot.findMany({
      where: { createdBy: `demo-data:${dataset}` },
      orderBy: [{ startTime: 'asc' }],
    }),
    prisma.proctor.findMany({
      where: { createdBy: `demo-data:${dataset}` },
      orderBy: [{ id: 'asc' }],
    }),
    prisma.student.findMany({
      where: { createdBy: `demo-data:${dataset}` },
      orderBy: [{ id: 'asc' }],
    }),
    prisma.courseOffering.findMany({
      where: { semesterId: semester.id },
      orderBy: [{ id: 'asc' }],
    }),
  ]);

  return {
    namespace: dataset,
    semester,
    rooms,
    timeSlots,
    proctors,
    students,
    offerings,
    counts: {
      offerings: offerings.length,
      rooms: rooms.length,
      proctors: proctors.length,
      timeSlots: timeSlots.length,
      students: students.length,
      registrations: result.summary.registrations,
    },
  };
};
