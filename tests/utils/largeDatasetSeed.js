import { createHash } from 'crypto';
import prisma from '../../src/config/prisma.js';

const uuidFrom = (namespace, label) => {
  const hex = createHash('sha256')
    .update(`${namespace}:${label}`)
    .digest('hex')
    .slice(0, 32)
    .split('');

  hex[12] = '4';
  // eslint-disable-next-line no-bitwise
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

const makeUtcDate = (isoDate, time) => new Date(`${isoDate}T${time}.000Z`);

export const seedLargeSchedulingScenario = async ({
  namespace = 'LARGE-DS',
  studentCount = 1000,
  courseOfferingCount = 100,
  examCount = 100,
  roomCount = 50,
  proctorCount = 80,
  timeSlotCount = 30,
  coursesPerStudent = 5,
  maintenanceRoomCount = 5,
  proctorsWithNoAvailability = 5,
} = {}) => {
  if (courseOfferingCount !== examCount) {
    throw new Error('Large dataset seed expects 1:1 courseOfferings <-> exams.');
  }

  const createdBy = `test:${namespace}`;
  const departmentId = uuidFrom(namespace, 'department');
  const programId = uuidFrom(namespace, 'program');
  const semesterId = uuidFrom(namespace, 'semester');
  const centerId = uuidFrom(namespace, 'center');

  const baseDate = '2026-06-01';
  const dayCount = Math.ceil(timeSlotCount / 3);
  const semesterStartDate = makeUtcDate(baseDate, '00:00:00');
  const semesterEnd = new Date(semesterStartDate);
  semesterEnd.setUTCDate(semesterEnd.getUTCDate() + (dayCount - 1));
  const semesterEndDate = makeUtcDate(semesterEnd.toISOString().slice(0, 10), '23:59:59');

  const sessionTimes = [
    ['09:00:00', '11:00:00'],
    ['12:00:00', '14:00:00'],
    ['15:00:00', '17:00:00'],
  ];

  const timeSlots = [];
  for (let index = 0; index < timeSlotCount; index += 1) {
    const dayOffset = Math.floor(index / 3);
    const sessionIndex = index % 3;
    const date = new Date(semesterStartDate);
    date.setUTCDate(date.getUTCDate() + dayOffset);
    const dateStr = date.toISOString().slice(0, 10);
    const [start, end] = sessionTimes[sessionIndex];
    const startTime = makeUtcDate(dateStr, start);
    const endTime = makeUtcDate(dateStr, end);
    timeSlots.push({
      id: uuidFrom(namespace, `timeSlot:${index}`),
      startTime,
      endTime,
      date: makeUtcDate(dateStr, '00:00:00'),
      duration: Math.round((endTime.getTime() - startTime.getTime()) / 60000),
      createdBy,
      updatedBy: createdBy,
    });
  }

  const rooms = [];
  const maintenanceRoomIds = [];
  for (let index = 0; index < roomCount; index += 1) {
    const capacity = 40 + ((index % 10) * 10); // 40..130
    const status = index < maintenanceRoomCount ? 'MAINTENANCE' : 'AVAILABLE';
    const roomId = uuidFrom(namespace, `room:${index}`);
    if (status === 'MAINTENANCE') maintenanceRoomIds.push(roomId);
    rooms.push({
      id: roomId,
      centerId,
      name: `${namespace} Room ${String(index + 1).padStart(2, '0')}`,
      capacity,
      status,
      createdBy,
      updatedBy: createdBy,
    });
  }

  const proctors = [];
  const proctorUsers = [];
  const proctorsWithoutAvailability = [];
  for (let index = 0; index < proctorCount; index += 1) {
    const userId = uuidFrom(namespace, `proctorUser:${index}`);
    const proctorId = uuidFrom(namespace, `proctor:${index}`);
    const hasAvailability = index >= proctorsWithNoAvailability;
    if (!hasAvailability) proctorsWithoutAvailability.push(proctorId);

    proctorUsers.push({
      id: userId,
      name: `${namespace} Proctor ${index + 1}`,
      email: `test.${namespace.toLowerCase()}.proctor${String(index + 1).padStart(3, '0')}@uni.test`,
      password: 'Test12345!',
      role: 'PROCTOR',
    });
    proctors.push({
      id: proctorId,
      userId,
      department: 'Exam Operations',
      maxExamsPerDay: 2,
      createdBy,
      updatedBy: createdBy,
    });
  }

  const proctorAvailabilities = [];
  for (let p = 0; p < proctors.length; p += 1) {
    const proctor = proctors[p];
    const hasAvailability = !proctorsWithoutAvailability.includes(proctor.id);
    if (!hasAvailability) continue;
    for (const slot of timeSlots) {
      proctorAvailabilities.push({
        proctorId: proctor.id,
        timeSlotId: slot.id,
      });
    }
  }

  const studentUsers = [];
  const students = [];
  for (let index = 0; index < studentCount; index += 1) {
    const userId = uuidFrom(namespace, `studentUser:${index}`);
    const studentId = uuidFrom(namespace, `student:${index}`);
    studentUsers.push({
      id: userId,
      name: `${namespace} Student ${index + 1}`,
      email: `test.${namespace.toLowerCase()}.student${String(index + 1).padStart(4, '0')}@uni.test`,
      password: 'Test12345!',
      role: 'STUDENT',
    });
    students.push({
      id: studentId,
      userId,
      universityId: `${namespace}-STU-${String(index + 1).padStart(4, '0')}`,
      programId,
      createdBy,
      updatedBy: createdBy,
    });
  }

  const courses = [];
  const offerings = [];
  const exams = [];
  for (let index = 0; index < courseOfferingCount; index += 1) {
    const courseId = uuidFrom(namespace, `course:${index}`);
    const offeringId = uuidFrom(namespace, `offering:${index}`);
    const examId = uuidFrom(namespace, `exam:${index}`);
    const code = `${namespace}-C${String(index + 1).padStart(3, '0')}`;
    courses.push({
      id: courseId,
      code,
      title: `${namespace} Course ${String(index + 1).padStart(3, '0')}`,
      programId,
      semesterId,
      credits: 3,
      isActive: true,
      createdBy,
      updatedBy: createdBy,
    });
    offerings.push({
      id: offeringId,
      courseId,
      semesterId,
      section: 'A',
      expectedStudents: 0,
      capacity: 200,
      instructor: `${namespace} Instructor`,
      status: 'ACTIVE',
      courseType: 'COURSE',
      hasExam: true,
      priority: 50 + (index % 50),
      difficulty: 3 + (index % 3),
      createdBy,
    });
    exams.push({
      id: examId,
      courseOfferingId: offeringId,
      status: 'DRAFT',
      duration: 120,
      createdBy,
    });
  }

  const registrations = [];
  for (let s = 0; s < students.length; s += 1) {
    const studentId = students[s].id;
    for (let k = 0; k < coursesPerStudent; k += 1) {
      const offeringIndex = (s + (k * 7) + (k * k)) % offerings.length;
      registrations.push({
        id: uuidFrom(namespace, `registration:${s}:${k}`),
        studentId,
        courseOfferingId: offerings[offeringIndex].id,
        status: 'ACTIVE',
      });
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.department.create({
      data: { id: departmentId, name: `${namespace} Department`, code: `${namespace}-DEPT` },
    });
    await tx.program.create({
      data: {
        id: programId,
        name: `${namespace} Program`,
        code: `${namespace}-PROG`,
        departmentId,
        isActive: true,
        createdBy,
        updatedBy: createdBy,
      },
    });
    await tx.semester.create({
      data: {
        id: semesterId,
        name: `${namespace} Semester`,
        startDate: semesterStartDate,
        endDate: semesterEndDate,
        academicYear: '2025-2026',
        isActive: true,
        createdBy,
        updatedBy: createdBy,
      },
    });
    await tx.center.create({
      data: {
        id: centerId,
        name: `${namespace} Center`,
        code: `${namespace}-CENTER`,
        isActive: true,
        createdBy,
        updatedBy: createdBy,
      },
    });

    await tx.room.createMany({ data: rooms, skipDuplicates: true });
    await tx.timeSlot.createMany({ data: timeSlots, skipDuplicates: true });

    await tx.user.createMany({ data: [...proctorUsers, ...studentUsers], skipDuplicates: true });
    await tx.proctor.createMany({ data: proctors, skipDuplicates: true });
    await tx.student.createMany({ data: students, skipDuplicates: true });

    if (proctorAvailabilities.length > 0) {
      await tx.proctorAvailability.createMany({
        data: proctorAvailabilities,
        skipDuplicates: true,
      });
    }

    await tx.course.createMany({ data: courses, skipDuplicates: true });
    await tx.courseOffering.createMany({ data: offerings, skipDuplicates: true });
    await tx.exam.createMany({ data: exams, skipDuplicates: true });
    await tx.registration.createMany({ data: registrations, skipDuplicates: true });
  }, { timeout: 180000 });

  return {
    namespace,
    semesterId,
    counts: {
      students: studentCount,
      offerings: courseOfferingCount,
      exams: examCount,
      rooms: roomCount,
      proctors: proctorCount,
      timeSlots: timeSlotCount,
      registrations: registrations.length,
    },
    maintenanceRoomIds,
    proctorsWithoutAvailability,
  };
};

