import bcrypt from 'bcrypt';
import prisma from '../../config/prisma.js';

const DEMO_PREFIX = 'DEMO-';
const DEMO_PASSWORD = 'Demo12345!';
const TARGET_STUDENTS = 520;

const addDays = (base, days) => { const d = new Date(base); d.setUTCDate(d.getUTCDate() + days); return d; };
const getAcademicYear = (startDate) => {
  const y = startDate.getUTCFullYear();
  return startDate.getUTCMonth() >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
};
const TARGET_SUPERVISORS = 4;

const departments = [
  ['Computer Science', 'DEMO-CS'],
  ['Business', 'DEMO-BUS'],
  ['Information Technology', 'DEMO-IT'],
  ['Mathematics and Statistics', 'DEMO-MATH'],
  ['Engineering', 'DEMO-ENG'],
  ['Health Sciences', 'DEMO-HS'],
];

const programs = [
  ['Bachelor of Computer Science', 'DEMO-BCS', 'DEMO-CS'],
  ['Bachelor of Software Engineering', 'DEMO-BSE', 'DEMO-CS'],
  ['Bachelor of Data Science', 'DEMO-BDS', 'DEMO-MATH'],
  ['Bachelor of Business Administration', 'DEMO-BBA', 'DEMO-BUS'],
  ['Bachelor of Accounting', 'DEMO-BAC', 'DEMO-BUS'],
  ['Bachelor of Information Systems', 'DEMO-BIS', 'DEMO-IT'],
  ['Bachelor of Cybersecurity', 'DEMO-BCY', 'DEMO-IT'],
  ['Bachelor of Industrial Engineering', 'DEMO-BIE', 'DEMO-ENG'],
  ['Bachelor of Biomedical Sciences', 'DEMO-BMS', 'DEMO-HS'],
];

const courseCatalog = [
  ['CS101', 'Programming Fundamentals', 'DEMO-BCS'], ['CS115', 'Computer Systems', 'DEMO-BCS'],
  ['CS205', 'Data Structures', 'DEMO-BCS'], ['CS240', 'Object-Oriented Programming', 'DEMO-BSE'],
  ['CS310', 'Algorithms', 'DEMO-BCS'], ['CS355', 'Operating Systems', 'DEMO-BCS'],
  ['SE210', 'Software Requirements', 'DEMO-BSE'], ['SE220', 'Software Design', 'DEMO-BSE'],
  ['SE330', 'Software Testing', 'DEMO-BSE'], ['SE340', 'Web Engineering', 'DEMO-BSE'],
  ['DS110', 'Data Literacy', 'DEMO-BDS'], ['DS230', 'Statistical Computing', 'DEMO-BDS'],
  ['DS310', 'Machine Learning', 'DEMO-BDS'], ['DS360', 'Data Visualization', 'DEMO-BDS'],
  ['BUS110', 'Principles of Management', 'DEMO-BBA'], ['BUS150', 'Business Communication', 'DEMO-BBA'],
  ['BUS240', 'Financial Accounting', 'DEMO-BAC'], ['BUS260', 'Managerial Accounting', 'DEMO-BAC'],
  ['BUS330', 'Operations Management', 'DEMO-BBA'], ['BUS370', 'Business Analytics', 'DEMO-BBA'],
  ['IT120', 'Information Systems', 'DEMO-BIS'], ['IT210', 'Systems Analysis', 'DEMO-BIS'],
  ['IT260', 'Database Systems', 'DEMO-BIS'], ['IT320', 'Cloud Platforms', 'DEMO-BIS'],
  ['CY210', 'Network Security', 'DEMO-BCY'], ['CY260', 'Secure Programming', 'DEMO-BCY'],
  ['CY330', 'Incident Response', 'DEMO-BCY'], ['CY360', 'Digital Forensics', 'DEMO-BCY'],
  ['MATH120', 'Calculus I', 'DEMO-BDS'], ['MATH220', 'Linear Algebra', 'DEMO-BDS'],
  ['STAT210', 'Probability', 'DEMO-BDS'], ['STAT330', 'Applied Regression', 'DEMO-BDS'],
  ['ENG101', 'Engineering Graphics', 'DEMO-BIE'], ['ENG220', 'Materials Science', 'DEMO-BIE'],
  ['ENG310', 'Operations Research', 'DEMO-BIE'], ['ENG350', 'Quality Engineering', 'DEMO-BIE'],
  ['HS110', 'Human Biology', 'DEMO-BMS'], ['HS210', 'Epidemiology', 'DEMO-BMS'],
  ['HS260', 'Health Informatics', 'DEMO-BMS'], ['HS340', 'Clinical Data Management', 'DEMO-BMS'],
  ['GEN101', 'Academic Writing', 'DEMO-BBA'], ['GEN210', 'Ethics and Society', 'DEMO-BMS'],
  ['GEN260', 'Research Methods', 'DEMO-BDS'], ['GEN310', 'Innovation Studio', 'DEMO-BIE'],
  ['LAB999', 'Extended Systems Laboratory', 'DEMO-BSE'], ['CAP499', 'Integrated Capstone Review', 'DEMO-BCS'],
  ['MEGA450', 'University Common Final', 'DEMO-BBA'], ['OVER490', 'Cross-Listed Audit Seminar', 'DEMO-BIS'],
  ['NORES510', 'Unavailable Resource Drill', 'DEMO-BIE'],
];

const centers = [
  ['Main Campus', 'DEMO-MAIN', 'Central Academic District'],
  ['North Campus', 'DEMO-NORTH', 'North Science Complex'],
  ['Innovation Campus', 'DEMO-INNOV', 'Technology Park'],
  ['Health Campus', 'DEMO-HEALTH', 'Medical District'],
];

const roomTemplates = [
  ['Auditorium A', 44], ['Auditorium B', 38], ['Room 101', 22], ['Room 102', 20], ['Room 201', 18], ['Lab 1', 16], ['Seminar Room', 8],
];

const firstNames = ['Layla', 'Omar', 'Sara', 'Adam', 'Nour', 'Yara', 'Karim', 'Maya', 'Ziad', 'Rana', 'Tala', 'Fadi', 'Hala', 'Samir', 'Dina', 'Nadia', 'Bilal', 'Lina', 'Rami', 'Mona', 'Jad', 'Salma', 'Elias', 'Farah', 'Amir', 'Celine', 'Malek', 'Reem', 'Kareem', 'Aya'];
const lastNames = ['Ahmed', 'Hassan', 'Khalil', 'Nasser', 'Mansour', 'Saleh', 'Fouad', 'Issa', 'Rahman', 'Darwish', 'Youssef', 'Karam', 'Othman', 'Nasr', 'Farah', 'Haddad', 'Sami', 'Omar', 'Zein', 'Amin', 'Habib', 'Tarek', 'Nour', 'Kamal', 'Zaki', 'Riad', 'Hani', 'Adel', 'Mourad', 'Basel'];
const instructorNames = ['Dr. Nora Saleh', 'Dr. Adam Farouk', 'Dr. Lina Haddad', 'Dr. Omar Nasser', 'Dr. Maya Khalil', 'Prof. Karim Mansour', 'Prof. Hala Youssef', 'Prof. Sami Darwish', 'Dr. Rana Issa', 'Dr. Ziad Rahman', 'Dr. Leila Omari', 'Dr. Fadi Hassan'];
const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Sunday'];
const times = ['08:00', '09:30', '11:00', '13:00', '14:30', '16:00'];
const programCodes = programs.map(([, code]) => code);

const generateSlotSpecs = () => {
  const base = addDays(new Date(), 7);
  const starts = ['08:00', '10:30', '13:00', '15:30'];
  const ends = ['10:00', '12:30', '15:00', '17:30'];
  return Array.from({ length: 24 }, (_, index) => {
    const dayOffset = Math.floor(index / 4);
    const slotIndex = index % 4;
    const date = addDays(base, dayOffset);
    return [date.toISOString().slice(0, 10), starts[slotIndex], ends[slotIndex]];
  });
};

const toDate = (date, time) => new Date(`${date}T${time}:00.000Z`);
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
const studentEmail = (index) => `demo.student${String(index + 1).padStart(4, '0')}@st.uni.edu`;
const supervisorEmail = (index) => `demo.supervisor${String(index + 1).padStart(3, '0')}@uni.edu`;
const demoStudentEmails = () => Array.from({ length: TARGET_STUDENTS }, (_, index) => studentEmail(index));
const demoSupervisorEmails = () => Array.from({ length: TARGET_SUPERVISORS }, (_, index) => supervisorEmail(index));
const demoTimeSlotWhere = () => ({ createdBy: 'demo-data' });
const demoSemesterNames = ['Current Demo Semester', 'Upcoming Demo Semester', 'Past Demo Semester'];
// Also match legacy names used before the rename (e.g. "Fall 2026", "Fall 2027", "Spring 2027")
// and any record marked createdBy:'demo-data' so stale rows are always cleared on re-generate.
const demoSemesterWhere = () => ({
  OR: [
    { name: { in: demoSemesterNames } },
    { createdBy: 'demo-data' },
  ],
});
const fullName = (index) => `${firstNames[index % firstNames.length]} ${lastNames[Math.floor(index / firstNames.length) % lastNames.length]}`;

const getExpectedTestCases = () => ({
  normalSchedulableCount: 44,
  overcapacityCourse: 'DEMO-MEGA450 — University Common Final requires 700 seats, which exceeds the full demo room inventory of about 664 seats. DEMO-OVER490 — Cross-Listed Audit Seminar also exceeds every single-room capacity at 55 students versus a 44-seat maximum room.',
  overlapStudentGroup: 'The first 32 demo students are enrolled in 28 overlap-group exams while only 24 valid time slots exist, so at least some exams must save STUDENT_OVERLAP conflicts with readable student names and emails.',
  supervisorLimitedCase: 'Only 4 demo supervisors exist and each is capped at 1 exam per day, so at least one exam must save SUPERVISOR_DOUBLE_BOOKED or RESOURCE_UNAVAILABLE after the denser slots are consumed.',
  resourceUnavailableCase: 'DEMO-NORES510 — Unavailable Resource Drill requires 180 supervised seats. Total demo room capacity is enough, but only four supervisors can cover at most 176 seats in a slot, so generation must save RESOURCE_UNAVAILABLE.',
  invalidTimeSlotCase: 'DEMO-LAB999 — Extended Systems Laboratory requires 180 minutes while every generated time slot lasts 120 minutes, so generation must save a TIME_CONSTRAINT_VIOLATION conflict instead of an assignment.',
  timeConstraintViolation: 'DEMO-LAB999 — Extended Systems Laboratory requires 180 minutes while every generated time slot lasts 120 minutes, so generation must save a TIME_CONSTRAINT_VIOLATION conflict instead of an assignment.',
  roomOvercapacityTotal: 'DEMO-MEGA450 — University Common Final requires 700 seats, which exceeds the full demo room inventory of about 664 seats.',
  roomOvercapacitySingle: 'DEMO-OVER490 — Cross-Listed Audit Seminar has 55 enrolled students, which exceeds every single-room capacity in the demo inventory (maximum 44 seats).',
  studentOverlap: 'The first 32 demo students are enrolled in 28 overlap-group exams while only 24 valid time slots exist, so some exams must save STUDENT_OVERLAP conflicts with readable student names and emails.',
  supervisorDoubleBooked: 'Only 4 demo supervisors exist and each is capped at 1 exam per day, so at least one exam must save SUPERVISOR_DOUBLE_BOOKED or RESOURCE_UNAVAILABLE after denser slots are consumed.',
  smallRooms: 'Each demo center includes an 8-seat Seminar Room so room-capacity mismatch cases are visible alongside larger halls and labs.',
  tooFewTimeSlots: 'Only 24 valid time slots are generated for 49 demo exams, intentionally forcing overlap and supervisor-capacity pressure during schedule generation.',
});

const countDemoData = async () => {
  const [departmentsCount, programsCount, semestersCount, coursesCount, courseOfferingsCount, examsCount, centersCount, roomsCount, supervisorsCount, studentsCount, timeSlotsCount, registrationsCount] = await Promise.all([
    prisma.department.count({ where: { code: { startsWith: DEMO_PREFIX } } }),
    prisma.program.count({ where: { code: { startsWith: DEMO_PREFIX } } }),
    prisma.semester.count({ where: demoSemesterWhere() }),
    prisma.course.count({ where: { code: { startsWith: DEMO_PREFIX } } }),
    prisma.courseOffering.count({ where: { course: { code: { startsWith: DEMO_PREFIX } } } }),
    prisma.exam.count({ where: { courseOffering: { course: { code: { startsWith: DEMO_PREFIX } } } } }),
    prisma.center.count({ where: { code: { startsWith: DEMO_PREFIX } } }),
    prisma.room.count({ where: { center: { code: { startsWith: DEMO_PREFIX } } } }),
    prisma.supervisor.count({ where: { user: { email: { in: demoSupervisorEmails() } } } }),
    prisma.student.count({ where: { universityId: { startsWith: DEMO_PREFIX } } }),
    prisma.timeSlot.count({ where: demoTimeSlotWhere() }),
    prisma.registration.count({ where: { student: { universityId: { startsWith: DEMO_PREFIX } } } }),
  ]);

  return {
    students: studentsCount,
    supervisors: supervisorsCount,
    centers: centersCount,
    rooms: roomsCount,
    timeSlots: timeSlotsCount,
    departments: departmentsCount,
    programs: programsCount,
    courses: coursesCount,
    courseOfferings: courseOfferingsCount,
    registrations: registrationsCount,
    semesters: semestersCount,
    exams: examsCount,
  };
};

const upsertUser = (tx, { name, email, role, passwordHash }) => tx.user.upsert({
  where: { email },
  update: { name, role },
  create: { name, email, role, password: passwordHash },
});

const clearDemoDataWithTx = async (tx) => {
  const demoSchedules = await tx.schedule.findMany({
    where: {
      OR: [
        { name: { startsWith: 'Demo ' } },
        { assignments: { some: { exam: { courseOffering: { course: { code: { startsWith: DEMO_PREFIX } } } } } } },
        { conflicts: { some: { description: { contains: 'DEMO-' } } } },
      ],
    },
    select: { id: true },
  });
  if (demoSchedules.length > 0) await tx.schedule.deleteMany({ where: { id: { in: demoSchedules.map((schedule) => schedule.id) } } });

  await tx.registration.deleteMany({ where: { student: { universityId: { startsWith: DEMO_PREFIX } } } });
  await tx.exam.deleteMany({ where: { courseOffering: { course: { code: { startsWith: DEMO_PREFIX } } } } });
  await tx.courseOffering.deleteMany({ where: { course: { code: { startsWith: DEMO_PREFIX } } } });
  await tx.course.deleteMany({ where: { code: { startsWith: DEMO_PREFIX } } });
  await tx.student.deleteMany({ where: { universityId: { startsWith: DEMO_PREFIX } } });

  // Find demo center IDs first so we can delete ALL supervisors linked to them (any email format)
  const demoCenterRows = await tx.center.findMany({
    where: { code: { startsWith: DEMO_PREFIX } },
    select: { id: true },
  });
  const demoCenterIds = demoCenterRows.map((c) => c.id);

  if (demoCenterIds.length > 0) {
    // Collect user IDs of supervisors tied to demo centers before deleting them
    const linkedSupervisors = await tx.supervisor.findMany({
      where: { centerId: { in: demoCenterIds } },
      select: { userId: true },
    });
    await tx.supervisor.deleteMany({ where: { centerId: { in: demoCenterIds } } });
    // Delete those supervisor user accounts
    const linkedUserIds = linkedSupervisors.map((s) => s.userId);
    if (linkedUserIds.length > 0) {
      await tx.user.deleteMany({ where: { id: { in: linkedUserIds } } });
    }
    await tx.room.deleteMany({ where: { centerId: { in: demoCenterIds } } });
    await tx.center.deleteMany({ where: { id: { in: demoCenterIds } } });
  }

  // Also clean up any remaining demo student user accounts
  await tx.user.deleteMany({ where: { email: { in: demoStudentEmails() } } });
  await tx.program.deleteMany({ where: { code: { startsWith: DEMO_PREFIX } } });
  await tx.department.deleteMany({ where: { code: { startsWith: DEMO_PREFIX } } });
  await tx.semester.deleteMany({ where: demoSemesterWhere() });
  await tx.timeSlot.deleteMany({ where: demoTimeSlotWhere() });
};

const createDepartments = async (tx) => {
  const map = new Map();
  for (const [name, code] of departments) {
    const row = await tx.department.upsert({ where: { code }, update: { name }, create: { name, code } });
    map.set(code, row);
  }
  return map;
};

const createPrograms = async (tx, departmentByCode) => {
  const map = new Map();
  for (const [name, code, departmentCode] of programs) {
    const row = await tx.program.upsert({
      where: { code },
      update: { name, departmentId: departmentByCode.get(departmentCode).id, isActive: true },
      create: { name, code, departmentId: departmentByCode.get(departmentCode).id, description: 'Large demo program for scheduling tests.', isActive: true },
    });
    map.set(code, row);
  }
  return map;
};

const createSemesters = async (tx) => {
  const now = new Date();
  const pastStart = addDays(now, -365);
  const pastEnd = addDays(now, -180);
  const currentStart = addDays(now, -30);
  const currentEnd = addDays(now, 150);
  const upcomingStart = addDays(now, 180);
  const upcomingEnd = addDays(now, 330);

  const past = await tx.semester.create({
    data: { name: 'Past Demo Semester', startDate: pastStart, endDate: pastEnd,
      isActive: false, isCurrent: false, academicYear: getAcademicYear(pastStart), status: 'PAST', createdBy: 'demo-data' },
  });
  const current = await tx.semester.create({
    data: { name: 'Current Demo Semester', startDate: currentStart, endDate: currentEnd,
      isActive: true, isCurrent: true, academicYear: getAcademicYear(currentStart), status: 'ACTIVE', createdBy: 'demo-data' },
  });
  const upcoming = await tx.semester.create({
    data: { name: 'Upcoming Demo Semester', startDate: upcomingStart, endDate: upcomingEnd,
      isActive: false, isCurrent: false, academicYear: getAcademicYear(upcomingStart), status: 'UPCOMING', createdBy: 'demo-data' },
  });
  return { fall: current, spring: upcoming, past };
};

const createCourses = async (tx, programByCode, semester) => {
  const map = new Map();
  for (const [baseCode, title, programCode] of courseCatalog) {
    const code = `${DEMO_PREFIX}${baseCode}`;
    const row = await tx.course.create({
      data: { code, title, programId: programByCode.get(programCode).id, semesterId: semester.id, credits: 3, description: 'Large demo course for relational UI and scheduling tests.', isActive: true },
    });
    map.set(code, row);
  }
  return map;
};

const createCourseOfferings = async (tx, courseByCode, semester) => {
  const map = new Map();
  const entries = [...courseByCode.entries()];
  for (const [index, [code, course]] of entries.entries()) {
    const isOvercapacity = code === 'DEMO-MEGA450';
    const isSingleRoomOverflow = code === 'DEMO-OVER490';
    const row = await tx.courseOffering.create({
      data: {
        courseId: course.id,
        semesterId: semester.id,
        section: 'A',
        instructor: instructorNames[index % instructorNames.length],
        expectedStudents: isOvercapacity ? 700 : isSingleRoomOverflow ? 55 : code === 'DEMO-NORES510' ? 180 : 18 + (index % 18),
        capacity: isOvercapacity ? 760 : isSingleRoomOverflow ? 60 : code === 'DEMO-NORES510' ? 220 : 40 + (index % 24),
        day: days[index % days.length],
        time: times[index % times.length],
        roomLabel: 'Demo assigned room TBD',
        notes: code === 'DEMO-MEGA450'
          ? 'Conflict case: enrollment exceeds total available demo room capacity.'
          : code === 'DEMO-LAB999'
            ? 'Conflict case: exam duration is longer than all generated time slots.'
            : code === 'DEMO-OVER490'
              ? 'Conflict case: 55 enrolled students exceed the largest single room (44 seats). Requires multi-room assignment with 2 supervisors.'
              : code === 'DEMO-NORES510'
                ? 'Conflict case: total room inventory is sufficient, but supervisor coverage cannot provide enough simultaneous supervised seats.'
                : 'Large demo offering for scheduling engine tests.',
        priority: code === 'DEMO-MEGA450' ? 100 : 10 - (index % 8),
        difficulty: code === 'DEMO-LAB999' ? 10 : 3 + (index % 7),
        status: 'ACTIVE',
      },
    });
    map.set(code, row);
  }
  return map;
};

const createCentersAndRooms = async (tx) => {
  const centerByCode = new Map();
  for (const [name, code, location] of centers) {
    const center = await tx.center.create({ data: { name, code, location, description: 'Large demo center for scheduling tests.', isActive: true } });
    centerByCode.set(code, center);
  }
  for (const [centerIndex, [, centerCode]] of centers.entries()) {
    const center = centerByCode.get(centerCode);
    for (const [roomIndex, [name, capacity]] of roomTemplates.entries()) {
      await tx.room.create({ data: { centerId: center.id, name: `${name}-${centerIndex + 1}`, capacity, status: 'AVAILABLE' } });
    }
  }
  return centerByCode;
};

const createSupervisors = async (tx, centerByCode, passwordHash) => {
  const centerRows = [...centerByCode.values()];
  for (let index = 0; index < TARGET_SUPERVISORS; index += 1) {
    const name = `Supervisor ${fullName(index)}`;
    const user = await upsertUser(tx, { name, email: supervisorEmail(index), role: 'SUPERVISOR', passwordHash });
    await tx.supervisor.create({ data: { userId: user.id, centerId: centerRows[index % centerRows.length].id, department: index % 2 === 0 ? 'Academic Affairs' : 'Exam Operations', maxExamsPerDay: 1 } });
  }
};

const createStudents = async (tx, programByCode, passwordHash) => {
  const students = [];
  for (let index = 0; index < TARGET_STUDENTS; index += 1) {
    const user = await upsertUser(tx, { name: fullName(index), email: studentEmail(index), role: 'STUDENT', passwordHash });
    const student = await tx.student.create({
      data: { userId: user.id, universityId: `${DEMO_PREFIX}STU-${String(index + 1).padStart(4, '0')}`, programId: programByCode.get(programCodes[index % programCodes.length]).id },
    });
    students.push(student);
  }
  return students;
};

const createTimeSlots = async (tx) => {
  for (const [date, start, end] of generateSlotSpecs()) {
    await tx.timeSlot.create({ data: { startTime: toDate(date, start), endTime: toDate(date, end), date: toDate(date, '00:00'), duration: 120, createdBy: 'demo-data' } });
  }
};

const createExams = async (tx, offeringByCode) => {
  for (const [code, offering] of offeringByCode.entries()) {
    await tx.exam.create({ data: { courseOfferingId: offering.id, status: 'DRAFT', duration: code === 'DEMO-LAB999' ? 180 : 120 } });
  }
};

const createRegistrations = async (tx, students, offeringByCode) => {
  const offeringCodes = [...offeringByCode.keys()];
  const registrationKeys = new Set();
  const add = (studentIndex, code) => {
    const student = students[studentIndex % students.length];
    const offering = offeringByCode.get(code);
    if (!student || !offering) return;
    registrationKeys.add(`${student.id}:${offering.id}`);
  };

  // Broad realistic enrollment distribution: every offering receives students and most stay within capacity.
  for (const [offeringIndex, code] of offeringCodes.entries()) {
    const target = code === 'DEMO-MEGA450' ? TARGET_STUDENTS
      : code === 'DEMO-OVER490' ? 55
      : code === 'DEMO-NORES510' ? 64
      : 12 + (offeringIndex % 18);
    for (let offset = 0; offset < target; offset += 1) {
      add((offeringIndex * 17 + offset) % students.length, code);
    }
  }

  // Student overlap case: first 32 students are enrolled in 28 exams across only 24 time slots.
  const overlapCodes = offeringCodes.filter((code) => code !== 'DEMO-MEGA450').slice(0, 28);
  for (let studentIndex = 0; studentIndex < 32; studentIndex += 1) {
    for (const code of overlapCodes) add(studentIndex, code);
  }

  const data = [...registrationKeys].map((key) => {
    const [studentId, courseOfferingId] = key.split(':');
    return { studentId, courseOfferingId, status: 'ACTIVE' };
  });

  const batchSize = 500;
  for (let index = 0; index < data.length; index += batchSize) {
    await tx.registration.createMany({ data: data.slice(index, index + batchSize), skipDuplicates: true });
  }

  return data.length;
};

export const generateDemoData = async () => {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  let registrationCount = 0;

  await prisma.$transaction(async (tx) => {
    await clearDemoDataWithTx(tx);
    const departmentByCode = await createDepartments(tx);
    const programByCode = await createPrograms(tx, departmentByCode);
    const { fall } = await createSemesters(tx);
    const courseByCode = await createCourses(tx, programByCode, fall);
    const offeringByCode = await createCourseOfferings(tx, courseByCode, fall);
    const centerByCode = await createCentersAndRooms(tx);
    await createSupervisors(tx, centerByCode, passwordHash);
    const students = await createStudents(tx, programByCode, passwordHash);
    await createTimeSlots(tx);
    await createExams(tx, offeringByCode);
    registrationCount = await createRegistrations(tx, students, offeringByCode);
  }, { timeout: 120000 });

  const summary = await countDemoData();

  return {
    message: 'Big demo dataset generated successfully.',
    loginHint: 'Demo users use password Demo12345!',
    summary,
    generatedCounts: summary,
    expectedTestCases: getExpectedTestCases(),
    instruction: 'Run schedule generation, then check GET /api/conflicts.',
    generatedRegistrations: registrationCount,
  };
};

export const clearDemoData = async () => {
  await prisma.$transaction(async (tx) => {
    await clearDemoDataWithTx(tx);
  }, { timeout: 120000 });

  return {
    message: 'Big demo dataset cleared successfully.',
    summary: await countDemoData(),
    expectedTestCases: getExpectedTestCases(),
  };
};
