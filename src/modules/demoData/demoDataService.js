import bcrypt from 'bcrypt';
import prisma from '../../config/prisma.js';

const DEMO_PREFIX = 'DEMO-';
const DEMO_PASSWORD = 'Demo12345!';
const DEMO_DATASET_KEYS = ['A', 'B', 'C'];

const departmentTemplates = [
  { name: 'Computer Science', code: 'CS' },
  { name: 'Information Technology', code: 'IT' },
  { name: 'Business Analytics', code: 'BUS' },
  { name: 'Engineering Systems', code: 'ENG' },
];

const programTemplates = [
  { name: 'Computer Science', code: 'CS', departmentCode: 'CS' },
  { name: 'Information Technology', code: 'IT', departmentCode: 'IT' },
  { name: 'Management Information Systems', code: 'MIS', departmentCode: 'BUS' },
  { name: 'Computer Engineering', code: 'CE', departmentCode: 'ENG' },
];

const courseTemplates = [
  { code: 'CS101', title: 'Programming Fundamentals', programCode: 'CS', cohorts: ['CS', 'IT', 'CE'], target: 110, duration: 120, priority: 100, difficulty: 8 },
  { code: 'IT101', title: 'Information Systems Foundations', programCode: 'IT', cohorts: ['IT', 'MIS', 'CS'], target: 100, duration: 120, priority: 94, difficulty: 7 },
  { code: 'MIS210', title: 'Business Process Analytics', programCode: 'MIS', cohorts: ['MIS', 'IT'], target: 90, duration: 120, priority: 88, difficulty: 6 },
  { code: 'CE120', title: 'Digital Logic Design', programCode: 'CE', cohorts: ['CE', 'CS'], target: 84, duration: 120, priority: 86, difficulty: 7 },
  { code: 'GEN201', title: 'Professional Communication', programCode: 'MIS', cohorts: ['CS', 'IT', 'MIS', 'CE'], target: 120, duration: 120, priority: 82, difficulty: 5 },
  { code: 'CS240', title: 'Data Structures and Algorithms', programCode: 'CS', cohorts: ['CS'], target: 48, duration: 150, priority: 76, difficulty: 9 },
  { code: 'IT220', title: 'Network Administration', programCode: 'IT', cohorts: ['IT'], target: 44, duration: 120, priority: 72, difficulty: 7 },
  { code: 'MIS230', title: 'Enterprise Systems', programCode: 'MIS', cohorts: ['MIS'], target: 46, duration: 120, priority: 70, difficulty: 6 },
  { code: 'CE210', title: 'Embedded Systems', programCode: 'CE', cohorts: ['CE'], target: 42, duration: 150, priority: 68, difficulty: 8 },
  { code: 'CS330', title: 'Operating Systems', programCode: 'CS', cohorts: ['CS'], target: 38, duration: 120, priority: 64, difficulty: 8 },
  { code: 'IT310', title: 'Cloud Infrastructure', programCode: 'IT', cohorts: ['IT'], target: 36, duration: 180, priority: 62, difficulty: 8 },
  { code: 'MIS340', title: 'Decision Support Systems', programCode: 'MIS', cohorts: ['MIS'], target: 34, duration: 120, priority: 60, difficulty: 6 },
  { code: 'CE320', title: 'Computer Architecture', programCode: 'CE', cohorts: ['CE'], target: 36, duration: 120, priority: 58, difficulty: 8 },
  { code: 'STAT305', title: 'Applied Statistics for Computing', programCode: 'MIS', cohorts: ['MIS', 'IT'], target: 50, duration: 120, priority: 56, difficulty: 7 },
  { code: 'CS410', title: 'Artificial Intelligence', programCode: 'CS', cohorts: ['CS'], target: 30, duration: 120, priority: 44, difficulty: 9 },
  { code: 'IT420', title: 'Cybersecurity Operations', programCode: 'IT', cohorts: ['IT'], target: 28, duration: 120, priority: 42, difficulty: 8 },
  { code: 'MIS450', title: 'Digital Transformation Strategy', programCode: 'MIS', cohorts: ['MIS'], target: 26, duration: 120, priority: 40, difficulty: 6 },
  { code: 'CE430', title: 'Robotics Systems', programCode: 'CE', cohorts: ['CE'], target: 24, duration: 120, priority: 38, difficulty: 8 },
];

const centerNamePool = [
  'Central Campus Examination Center',
  'North Technology Campus',
  'Business School Testing Center',
  'Engineering Innovation Campus',
  'South City Assessment Hub',
  'Health Sciences Evaluation Center',
  'West Research Campus',
  'Graduate Studies Assessment Hall',
];

const roomNamePool = [
  'Grand Examination Hall',
  'Lecture Theatre',
  'Assessment Studio',
  'Innovation Hall',
  'Testing Lab',
  'Seminar Hall',
  'Forum Room',
  'Conference Hall',
  'Scholars Hall',
  'Digital Lab',
  'Academic Hall',
  'Learning Commons',
];

const roomCapacityPool = [220, 200, 180, 160, 140, 128, 116, 104, 96, 88, 80, 72, 64, 56, 48, 42];
const slotSessions = [
  ['09:00', '12:00'],
  ['13:00', '16:00'],
];
const courseTitleVariants = ['Advanced', 'Applied', 'Studio', 'Laboratory', 'Seminar', 'Workshop'];

const datasetProfiles = {
  A: {
    key: 'A',
    namespace: 'DEMO-A',
    label: 'Dataset A',
    description: 'Balanced baseline dataset',
    semesterName: 'Demo Dataset A - Balanced Fall 2026',
    semesterStartDate: '2026-12-07',
    semesterEndDate: '2026-12-17',
    academicYear: '2026-2027',
    studentCount: 200,
    proctorCount: 28,
    centerCount: 4,
    roomCount: 10,
    offeringCount: 18,
    slotDays: 11,
    targetScale: 1,
    maxOfferingTarget: 120,
  },
  B: {
    key: 'B',
    namespace: 'DEMO-B',
    label: 'Dataset B',
    description: 'Scaled feasible dataset with more than 40 offerings',
    semesterName: 'Demo Dataset B - Expanded Spring 2027',
    semesterStartDate: '2027-05-10',
    semesterEndDate: '2027-05-25',
    academicYear: '2026-2027',
    studentCount: 420,
    proctorCount: 54,
    centerCount: 6,
    roomCount: 18,
    offeringCount: 44,
    slotDays: 16,
    targetScale: 1.08,
    maxOfferingTarget: 135,
  },
  C: {
    key: 'C',
    namespace: 'DEMO-C',
    label: 'Dataset C',
    description: 'Largest feasible dataset with more than 55 offerings',
    semesterName: 'Demo Dataset C - Enterprise Fall 2027',
    semesterStartDate: '2027-12-01',
    semesterEndDate: '2027-12-20',
    academicYear: '2027-2028',
    studentCount: 620,
    proctorCount: 78,
    centerCount: 8,
    roomCount: 24,
    offeringCount: 60,
    slotDays: 20,
    targetScale: 1.15,
    maxOfferingTarget: 145,
  },
};

const firstNames = ['Layla', 'Omar', 'Sara', 'Adam', 'Nour', 'Yara', 'Karim', 'Maya', 'Ziad', 'Rana', 'Tala', 'Fadi', 'Hala', 'Samir', 'Dina', 'Nadia', 'Bilal', 'Lina', 'Rami', 'Mona', 'Jad', 'Salma', 'Elias', 'Farah', 'Amir', 'Celine', 'Malek', 'Reem', 'Kareem', 'Aya'];
const lastNames = ['Ahmed', 'Hassan', 'Khalil', 'Nasser', 'Mansour', 'Saleh', 'Fouad', 'Issa', 'Rahman', 'Darwish', 'Youssef', 'Karam', 'Othman', 'Nasr', 'Farah', 'Haddad', 'Sami', 'Omar', 'Zein', 'Amin', 'Habib', 'Tarek', 'Nour', 'Kamal', 'Zaki', 'Riad', 'Hani', 'Adel', 'Mourad', 'Basel'];
const instructorNames = ['Dr. Nora Saleh', 'Dr. Adam Farouk', 'Dr. Lina Haddad', 'Dr. Omar Nasser', 'Dr. Maya Khalil', 'Prof. Karim Mansour', 'Prof. Hala Youssef', 'Prof. Sami Darwish', 'Dr. Rana Issa', 'Dr. Ziad Rahman', 'Dr. Leila Omari', 'Dr. Fadi Hassan'];

const toDate = (date, time) => new Date(`${date}T${time}:00.000Z`);
const fullName = (index) => `${firstNames[index % firstNames.length]} ${lastNames[Math.floor(index / firstNames.length) % lastNames.length]}`;
const buildCreatedBy = (datasetKey) => `demo-data:${datasetKey}`;
const buildStudentEmail = (datasetKey, index) => `demo.${datasetKey.toLowerCase()}.student${String(index + 1).padStart(4, '0')}@st.uni.edu`;
const buildProctorEmail = (datasetKey, index) => `demo.${datasetKey.toLowerCase()}.proctor${String(index + 1).padStart(3, '0')}@uni.edu`;
const buildStudentUniversityId = (namespace, index) => `${namespace}-STU-${String(index + 1).padStart(4, '0')}`;

const normalizeDatasetKey = (input) => {
  if (typeof input === 'string' && datasetProfiles[input]) return input;
  if (input === 'clean' || input === 'feasible' || input === 'balanced') return 'A';
  if (input === 'expanded' || input === 'large') return 'B';
  if (input === 'enterprise' || input === 'xl') return 'C';
  return 'A';
};

const getProfile = (datasetKey) => datasetProfiles[normalizeDatasetKey(datasetKey)];

const buildDepartmentSpecs = (profile) => departmentTemplates.map((item) => ({
  code: `${profile.namespace}-DEPT-${item.code}`,
  name: `${item.name} (${profile.label})`,
}));

const buildProgramSpecs = (profile) => programTemplates.map((item) => ({
  code: `${profile.namespace}-PROG-${item.code}`,
  name: `${item.name} (${profile.label})`,
  departmentCode: `${profile.namespace}-DEPT-${item.departmentCode}`,
}));

const buildOfferingPlans = (profile) => Array.from({ length: profile.offeringCount }, (_, index) => {
  const template = courseTemplates[index % courseTemplates.length];
  const cycle = Math.floor(index / courseTemplates.length);
  const variant = cycle === 0 ? '' : ` ${courseTitleVariants[(cycle - 1) % courseTitleVariants.length]}`;
  const target = Math.min(
    profile.maxOfferingTarget,
    Math.max(24, Math.round(template.target * profile.targetScale) + cycle * 6 + (index % 4) * 3),
  );

  return {
    code: `${profile.namespace}-${template.code}-${String(cycle + 1).padStart(2, '0')}`,
    title: `${template.title}${variant}`,
    programCode: `${profile.namespace}-PROG-${template.programCode}`,
    cohorts: template.cohorts.map((code) => `${profile.namespace}-PROG-${code}`),
    target,
    duration: template.duration,
    priority: Math.max(25, template.priority - cycle * 2),
    difficulty: Math.min(10, template.difficulty + (cycle % 2)),
  };
});

const buildCenterSpecs = (profile) => Array.from({ length: profile.centerCount }, (_, index) => ({
  code: `${profile.namespace}-CENTER-${String(index + 1).padStart(2, '0')}`,
  name: `${centerNamePool[index]} (${profile.label})`,
  location: `Campus ${index + 1} - ${profile.label}`,
}));

const buildRoomPlans = (profile, centers) => {
  const roomPlans = [];
  const roomsPerCenter = Math.floor(profile.roomCount / centers.length);
  const extraRooms = profile.roomCount % centers.length;
  let roomIndex = 0;

  for (const [centerIndex, center] of centers.entries()) {
    const countForCenter = roomsPerCenter + (centerIndex < extraRooms ? 1 : 0);
    for (let localIndex = 0; localIndex < countForCenter; localIndex += 1) {
      roomPlans.push({
        centerCode: center.code,
        name: `${roomNamePool[roomIndex % roomNamePool.length]} ${String(localIndex + 1).padStart(2, '0')}`,
        capacity: roomCapacityPool[roomIndex % roomCapacityPool.length],
      });
      roomIndex += 1;
    }
  }

  return roomPlans;
};

const buildTimeSlotSpecs = (profile) => {
  const specs = [];
  const baseDate = new Date(`${profile.semesterStartDate}T00:00:00.000Z`);

  for (let dayIndex = 0; dayIndex < profile.slotDays; dayIndex += 1) {
    const date = new Date(baseDate);
    date.setUTCDate(baseDate.getUTCDate() + dayIndex);
    const dateString = date.toISOString().slice(0, 10);

    for (const [start, end] of slotSessions) {
      specs.push([dateString, start, end]);
    }
  }

  return specs;
};

const buildDatasetScope = (datasetKey) => {
  const profile = getProfile(datasetKey);
  return {
    profile,
    namespace: profile.namespace,
    createdBy: buildCreatedBy(profile.key),
    studentEmailPrefix: `demo.${profile.key.toLowerCase()}.student`,
    proctorEmailPrefix: `demo.${profile.key.toLowerCase()}.proctor`,
    studentUniversityPrefix: `${profile.namespace}-STU-`,
    centerCodePrefix: `${profile.namespace}-CENTER-`,
    departmentCodePrefix: `${profile.namespace}-DEPT-`,
    programCodePrefix: `${profile.namespace}-PROG-`,
  };
};

const upsertUser = (tx, { name, email, role, passwordHash }) => tx.user.upsert({
  where: { email },
  update: { name, role, password: passwordHash },
  create: { name, email, role, password: passwordHash },
});

const selectStudents = (students, cohorts, count, offset) => {
  const pool = students.filter((student) => cohorts.includes(student.programCode));
  const selected = [];
  const seen = new Set();

  for (let index = 0; selected.length < count && index < pool.length * 2; index += 1) {
    const student = pool[(index + offset) % pool.length];
    if (!student || seen.has(student.id)) continue;
    seen.add(student.id);
    selected.push(student);
  }

  return selected;
};

const countDemoData = async (datasetKey) => {
  const scope = datasetKey ? buildDatasetScope(datasetKey) : null;

  const [departmentsCount, programsCount, semestersCount, coursesCount, courseOfferingsCount, examsCount, centersCount, roomsCount, proctorsCount, studentsCount, timeSlotsCount, registrationsCount, schedulesCount] = await Promise.all([
    prisma.department.count({ where: scope ? { code: { startsWith: scope.departmentCodePrefix } } : { code: { startsWith: DEMO_PREFIX } } }),
    prisma.program.count({ where: scope ? { code: { startsWith: scope.programCodePrefix } } : { code: { startsWith: DEMO_PREFIX } } }),
    prisma.semester.count({ where: scope ? { createdBy: scope.createdBy } : { createdBy: { startsWith: 'demo-data:' } } }),
    prisma.course.count({ where: scope ? { code: { startsWith: scope.namespace } } : { code: { startsWith: DEMO_PREFIX } } }),
    prisma.courseOffering.count({ where: scope ? { course: { code: { startsWith: scope.namespace } } } : { course: { code: { startsWith: DEMO_PREFIX } } } }),
    prisma.exam.count({ where: scope ? { courseOffering: { course: { code: { startsWith: scope.namespace } } } } : { courseOffering: { course: { code: { startsWith: DEMO_PREFIX } } } } }),
    prisma.center.count({ where: scope ? { code: { startsWith: scope.centerCodePrefix } } : { code: { startsWith: DEMO_PREFIX } } }),
    prisma.room.count({ where: scope ? { center: { code: { startsWith: scope.centerCodePrefix } } } : { center: { code: { startsWith: DEMO_PREFIX } } } }),
    prisma.proctor.count({ where: scope ? { user: { email: { startsWith: scope.proctorEmailPrefix } } } : { user: { email: { startsWith: 'demo.' } } } }),
    prisma.student.count({ where: scope ? { universityId: { startsWith: scope.studentUniversityPrefix } } : { universityId: { startsWith: DEMO_PREFIX } } }),
    prisma.timeSlot.count({ where: scope ? { createdBy: scope.createdBy } : { createdBy: { startsWith: 'demo-data:' } } }),
    prisma.registration.count({ where: scope ? { courseOffering: { course: { code: { startsWith: scope.namespace } } } } : { courseOffering: { course: { code: { startsWith: DEMO_PREFIX } } } } }),
    prisma.schedule.count({ where: scope ? { assignments: { some: { exam: { courseOffering: { course: { code: { startsWith: scope.namespace } } } } } } } : { assignments: { some: { exam: { courseOffering: { course: { code: { startsWith: DEMO_PREFIX } } } } } } } }),
  ]);

  return {
    students: studentsCount,
    proctors: proctorsCount,
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
    schedules: schedulesCount,
  };
};

const clearDemoDatasetWithTx = async (tx, datasetKey) => {
  const scope = buildDatasetScope(datasetKey);

  const demoSchedules = await tx.schedule.findMany({
    where: {
      OR: [
        { createdBy: scope.createdBy },
        { assignments: { some: { exam: { courseOffering: { course: { code: { startsWith: scope.namespace } } } } } } },
      ],
    },
    select: { id: true },
  });

  if (demoSchedules.length > 0) {
    await tx.schedule.deleteMany({ where: { id: { in: demoSchedules.map((schedule) => schedule.id) } } });
  }

  await tx.registration.deleteMany({ where: { courseOffering: { course: { code: { startsWith: scope.namespace } } } } });
  await tx.exam.deleteMany({ where: { courseOffering: { course: { code: { startsWith: scope.namespace } } } } });
  await tx.courseOffering.deleteMany({ where: { course: { code: { startsWith: scope.namespace } } } });
  await tx.course.deleteMany({ where: { code: { startsWith: scope.namespace } } });
  await tx.student.deleteMany({ where: { universityId: { startsWith: scope.studentUniversityPrefix } } });

  const demoCenterRows = await tx.center.findMany({
    where: { code: { startsWith: scope.centerCodePrefix } },
    select: { id: true },
  });
  const demoCenterIds = demoCenterRows.map((center) => center.id);

  if (demoCenterIds.length > 0) {
    await tx.proctor.deleteMany({ where: { centerId: { in: demoCenterIds } } });
    await tx.room.deleteMany({ where: { centerId: { in: demoCenterIds } } });
    await tx.center.deleteMany({ where: { id: { in: demoCenterIds } } });
  }

  await tx.user.deleteMany({ where: { OR: [{ email: { startsWith: scope.proctorEmailPrefix } }, { email: { startsWith: scope.studentEmailPrefix } }] } });
  await tx.program.deleteMany({ where: { code: { startsWith: scope.programCodePrefix } } });
  await tx.department.deleteMany({ where: { code: { startsWith: scope.departmentCodePrefix } } });
  await tx.semester.deleteMany({ where: { createdBy: scope.createdBy } });
  await tx.timeSlot.deleteMany({ where: { createdBy: scope.createdBy } });
};

const clearLegacyDemoDataWithTx = async (tx) => {
  const legacySchedules = await tx.schedule.findMany({
    where: {
      OR: [
        { createdBy: 'demo-data' },
        { assignments: { some: { exam: { courseOffering: { course: { code: { startsWith: DEMO_PREFIX } } } } } } },
      ],
    },
    select: { id: true },
  });

  if (legacySchedules.length > 0) {
    await tx.schedule.deleteMany({ where: { id: { in: legacySchedules.map((schedule) => schedule.id) } } });
  }

  await tx.registration.deleteMany({ where: { courseOffering: { course: { code: { startsWith: DEMO_PREFIX } } } } });
  await tx.exam.deleteMany({ where: { courseOffering: { course: { code: { startsWith: DEMO_PREFIX } } } } });
  await tx.courseOffering.deleteMany({ where: { course: { code: { startsWith: DEMO_PREFIX } } } });
  await tx.course.deleteMany({ where: { code: { startsWith: DEMO_PREFIX } } });
  await tx.student.deleteMany({ where: { universityId: { startsWith: DEMO_PREFIX } } });

  const legacyCenters = await tx.center.findMany({
    where: { code: { startsWith: DEMO_PREFIX } },
    select: { id: true },
  });
  const legacyCenterIds = legacyCenters.map((center) => center.id);

  if (legacyCenterIds.length > 0) {
    await tx.proctor.deleteMany({ where: { centerId: { in: legacyCenterIds } } });
    await tx.room.deleteMany({ where: { centerId: { in: legacyCenterIds } } });
    await tx.center.deleteMany({ where: { id: { in: legacyCenterIds } } });
  }

  await tx.user.deleteMany({
    where: {
      OR: [
        { email: { startsWith: 'demo.student' } },
        { email: { startsWith: 'demo.proctor' } },
      ],
    },
  });
  await tx.program.deleteMany({ where: { code: { startsWith: DEMO_PREFIX } } });
  await tx.department.deleteMany({ where: { code: { startsWith: DEMO_PREFIX } } });
  await tx.semester.deleteMany({ where: { createdBy: 'demo-data' } });
  await tx.timeSlot.deleteMany({ where: { createdBy: 'demo-data' } });
};

const createDepartments = async (tx, profile) => {
  const map = new Map();
  for (const department of buildDepartmentSpecs(profile)) {
    const row = await tx.department.create({
      data: { name: department.name, code: department.code },
    });
    map.set(department.code, row);
  }
  return map;
};

const createPrograms = async (tx, profile, departmentByCode) => {
  const map = new Map();
  for (const program of buildProgramSpecs(profile)) {
    const row = await tx.program.create({
      data: {
        name: program.name,
        code: program.code,
        departmentId: departmentByCode.get(program.departmentCode).id,
        description: `${profile.label} academic program for hybrid scheduling demos.`,
        isActive: true,
        createdBy: buildCreatedBy(profile.key),
      },
    });
    map.set(program.code, row);
  }
  return map;
};

const createSemester = async (tx, profile) => tx.semester.create({
  data: {
    name: profile.semesterName,
    startDate: toDate(profile.semesterStartDate, '00:00'),
    endDate: toDate(profile.semesterEndDate, '23:59'),
    isActive: true,
    isCurrent: profile.key === 'A',
    academicYear: profile.academicYear,
    status: profile.key === 'A' ? 'ACTIVE' : 'UPCOMING',
    createdBy: buildCreatedBy(profile.key),
  },
});

const createCourses = async (tx, profile, programByCode, semester, offeringPlans) => {
  const map = new Map();
  for (const plan of offeringPlans) {
    const row = await tx.course.create({
      data: {
        code: plan.code,
        title: plan.title,
        programId: programByCode.get(plan.programCode).id,
        semesterId: semester.id,
        credits: 3,
        description: `${profile.label} course seeded for feasible hybrid exam scheduling.`,
        isActive: true,
        createdBy: buildCreatedBy(profile.key),
      },
    });
    map.set(plan.code, row);
  }
  return map;
};

const createCourseOfferings = async (tx, profile, courseByCode, semester, offeringPlans) => {
  const map = new Map();
  for (const [index, plan] of offeringPlans.entries()) {
    const row = await tx.courseOffering.create({
      data: {
        courseId: courseByCode.get(plan.code).id,
        semesterId: semester.id,
        section: 'A',
        instructor: instructorNames[index % instructorNames.length],
        expectedStudents: plan.target,
        capacity: Math.max(plan.target + 12, 40),
        day: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'][index % 4],
        time: ['09:00', '11:00', '13:00', '15:00'][index % 4],
        roomLabel: 'Assigned by hybrid scheduler',
        notes: `${profile.label} feasible course offering for demo scheduling.`,
        priority: plan.priority,
        difficulty: plan.difficulty,
        status: 'ACTIVE',
        createdBy: buildCreatedBy(profile.key),
      },
    });
    map.set(plan.code, row);
  }
  return map;
};

const createCentersAndRooms = async (tx, profile) => {
  const centerByCode = new Map();
  const centerSpecs = buildCenterSpecs(profile);
  const roomPlans = buildRoomPlans(profile, centerSpecs);

  for (const [index, centerPlan] of centerSpecs.entries()) {
    const center = await tx.center.create({
      data: {
        name: centerPlan.name,
        code: centerPlan.code,
        location: centerPlan.location,
        description: `${profile.label} exam center for demo scheduling.`,
        isActive: true,
        supervisors: [`${profile.label} Supervisor ${index + 1}`, `Operations Lead ${index + 1}`],
        createdBy: buildCreatedBy(profile.key),
      },
    });
    centerByCode.set(centerPlan.code, center);
  }

  for (const roomPlan of roomPlans) {
    await tx.room.create({
      data: {
        centerId: centerByCode.get(roomPlan.centerCode).id,
        name: roomPlan.name,
        capacity: roomPlan.capacity,
        status: 'AVAILABLE',
        createdBy: buildCreatedBy(profile.key),
      },
    });
  }

  return centerByCode;
};

const createStudents = async (tx, profile, programByCode, passwordHash) => {
  const students = [];
  const programCodes = buildProgramSpecs(profile).map((program) => program.code);
  const studentsPerProgram = profile.studentCount / programCodes.length;

  for (let index = 0; index < profile.studentCount; index += 1) {
    const programCode = programCodes[Math.floor(index / studentsPerProgram)] ?? programCodes[programCodes.length - 1];
    const user = await upsertUser(tx, {
      name: fullName(index),
      email: buildStudentEmail(profile.key, index),
      role: 'STUDENT',
      passwordHash,
    });
    const student = await tx.student.create({
      data: {
        userId: user.id,
        universityId: buildStudentUniversityId(profile.namespace, index),
        programId: programByCode.get(programCode).id,
        createdBy: buildCreatedBy(profile.key),
      },
    });
    students.push({ ...student, programCode });
  }

  return students;
};

const createTimeSlots = async (tx, profile) => {
  const data = buildTimeSlotSpecs(profile).map(([date, start, end]) => {
    const startTime = toDate(date, start);
    const endTime = toDate(date, end);
    return {
      startTime,
      endTime,
      date: toDate(date, '00:00'),
      duration: Math.round((endTime.getTime() - startTime.getTime()) / 60000),
      createdBy: buildCreatedBy(profile.key),
    };
  });

  await tx.timeSlot.createMany({ data, skipDuplicates: true });
  return tx.timeSlot.findMany({ where: { createdBy: buildCreatedBy(profile.key) }, orderBy: [{ startTime: 'asc' }, { endTime: 'asc' }] });
};

const createProctors = async (tx, profile, centerByCode, passwordHash, timeSlots) => {
  const centerCodes = [...centerByCode.keys()];

  for (let index = 0; index < profile.proctorCount; index += 1) {
    const centerCode = centerCodes[index % centerCodes.length];
    const user = await upsertUser(tx, {
      name: `Proctor ${fullName(index)}`,
      email: buildProctorEmail(profile.key, index),
      role: 'PROCTOR',
      passwordHash,
    });
    const proctor = await tx.proctor.create({
      data: {
        userId: user.id,
        centerId: centerByCode.get(centerCode).id,
        department: index % 2 === 0 ? 'Exam Operations' : 'Academic Quality Office',
        maxExamsPerDay: index % 4 === 0 ? 2 : index % 3 === 0 ? 3 : 4,
        createdBy: buildCreatedBy(profile.key),
        updatedBy: buildCreatedBy(profile.key),
      },
    });

    await tx.proctorAvailability.createMany({
      data: timeSlots.map((slot) => ({ proctorId: proctor.id, timeSlotId: slot.id })),
      skipDuplicates: true,
    });
  }
};

const createExams = async (tx, profile, offeringByCode, offeringPlans) => {
  for (const plan of offeringPlans) {
    await tx.exam.create({
      data: {
        courseOfferingId: offeringByCode.get(plan.code).id,
        status: 'DRAFT',
        duration: plan.duration,
        createdBy: buildCreatedBy(profile.key),
      },
    });
  }
};

const createRegistrations = async (tx, students, offeringByCode, offeringPlans) => {
  const data = [];

  for (const [index, plan] of offeringPlans.entries()) {
    const offering = offeringByCode.get(plan.code);
    const selected = selectStudents(students, plan.cohorts, plan.target, index * 11);
    for (const student of selected) {
      data.push({ studentId: student.id, courseOfferingId: offering.id, status: 'ACTIVE' });
    }
  }

  const batchSize = 500;
  for (let index = 0; index < data.length; index += batchSize) {
    await tx.registration.createMany({ data: data.slice(index, index + batchSize), skipDuplicates: true });
  }

  return data.length;
};

const getExpectedTestCases = (profile) => ({
  dataset: `${profile.label} - ${profile.description}`,
  expectedResult: 'Hybrid schedule generation should complete cleanly with all hard constraints satisfied.',
  offerings: `${profile.offeringCount} active course offerings seeded for ${profile.semesterName}.`,
  rooms: `${profile.roomCount} available rooms distributed across ${profile.centerCount} centers with large-capacity halls for high-demand exams.`,
  proctors: `${profile.proctorCount} proctors are available across the full time-slot grid to keep the dataset feasible.`,
  timeSlots: `${profile.slotDays * slotSessions.length} valid 180-minute time slots are available inside the semester exam window.`,
});

export const generateDemoData = async (options = {}) => {
  const profile = getProfile(options.dataset ?? options.mode);
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const offeringPlans = buildOfferingPlans(profile);
  let registrationCount = 0;

  await prisma.$transaction(async (tx) => {
    await clearDemoDatasetWithTx(tx, profile.key);
    const departmentByCode = await createDepartments(tx, profile);
    const programByCode = await createPrograms(tx, profile, departmentByCode);
    const semester = await createSemester(tx, profile);
    const courseByCode = await createCourses(tx, profile, programByCode, semester, offeringPlans);
    const offeringByCode = await createCourseOfferings(tx, profile, courseByCode, semester, offeringPlans);
    const centerByCode = await createCentersAndRooms(tx, profile);
    const students = await createStudents(tx, profile, programByCode, passwordHash);
    const timeSlots = await createTimeSlots(tx, profile);
    await createProctors(tx, profile, centerByCode, passwordHash, timeSlots);
    await createExams(tx, profile, offeringByCode, offeringPlans);
    registrationCount = await createRegistrations(tx, students, offeringByCode, offeringPlans);
  }, { timeout: 120000 });

  return {
    message: `${profile.label} generated successfully without clearing other demo datasets.`,
    dataset: profile.key,
    datasetLabel: profile.label,
    loginHint: 'Demo users use password Demo12345!',
    summary: await countDemoData(profile.key),
    overallSummary: await countDemoData(),
    instruction: `Select ${profile.semesterName} in the scheduler and run the Hybrid Constraint-Based Scheduling Algorithm to produce a clean schedule.`,
    expectedTestCases: getExpectedTestCases(profile),
    generatedRegistrations: registrationCount,
  };
};

export const clearDemoData = async (options = {}) => {
  const datasetKey = options.dataset ? normalizeDatasetKey(options.dataset) : null;
  await prisma.$transaction(async (tx) => {
    if (datasetKey) {
      await clearDemoDatasetWithTx(tx, datasetKey);
    } else {
      for (const currentDatasetKey of DEMO_DATASET_KEYS) {
        await clearDemoDatasetWithTx(tx, currentDatasetKey);
      }
      await clearLegacyDemoDataWithTx(tx);
    }
  }, { timeout: 120000 });

  const profile = datasetKey ? getProfile(datasetKey) : null;
  return {
    message: datasetKey
      ? `${profile.label} cleared successfully.`
      : 'Demo datasets cleared successfully.',
    dataset: datasetKey ?? undefined,
    datasetLabel: profile?.label,
    summary: await countDemoData(datasetKey ?? undefined),
    overallSummary: await countDemoData(),
  };
};
