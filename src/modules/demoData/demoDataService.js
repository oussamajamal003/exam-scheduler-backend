import bcrypt from 'bcrypt';
import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

const DEMO_PREFIX = 'DEMO-';
const DEMO_PASSWORD = 'Demo12345!';
const DEMO_DATASET_KEYS = ['A', 'B', 'C', 'REAL'];

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
  REAL: {
    key: 'REAL',
    namespace: 'DEMO-REAL',
    label: 'FEIT Real Dataset',
    description: 'Real FEIT Spring 2026 course offerings (35 offerings, 29 exams)',
    semesterName: 'FEIT Spring 2026',
    semesterStartDate: '2026-06-08',
    semesterEndDate: '2026-06-22',
    academicYear: '2025-2026',
    studentCount: 220,
    proctorCount: 30,
    centerCount: 4,
    roomCount: 12,
    slotDays: 12,
    realData: true,
  },
};

// Real FEIT Spring 2026 course offerings.
// programCode owns the course; cohorts list every program whose students enroll.
// hasExam=false marks PROJECT / LAB-only offerings that must NOT create Exam entities.
const REAL_PROGRAM_CODES = ['BME', 'CCE', 'CS', 'EE'];
const realDepartmentTemplates = [
  { name: 'Biomedical Engineering', code: 'BME' },
  { name: 'Computer & Communications Engineering', code: 'CCE' },
  { name: 'Computer Science', code: 'CSE' },
  { name: 'Electrical Engineering', code: 'ELE' },
  { name: 'General Sciences', code: 'GEN' },
];
const realProgramTemplates = [
  { name: 'Biomedical Engineering', code: 'BME', departmentCode: 'BME' },
  { name: 'Computer & Communications Engineering', code: 'CCE', departmentCode: 'CCE' },
  { name: 'Computer Science', code: 'CS', departmentCode: 'CSE' },
  { name: 'Electrical Engineering', code: 'EE', departmentCode: 'ELE' },
];
const realCenterTemplates = [
  { code: 'FEIT-A', name: 'FEIT Engineering Hall A', location: 'FEIT Main Campus - Block A' },
  { code: 'FEIT-B', name: 'FEIT Sciences Building B', location: 'FEIT Main Campus - Block B' },
  { code: 'FEIT-C', name: 'FEIT Computing Center C', location: 'FEIT Main Campus - Block C' },
  { code: 'FEIT-D', name: 'FEIT Examination Hall D', location: 'FEIT Main Campus - Examination Wing' },
];
const realRoomTemplates = [
  { centerCode: 'FEIT-A', name: 'Hall A101', capacity: 120 },
  { centerCode: 'FEIT-A', name: 'Hall A102', capacity: 90 },
  { centerCode: 'FEIT-A', name: 'Room A203', capacity: 60 },
  { centerCode: 'FEIT-B', name: 'Hall B105', capacity: 100 },
  { centerCode: 'FEIT-B', name: 'Hall B106', capacity: 80 },
  { centerCode: 'FEIT-B', name: 'Room B210', capacity: 50 },
  { centerCode: 'FEIT-C', name: 'Computing Lab C101', capacity: 45 },
  { centerCode: 'FEIT-C', name: 'Computing Lab C102', capacity: 45 },
  { centerCode: 'FEIT-C', name: 'Auditorium C200', capacity: 140 },
  { centerCode: 'FEIT-D', name: 'Exam Hall D101', capacity: 110 },
  { centerCode: 'FEIT-D', name: 'Exam Hall D102', capacity: 90 },
  { centerCode: 'FEIT-D', name: 'Exam Hall D201', capacity: 70 },
];
const realOfferings = [
  { baseCode: 'AUT202L', section: 'A', title: 'Automation Lab', credits: 2, instructor: 'Ibrahim Mallat', day: 'TH', time: '13:00-16:00', type: 'LAB', hasExam: false, programCode: 'EE', cohorts: ['EE', 'CCE'], target: 18, duration: 180 },
  { baseCode: 'BME332', section: 'A', title: 'Transport Phenomena in BME', credits: 3, instructor: 'Firas Zakaria', day: 'MW', time: '13:00-14:30', type: 'COURSE', hasExam: true, programCode: 'BME', cohorts: ['BME'], target: 22, duration: 120 },
  { baseCode: 'BME371', section: 'A', title: 'Data Evaluation Principles', credits: 3, instructor: 'Mashhour Chakouch', day: 'TTH', time: '08:30-10:00', type: 'COURSE', hasExam: true, programCode: 'BME', cohorts: ['BME'], target: 24, duration: 120 },
  { baseCode: 'BME424', section: 'A', title: 'Image and Signal Processing', credits: 3, instructor: 'Mohamad Khalil', day: 'MW', time: '13:00-14:30', type: 'COURSE', hasExam: true, programCode: 'BME', cohorts: ['BME'], target: 18, duration: 120 },
  { baseCode: 'CHEM221', section: 'A', title: 'General Chemistry', credits: 3, instructor: 'Monzer Awad', day: 'MW', time: '08:30-10:00', type: 'COURSE', hasExam: true, programCode: 'BME', cohorts: ['BME', 'CCE', 'CS', 'EE'], target: 60, duration: 120 },
  { baseCode: 'CNE340', section: 'A', title: 'Signals and Systems', credits: 3, instructor: 'Hiba Sheikh', day: 'MW', time: '08:30-10:00', type: 'COURSE', hasExam: true, programCode: 'CCE', cohorts: ['CCE', 'EE'], target: 25, duration: 120 },
  { baseCode: 'CNE460', section: 'A', title: 'Optoelectronics', credits: 3, instructor: 'Ali Harmouch', day: 'TTH', time: '08:30-10:00', type: 'COURSE', hasExam: true, programCode: 'CCE', cohorts: ['CCE'], target: 18, duration: 120 },
  { baseCode: 'COMP201', section: 'A', title: 'Computer Applications', credits: 3, instructor: 'Ranim Sayed', day: 'MW', time: '13:00-14:30', type: 'COURSE', hasExam: true, programCode: 'CS', cohorts: ['BME', 'CCE', 'CS', 'EE'], target: 40, duration: 120 },
  { baseCode: 'COMP201', section: 'B', title: 'Computer Applications', credits: 3, instructor: 'Ranim Sayed', day: 'MW', time: '11:30-13:00', type: 'COURSE', hasExam: true, programCode: 'CS', cohorts: ['BME', 'CCE', 'CS', 'EE'], target: 40, duration: 120 },
  { baseCode: 'CSC203', section: 'A', title: 'Introduction to Programming', credits: 3, instructor: 'Ihab Hassoun', day: 'MW', time: '14:30-16:00', type: 'COURSE', hasExam: true, programCode: 'CS', cohorts: ['CS', 'CCE', 'BME'], target: 65, duration: 120 },
  { baseCode: 'CSC280', section: 'A', title: 'Web Development I', credits: 3, instructor: 'Ahmad Trad', day: 'MW', time: '08:30-10:00', type: 'COURSE', hasExam: true, programCode: 'CS', cohorts: ['CS', 'CCE'], target: 35, duration: 120 },
  { baseCode: 'CSC311', section: 'A', title: 'Operating Systems', credits: 3, instructor: 'Mohamad Saade', day: 'MW', time: '14:30-16:00', type: 'COURSE', hasExam: true, programCode: 'CS', cohorts: ['CS', 'CCE'], target: 30, duration: 120 },
  { baseCode: 'CSC426', section: 'A', title: 'Software Engineering I', credits: 3, instructor: 'Mohamad Saade', day: 'MW', time: '13:00-14:30', type: 'COURSE', hasExam: true, programCode: 'CS', cohorts: ['CS'], target: 28, duration: 120 },
  { baseCode: 'CSC441', section: 'A', title: 'Algorithm Analysis', credits: 3, instructor: 'Ahmad Trad', day: 'MW', time: '11:30-13:00', type: 'COURSE', hasExam: true, programCode: 'CS', cohorts: ['CS'], target: 26, duration: 120 },
  { baseCode: 'ELEC221', section: 'A', title: 'Analog Circuits I', credits: 3, instructor: 'Hiba Sheikh', day: 'MW', time: '10:00-11:30', type: 'COURSE', hasExam: true, programCode: 'EE', cohorts: ['EE', 'CCE', 'BME'], target: 35, duration: 120 },
  { baseCode: 'ELEC223', section: 'A', title: 'Digital Fundamentals', credits: 3, instructor: 'Ihab Hassoun', day: 'MW', time: '11:30-13:00', type: 'COURSE', hasExam: true, programCode: 'EE', cohorts: ['EE', 'CCE', 'CS'], target: 35, duration: 120 },
  { baseCode: 'ELEC370', section: 'A', title: 'Electric Power and Machines', credits: 3, instructor: 'Nazih Moubayed', day: 'Fri', time: '14:00-17:00', type: 'COURSE', hasExam: true, programCode: 'EE', cohorts: ['EE'], target: 24, duration: 150 },
  { baseCode: 'ELEC440L', section: 'A', title: 'Microcontrollers Lab', credits: 3, instructor: 'Ihab Hassoun', day: 'Fri', time: '08:30-11:30', type: 'LAB', hasExam: false, programCode: 'EE', cohorts: ['EE', 'CCE'], target: 22, duration: 180 },
  { baseCode: 'ENGR211', section: 'A', title: 'Engineering Graphics', credits: 3, instructor: 'Radwan Baroudi', day: 'TTH', time: '08:30-10:00', type: 'COURSE', hasExam: true, programCode: 'EE', cohorts: ['BME', 'CCE', 'CS', 'EE'], target: 60, duration: 120 },
  { baseCode: 'ENGR274', section: 'A', title: 'Engineering Systems Modeling and Simulation', credits: 3, instructor: 'Firas Zakaria', day: 'MW', time: '11:30-13:00', type: 'COURSE', hasExam: true, programCode: 'EE', cohorts: ['EE', 'CCE', 'BME'], target: 40, duration: 120 },
  { baseCode: 'ENGR444', section: 'A', title: 'Artificial Intelligence', credits: 3, instructor: 'Mohamad Khalil', day: 'MW', time: '14:30-16:00', type: 'COURSE', hasExam: true, programCode: 'CS', cohorts: ['CS', 'CCE', 'BME', 'EE'], target: 30, duration: 120 },
  { baseCode: 'ENGR498', section: 'A', title: 'Engineering Seminar', credits: 3, instructor: 'Ahmad Trad', day: 'TBA', time: 'TBA', type: 'PROJECT', hasExam: false, programCode: 'EE', cohorts: ['BME', 'CCE', 'CS', 'EE'], target: 25, duration: 0 },
  { baseCode: 'FYP594', section: 'A', title: 'Final Year Project Methodology', credits: 1, instructor: 'Firas Zakaria', day: 'T', time: '13:00-14:30', type: 'PROJECT', hasExam: false, programCode: 'EE', cohorts: ['BME', 'CCE', 'CS', 'EE'], target: 28, duration: 0 },
  { baseCode: 'FYP595', section: 'A', title: 'Final Year Project I', credits: 1, instructor: 'Hiba Sheikh', day: 'TBA', time: 'TBA', type: 'PROJECT', hasExam: false, programCode: 'EE', cohorts: ['BME', 'CCE', 'CS', 'EE'], target: 22, duration: 0 },
  { baseCode: 'FYP596', section: 'A', title: 'Final Year Project II', credits: 5, instructor: 'Hiba Sheikh', day: 'TBA', time: 'TBA', type: 'PROJECT', hasExam: false, programCode: 'EE', cohorts: ['BME', 'CCE', 'CS', 'EE'], target: 18, duration: 0 },
  { baseCode: 'IT311', section: 'A', title: 'Network Essentials', credits: 3, instructor: 'Bassel Haj', day: 'TTH', time: '14:30-16:00', type: 'COURSE', hasExam: true, programCode: 'CS', cohorts: ['CS', 'CCE'], target: 30, duration: 120 },
  { baseCode: 'IT381', section: 'A', title: 'Object Oriented Programming', credits: 3, instructor: 'Ahmad Trad', day: 'MW', time: '10:00-11:30', type: 'COURSE', hasExam: true, programCode: 'CS', cohorts: ['CS', 'CCE'], target: 35, duration: 120 },
  { baseCode: 'MATH104', section: 'A', title: 'Freshman Calculus I', credits: 3, instructor: 'Mohamad Moussa', day: 'MW', time: '11:30-13:00', type: 'COURSE', hasExam: true, programCode: 'CS', cohorts: ['BME', 'CCE', 'CS', 'EE'], target: 80, duration: 120 },
  { baseCode: 'MATH105', section: 'A', title: 'Freshman Calculus II', credits: 3, instructor: 'Salam Kouzayha', day: 'TTH', time: '14:30-16:00', type: 'COURSE', hasExam: true, programCode: 'CS', cohorts: ['BME', 'CCE', 'CS', 'EE'], target: 75, duration: 120 },
  { baseCode: 'MATH202', section: 'A', title: 'Calculus III', credits: 3, instructor: 'Omar Kalaoun', day: 'TTH', time: '14:30-16:00', type: 'COURSE', hasExam: true, programCode: 'CS', cohorts: ['BME', 'CCE', 'CS', 'EE'], target: 50, duration: 120 },
  { baseCode: 'MATH332', section: 'A', title: 'Linear Algebra', credits: 3, instructor: 'Majdi Awad', day: 'TTH', time: '08:30-10:00', type: 'COURSE', hasExam: true, programCode: 'CS', cohorts: ['BME', 'CCE', 'CS', 'EE'], target: 40, duration: 120 },
  { baseCode: 'MATH332', section: 'B', title: 'Linear Algebra', credits: 3, instructor: 'Salam Kouzayha', day: 'TTH', time: '13:00-14:30', type: 'COURSE', hasExam: true, programCode: 'CS', cohorts: ['BME', 'CCE', 'CS', 'EE'], target: 40, duration: 120 },
  { baseCode: 'MATH342', section: 'A', title: 'Ordinary Differential Equations', credits: 3, instructor: 'Omar Kalaoun', day: 'Fri', time: '08:30-11:30', type: 'COURSE', hasExam: true, programCode: 'CS', cohorts: ['BME', 'CCE', 'CS', 'EE'], target: 35, duration: 150 },
  { baseCode: 'PHY104', section: 'A', title: 'Freshman Mechanics', credits: 3, instructor: 'Fady Taychouri', day: 'MW', time: '13:00-14:30', type: 'COURSE', hasExam: true, programCode: 'EE', cohorts: ['BME', 'CCE', 'CS', 'EE'], target: 80, duration: 120 },
  { baseCode: 'PHY105', section: 'A', title: 'Freshman Electricity and Magnetism', credits: 3, instructor: 'Ahmad Osman', day: 'TTH', time: '13:00-14:30', type: 'COURSE', hasExam: true, programCode: 'EE', cohorts: ['BME', 'CCE', 'CS', 'EE'], target: 75, duration: 120 },
  { baseCode: 'PHY205', section: 'A', title: 'Electricity and Magnetism', credits: 3, instructor: 'Ali Harmouch', day: 'TTH', time: '10:00-11:30', type: 'COURSE', hasExam: true, programCode: 'EE', cohorts: ['BME', 'CCE', 'EE'], target: 45, duration: 120 },
];

const firstNames = ['Layla', 'Omar', 'Sara', 'Adam', 'Nour', 'Yara', 'Karim', 'Maya', 'Ziad', 'Rana', 'Tala', 'Fadi', 'Hala', 'Samir', 'Dina', 'Nadia', 'Bilal', 'Lina', 'Rami', 'Mona', 'Jad', 'Salma', 'Elias', 'Farah', 'Amir', 'Celine', 'Malek', 'Reem', 'Kareem', 'Aya'];
const lastNames = ['Ahmed', 'Hassan', 'Khalil', 'Nasser', 'Mansour', 'Saleh', 'Fouad', 'Issa', 'Rahman', 'Darwish', 'Youssef', 'Karam', 'Othman', 'Nasr', 'Farah', 'Haddad', 'Sami', 'Omar', 'Zein', 'Amin', 'Habib', 'Tarek', 'Nour', 'Kamal', 'Zaki', 'Riad', 'Hani', 'Adel', 'Mourad', 'Basel'];
const instructorNames = ['Dr. Nora Saleh', 'Dr. Adam Farouk', 'Dr. Lina Haddad', 'Dr. Omar Nasser', 'Dr. Maya Khalil', 'Prof. Karim Mansour', 'Prof. Hala Youssef', 'Prof. Sami Darwish', 'Dr. Rana Issa', 'Dr. Ziad Rahman', 'Dr. Leila Omari', 'Dr. Fadi Hassan'];

const toDate = (date, time) => new Date(`${date}T${time}:00.000Z`);
const fullName = (index) => `${firstNames[index % firstNames.length]} ${lastNames[Math.floor(index / firstNames.length) % lastNames.length]}`;
const buildCreatedBy = (datasetKey) => `demo-data:${datasetKey}`;
const buildStudentEmail = (datasetKey, index) => `demo.${datasetKey.toLowerCase()}.student${String(index + 1).padStart(4, '0')}@st.uni.edu`;
const buildProctorEmail = (datasetKey, index) => `demo.${datasetKey.toLowerCase()}.proctor${String(index + 1).padStart(3, '0')}@uni.edu`;
const buildStudentUniversityId = (namespace, index) => `${namespace}-STU-${String(index + 1).padStart(4, '0')}`;
const buildDatasetScopedLabel = (value, profile) => `${value} (${profile.label})`;
const allDemoSemesterNames = Object.values(datasetProfiles).map((profile) => profile.semesterName);

const buildDatasetSemesterWhere = (profile) => ({
  OR: [
    { createdBy: buildCreatedBy(profile.key) },
    { name: profile.semesterName },
  ],
});

const chooseCanonicalDatasetSemester = (current, candidate) => {
  if (!current) return candidate;

  const currentOfferings = current._count?.courseOfferings ?? 0;
  const candidateOfferings = candidate._count?.courseOfferings ?? 0;
  if (candidateOfferings !== currentOfferings) return candidateOfferings > currentOfferings ? candidate : current;

  const currentCourses = current._count?.courses ?? 0;
  const candidateCourses = candidate._count?.courses ?? 0;
  if (candidateCourses !== currentCourses) return candidateCourses > currentCourses ? candidate : current;

  const currentCreatedAt = current.createdAt instanceof Date ? current.createdAt.getTime() : 0;
  const candidateCreatedAt = candidate.createdAt instanceof Date ? candidate.createdAt.getTime() : 0;
  return candidateCreatedAt < currentCreatedAt ? candidate : current;
};

const normalizeDatasetSemesterRowsWithTx = async (tx, profile) => {
  const createdBy = buildCreatedBy(profile.key);
  const semesters = await tx.semester.findMany({
    where: buildDatasetSemesterWhere(profile),
    include: {
      _count: {
        select: {
          courseOfferings: true,
          courses: true,
        },
      },
    },
    orderBy: [{ createdAt: 'asc' }],
  });

  if (semesters.length === 0) return null;

  const canonical = semesters.reduce(chooseCanonicalDatasetSemester, null);
  const duplicateIds = semesters
    .filter((semester) => semester.id !== canonical.id)
    .filter((semester) => (semester._count?.courseOfferings ?? 0) === 0 && (semester._count?.courses ?? 0) === 0)
    .map((semester) => semester.id);

  if (duplicateIds.length > 0) {
    await tx.semester.deleteMany({ where: { id: { in: duplicateIds } } });
  }

  return tx.semester.update({
    where: { id: canonical.id },
    data: {
      name: profile.semesterName,
      startDate: toDate(profile.semesterStartDate, '00:00'),
      endDate: toDate(profile.semesterEndDate, '23:59'),
      academicYear: profile.academicYear,
      createdBy,
    },
  });
};

const normalizeDatasetSemesterRows = async (profile) => prisma.$transaction(
  async (tx) => normalizeDatasetSemesterRowsWithTx(tx, profile),
  { timeout: 120000 },
);

const normalizeDatasetKey = (input) => {
  if (typeof input === 'string' && datasetProfiles[input]) return input;
  if (typeof input === 'string' && datasetProfiles[input?.toUpperCase?.()]) return input.toUpperCase();
  if (input === 'clean' || input === 'feasible' || input === 'balanced') return 'A';
  if (input === 'expanded' || input === 'large') return 'B';
  if (input === 'enterprise' || input === 'xl') return 'C';
  if (input === 'real' || input === 'feit' || input === 'university') return 'REAL';
  return 'A';
};

const getProfile = (datasetKey) => datasetProfiles[normalizeDatasetKey(datasetKey)];

export const getDemoDatasetKeyForSemester = (semester) => {
  if (!semester) return null;

  if (typeof semester.createdBy === 'string' && semester.createdBy.startsWith('demo-data:')) {
    const datasetKey = semester.createdBy.slice('demo-data:'.length).toUpperCase();
    return datasetProfiles[datasetKey] ? datasetKey : null;
  }

  const matchedProfile = Object.values(datasetProfiles).find((profile) => profile.semesterName === semester.name);
  return matchedProfile?.key ?? null;
};

const buildDepartmentSpecs = (profile) => {
  const templates = profile.realData ? realDepartmentTemplates : departmentTemplates;
  return templates.map((item) => ({
    code: `${profile.namespace}-DEPT-${item.code}`,
    name: profile.realData ? item.name : `${item.name} (${profile.label})`,
  }));
};

const buildProgramSpecs = (profile) => {
  const templates = profile.realData ? realProgramTemplates : programTemplates;
  return templates.map((item) => ({
    code: `${profile.namespace}-PROG-${item.code}`,
    name: profile.realData ? item.name : `${item.name} (${profile.label})`,
    departmentCode: `${profile.namespace}-DEPT-${item.departmentCode}`,
  }));
};

const buildRealOfferingPlans = (profile) => realOfferings.map((offering) => ({
  baseCode: offering.baseCode,
  section: offering.section,
  code: `${profile.namespace}-${offering.baseCode}-${offering.section}`,
  courseKey: `${profile.namespace}-${offering.baseCode}`,
  title: offering.title,
  programCode: `${profile.namespace}-PROG-${offering.programCode}`,
  cohorts: offering.cohorts.map((code) => `${profile.namespace}-PROG-${code}`),
  target: offering.target,
  duration: offering.duration,
  credits: offering.credits,
  instructor: offering.instructor,
  day: offering.day,
  time: offering.time,
  type: offering.type,
  hasExam: offering.hasExam,
  priority: offering.hasExam ? 70 : 30,
  difficulty: offering.hasExam ? 6 : 3,
  notes: `${profile.label} - ${offering.type} - ${offering.day} ${offering.time}`,
}));

const buildOfferingPlans = (profile) => {
  if (profile.realData) return buildRealOfferingPlans(profile);
  return Array.from({ length: profile.offeringCount }, (_, index) => {
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
};

const buildCenterSpecs = (profile) => {
  if (profile.realData) {
    return realCenterTemplates.map((center) => ({
      code: `${profile.namespace}-CENTER-${center.code}`,
      name: center.name,
      location: center.location,
    }));
  }
  return Array.from({ length: profile.centerCount }, (_, index) => ({
    code: `${profile.namespace}-CENTER-${String(index + 1).padStart(2, '0')}`,
    name: centerNamePool[index],
    location: `Campus ${index + 1} - ${profile.label}`,
  }));
};

const buildRoomPlans = (profile, centers) => {
  if (profile.realData) {
    return realRoomTemplates.map((room) => ({
      centerCode: `${profile.namespace}-CENTER-${room.centerCode}`,
      name: room.name,
      capacity: room.capacity,
    }));
  }
  const roomPlans = [];
  const roomsPerCenter = Math.floor(profile.roomCount / centers.length);
  const extraRooms = profile.roomCount % centers.length;
  let roomIndex = 0;

  for (const [centerIndex, center] of centers.entries()) {
    const countForCenter = roomsPerCenter + (centerIndex < extraRooms ? 1 : 0);
    for (let localIndex = 0; localIndex < countForCenter; localIndex += 1) {
      roomPlans.push({
        centerCode: center.code,
        name: `${roomNamePool[roomIndex % roomNamePool.length]} ${String(roomIndex + 1).padStart(2, '0')}`,
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
    prisma.semester.count({ where: scope ? buildDatasetSemesterWhere(scope.profile) : { OR: [{ createdBy: { startsWith: 'demo-data:' } }, { name: { in: allDemoSemesterNames } }] } }),
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

const deleteScopedAssignmentsWithTx = async (tx, { scheduleWhere, examWhere, roomWhere, proctorWhere, timeSlotWhere }) => {
  const [scheduleRows, examRows, roomRows, proctorRows, timeSlotRows] = await Promise.all([
    tx.schedule.findMany({ where: scheduleWhere, select: { id: true } }),
    tx.exam.findMany({ where: examWhere, select: { id: true } }),
    tx.room.findMany({ where: roomWhere, select: { id: true } }),
    tx.proctor.findMany({ where: proctorWhere, select: { id: true } }),
    tx.timeSlot.findMany({ where: timeSlotWhere, select: { id: true } }),
  ]);

  const scheduleIds = scheduleRows.map((row) => row.id);
  const examIds = examRows.map((row) => row.id);
  const roomIds = roomRows.map((row) => row.id);
  const proctorIds = proctorRows.map((row) => row.id);
  const timeSlotIds = timeSlotRows.map((row) => row.id);

  const assignmentScope = [
    scheduleIds.length > 0 ? { scheduleId: { in: scheduleIds } } : null,
    examIds.length > 0 ? { examId: { in: examIds } } : null,
    roomIds.length > 0 ? { roomId: { in: roomIds } } : null,
    proctorIds.length > 0 ? { proctorId: { in: proctorIds } } : null,
    timeSlotIds.length > 0 ? { timeSlotId: { in: timeSlotIds } } : null,
  ].filter(Boolean);

  let assignmentScheduleIds = [];

  if (assignmentScope.length > 0) {
    const assignmentRows = await tx.examAssignment.findMany({
      where: { OR: assignmentScope },
      select: { scheduleId: true },
    });
    assignmentScheduleIds = assignmentRows.map((row) => row.scheduleId);
    await tx.examAssignment.deleteMany({ where: { OR: assignmentScope } });
  }

  const scheduleIdsToDelete = [...new Set([...scheduleIds, ...assignmentScheduleIds])];

  if (scheduleIdsToDelete.length > 0) {
    await tx.schedule.deleteMany({ where: { id: { in: scheduleIdsToDelete } } });
  }

  return { roomIds };
};

const clearDemoDatasetWithTx = async (tx, datasetKey) => {
  const scope = buildDatasetScope(datasetKey);

  await deleteScopedAssignmentsWithTx(tx, {
    scheduleWhere: { createdBy: scope.createdBy },
    examWhere: { courseOffering: { course: { code: { startsWith: scope.namespace } } } },
    roomWhere: { center: { code: { startsWith: scope.centerCodePrefix } } },
    proctorWhere: { user: { email: { startsWith: scope.proctorEmailPrefix } } },
    timeSlotWhere: { createdBy: scope.createdBy },
  });

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

  await tx.proctor.deleteMany({ where: { user: { email: { startsWith: scope.proctorEmailPrefix } } } });

  if (demoCenterIds.length > 0) {
    await tx.room.deleteMany({ where: { centerId: { in: demoCenterIds } } });
    await tx.center.deleteMany({ where: { id: { in: demoCenterIds } } });
  }

  await tx.user.deleteMany({ where: { OR: [{ email: { startsWith: scope.proctorEmailPrefix } }, { email: { startsWith: scope.studentEmailPrefix } }] } });
  await tx.program.deleteMany({ where: { code: { startsWith: scope.programCodePrefix } } });
  await tx.department.deleteMany({ where: { code: { startsWith: scope.departmentCodePrefix } } });
  await tx.semester.deleteMany({ where: buildDatasetSemesterWhere(scope.profile) });
  await tx.timeSlot.deleteMany({ where: { createdBy: scope.createdBy } });
};

export const clearDemoDatasetByKeyWithTx = clearDemoDatasetWithTx;

const clearLegacyDemoDataWithTx = async (tx) => {
  await deleteScopedAssignmentsWithTx(tx, {
    scheduleWhere: { createdBy: 'demo-data' },
    examWhere: { courseOffering: { course: { code: { startsWith: DEMO_PREFIX } } } },
    roomWhere: { center: { code: { startsWith: DEMO_PREFIX } } },
    proctorWhere: { user: { email: { startsWith: 'demo.proctor' } } },
    timeSlotWhere: { createdBy: 'demo-data' },
  });

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

  await tx.proctor.deleteMany({ where: { user: { email: { startsWith: 'demo.proctor' } } } });

  if (legacyCenterIds.length > 0) {
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

const createSemester = async (tx, profile) => {
  const existing = await normalizeDatasetSemesterRowsWithTx(tx, profile);
  if (existing) return existing;

  return tx.semester.create({
    data: {
      name: profile.semesterName,
      startDate: toDate(profile.semesterStartDate, '00:00'),
      endDate: toDate(profile.semesterEndDate, '23:59'),
      academicYear: profile.academicYear,
      createdBy: buildCreatedBy(profile.key),
    },
  });
};

const createCourses = async (tx, profile, programByCode, semester, offeringPlans) => {
  const map = new Map();
  for (const plan of offeringPlans) {
    const courseKey = plan.courseKey ?? plan.code;
    if (map.has(courseKey)) continue;
    const row = await tx.course.create({
      data: {
        code: courseKey,
        title: buildDatasetScopedLabel(plan.title, profile),
        programId: programByCode.get(plan.programCode).id,
        semesterId: semester.id,
        credits: plan.credits ?? 3,
        description: profile.realData
          ? `${plan.title} (${plan.baseCode ?? courseKey}) - real FEIT offering.`
          : `${profile.label} course seeded for feasible hybrid exam scheduling.`,
        isActive: true,
        createdBy: buildCreatedBy(profile.key),
      },
    });
    map.set(courseKey, row);
  }
  return map;
};

const createCourseOfferings = async (tx, profile, courseByCode, semester, offeringPlans) => {
  const map = new Map();
  for (const [index, plan] of offeringPlans.entries()) {
    const courseKey = plan.courseKey ?? plan.code;
    const row = await tx.courseOffering.create({
      data: {
        courseId: courseByCode.get(courseKey).id,
        semesterId: semester.id,
        section: plan.section ?? 'A',
        instructor: plan.instructor ?? instructorNames[index % instructorNames.length],
        expectedStudents: plan.target,
        capacity: Math.max(plan.target + 12, 40),
        day: plan.day ?? ['Monday', 'Tuesday', 'Wednesday', 'Thursday'][index % 4],
        time: plan.time ?? ['09:00', '11:00', '13:00', '15:00'][index % 4],
        roomLabel: 'Assigned by hybrid scheduler',
        notes: plan.notes ?? `${profile.label} feasible course offering for demo scheduling.`,
        priority: plan.priority,
        difficulty: plan.difficulty,
        courseType: plan.hasExam === false ? 'PROJECT' : 'COURSE',
        hasExam: plan.hasExam !== false,
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
        name: buildDatasetScopedLabel(centerPlan.name, profile),
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
        name: buildDatasetScopedLabel(roomPlan.name, profile),
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
  const studentsPerProgram = Math.max(1, profile.studentCount / programCodes.length);

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
  for (let index = 0; index < profile.proctorCount; index += 1) {
    const user = await upsertUser(tx, {
      name: `Proctor ${fullName(index)}`,
      email: buildProctorEmail(profile.key, index),
      role: 'PROCTOR',
      passwordHash,
    });
    const proctor = await tx.proctor.create({
      data: {
        userId: user.id,
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
    if (plan.hasExam === false) continue;
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
  const seen = new Set();

  for (const [index, plan] of offeringPlans.entries()) {
    const offering = offeringByCode.get(plan.code);
    const selected = selectStudents(students, plan.cohorts, plan.target, index * 11);
    for (const student of selected) {
      const key = `${student.id}:${offering.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      data.push({ studentId: student.id, courseOfferingId: offering.id, status: 'ACTIVE' });
    }
  }

  const batchSize = 500;
  for (let index = 0; index < data.length; index += batchSize) {
    await tx.registration.createMany({ data: data.slice(index, index + batchSize), skipDuplicates: true });
  }

  return data.length;
};

const getExpectedTestCases = (profile, offeringPlans = []) => {
  const offeringCount = offeringPlans.length || profile.offeringCount || 0;
  const examCount = offeringPlans.length
    ? offeringPlans.filter((plan) => plan.hasExam !== false).length
    : offeringCount;
  return {
    dataset: `${profile.label} - ${profile.description}`,
    expectedResult: 'Hybrid schedule generation should complete cleanly with all hard constraints satisfied.',
    offerings: `${offeringCount} active course offerings seeded for ${profile.semesterName} (${examCount} producing exams; PROJECT and LAB-only offerings are excluded).`,
    rooms: `${profile.roomCount} available rooms distributed across ${profile.centerCount} centers with large-capacity halls for high-demand exams.`,
    proctors: `${profile.proctorCount} proctors are available across the full time-slot grid to keep the dataset feasible.`,
    timeSlots: `${profile.slotDays * slotSessions.length} valid 180-minute time slots are available inside the semester exam window.`,
  };
};

const upsertDepartments = async (tx, profile) => {
  const map = new Map();
  for (const department of buildDepartmentSpecs(profile)) {
    const row = await tx.department.upsert({
      where: { code: department.code },
      update: { name: department.name },
      create: { name: department.name, code: department.code },
    });
    map.set(department.code, row);
  }
  return map;
};

const upsertPrograms = async (tx, profile, departmentByCode) => {
  const map = new Map();
  for (const program of buildProgramSpecs(profile)) {
    const row = await tx.program.upsert({
      where: { code: program.code },
      update: {},
      create: {
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

const upsertCourses = async (tx, profile, programByCode, semester, offeringPlans) => {
  const map = new Map();
  for (const plan of offeringPlans) {
    const courseKey = plan.courseKey ?? plan.code;
    if (map.has(courseKey)) continue;
    const row = await tx.course.upsert({
      where: { code: courseKey },
      update: {},
      create: {
        code: courseKey,
        title: buildDatasetScopedLabel(plan.title, profile),
        programId: programByCode.get(plan.programCode).id,
        semesterId: semester.id,
        credits: plan.credits ?? 3,
        description: profile.realData
          ? `${plan.title} (${plan.baseCode ?? courseKey}) - real FEIT offering.`
          : `${profile.label} course seeded for feasible hybrid exam scheduling.`,
        isActive: true,
        createdBy: buildCreatedBy(profile.key),
      },
    });
    map.set(courseKey, row);
  }
  return map;
};

const upsertCourseOfferings = async (tx, profile, courseByCode, semester, offeringPlans) => {
  const map = new Map();
  for (const [index, plan] of offeringPlans.entries()) {
    const courseKey = plan.courseKey ?? plan.code;
    const section = plan.section ?? 'A';
    const row = await tx.courseOffering.upsert({
      where: {
        courseId_semesterId_section: {
          courseId: courseByCode.get(courseKey).id,
          semesterId: semester.id,
          section,
        },
      },
      update: {},
      create: {
        courseId: courseByCode.get(courseKey).id,
        semesterId: semester.id,
        section,
        instructor: plan.instructor ?? instructorNames[index % instructorNames.length],
        expectedStudents: plan.target,
        capacity: Math.max(plan.target + 12, 40),
        day: plan.day ?? ['Monday', 'Tuesday', 'Wednesday', 'Thursday'][index % 4],
        time: plan.time ?? ['09:00', '11:00', '13:00', '15:00'][index % 4],
        roomLabel: 'Assigned by hybrid scheduler',
        notes: plan.notes ?? `${profile.label} feasible course offering for demo scheduling.`,
        priority: plan.priority,
        difficulty: plan.difficulty,
        courseType: plan.hasExam === false ? 'PROJECT' : 'COURSE',
        hasExam: plan.hasExam !== false,
        status: 'ACTIVE',
        createdBy: buildCreatedBy(profile.key),
      },
    });
    map.set(plan.code, row);
  }
  return map;
};

const upsertCentersAndRooms = async (tx, profile) => {
  const centerByCode = new Map();
  const centerSpecs = buildCenterSpecs(profile);
  const roomPlans = buildRoomPlans(profile, centerSpecs);

  for (const [index, centerPlan] of centerSpecs.entries()) {
    const center = await tx.center.upsert({
      where: { code: centerPlan.code },
      update: {},
      create: {
        name: buildDatasetScopedLabel(centerPlan.name, profile),
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
    const roomName = buildDatasetScopedLabel(roomPlan.name, profile);
    await tx.room.upsert({
      where: { name: roomName },
      update: {},
      create: {
        centerId: centerByCode.get(roomPlan.centerCode).id,
        name: roomName,
        capacity: roomPlan.capacity,
        status: 'AVAILABLE',
        createdBy: buildCreatedBy(profile.key),
      },
    });
  }

  return centerByCode;
};

const upsertStudents = async (tx, profile, programByCode, passwordHash) => {
  const students = [];
  const programCodes = buildProgramSpecs(profile).map((program) => program.code);
  const studentsPerProgram = Math.max(1, profile.studentCount / programCodes.length);

  for (let index = 0; index < profile.studentCount; index += 1) {
    const programCode = programCodes[Math.floor(index / studentsPerProgram)] ?? programCodes[programCodes.length - 1];
    const user = await upsertUser(tx, {
      name: fullName(index),
      email: buildStudentEmail(profile.key, index),
      role: 'STUDENT',
      passwordHash,
    });
    const student = await tx.student.upsert({
      where: { universityId: buildStudentUniversityId(profile.namespace, index) },
      update: {},
      create: {
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

const upsertProctors = async (tx, profile, centerByCode, passwordHash, timeSlots) => {
  for (let index = 0; index < profile.proctorCount; index += 1) {
    const user = await upsertUser(tx, {
      name: `Proctor ${fullName(index)}`,
      email: buildProctorEmail(profile.key, index),
      role: 'PROCTOR',
      passwordHash,
    });
    const existingProctor = await tx.proctor.findUnique({ where: { userId: user.id } });
    const proctor = existingProctor ?? await tx.proctor.create({
      data: {
        userId: user.id,
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

const upsertExams = async (tx, profile, offeringByCode, offeringPlans) => {
  for (const plan of offeringPlans) {
    if (plan.hasExam === false) continue;
    const offering = offeringByCode.get(plan.code);
    const existingExam = await tx.exam.findFirst({ where: { courseOfferingId: offering.id } });
    if (!existingExam) {
      await tx.exam.create({
        data: {
          courseOfferingId: offering.id,
          status: 'DRAFT',
          duration: plan.duration,
          createdBy: buildCreatedBy(profile.key),
        },
      });
    }
  }
};

const countLegacyDemoSchedules = async () => prisma.schedule.count({
  where: {
    OR: [
      { createdBy: 'demo-data' },
      { assignments: { some: { exam: { courseOffering: { course: { code: { startsWith: DEMO_PREFIX } } } } } } },
    ],
  },
});

export const generateDemoData = async (options = {}) => {
  const profile = getProfile(options.dataset ?? options.mode);
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const offeringPlans = buildOfferingPlans(profile);
  await normalizeDatasetSemesterRows(profile);
  const existingSummary = await countDemoData(profile.key);
  let registrationCount = 0;

  if (existingSummary.schedules > 0) {
    // Schedules exist: restore any manually-deleted entities without touching existing data or schedules
    await prisma.$transaction(async (tx) => {
      const departmentByCode = await upsertDepartments(tx, profile);
      const programByCode = await upsertPrograms(tx, profile, departmentByCode);
      const semester = await createSemester(tx, profile);
      const courseByCode = await upsertCourses(tx, profile, programByCode, semester, offeringPlans);
      const offeringByCode = await upsertCourseOfferings(tx, profile, courseByCode, semester, offeringPlans);
      const centerByCode = await upsertCentersAndRooms(tx, profile);
      const students = await upsertStudents(tx, profile, programByCode, passwordHash);
      const timeSlots = await createTimeSlots(tx, profile);
      await upsertProctors(tx, profile, centerByCode, passwordHash, timeSlots);
      await upsertExams(tx, profile, offeringByCode, offeringPlans);
      registrationCount = await createRegistrations(tx, students, offeringByCode, offeringPlans);
    }, { timeout: 120000 });

    return {
      message: `${profile.label} restored missing data while preserving existing schedules.`,
      dataset: profile.key,
      datasetLabel: profile.label,
      loginHint: 'Demo users use password Demo12345!',
      summary: await countDemoData(profile.key),
      overallSummary: await countDemoData(),
      instruction: `Select ${profile.semesterName} in the scheduler to continue working with the preserved schedule data.`,
      expectedTestCases: getExpectedTestCases(profile, offeringPlans),
      generatedRegistrations: registrationCount,
      preservedSchedules: existingSummary.schedules,
    };
  }

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
    expectedTestCases: getExpectedTestCases(profile, offeringPlans),
    generatedRegistrations: registrationCount,
  };
};

export const clearDemoData = async (options = {}) => {
  const datasetKey = options.dataset ? normalizeDatasetKey(options.dataset) : null;
  if (datasetKey) {
    const profile = getProfile(datasetKey);
    await normalizeDatasetSemesterRows(profile);
    const existingSummary = await countDemoData(datasetKey);

    if (existingSummary.schedules > 0) {
      throw new AppError('Cannot delete demo dataset. Delete related schedules first from Schedule Versions.', 409);
    }

    await prisma.$transaction(async (tx) => {
      await clearDemoDatasetWithTx(tx, datasetKey);
    }, { timeout: 120000 });

    return {
      message: `${profile.label} cleared successfully.`,
      dataset: datasetKey,
      datasetLabel: profile.label,
      summary: await countDemoData(datasetKey),
      overallSummary: await countDemoData(),
    };
  }

  await Promise.all(DEMO_DATASET_KEYS.map((currentDatasetKey) => normalizeDatasetSemesterRows(getProfile(currentDatasetKey))));
  const datasetStates = await Promise.all(DEMO_DATASET_KEYS.map(async (currentDatasetKey) => ({
    key: currentDatasetKey,
    summary: await countDemoData(currentDatasetKey),
  })));
  const hasProtectedDataset = datasetStates.some((entry) => entry.summary.schedules > 0);
  const legacyScheduleCount = await countLegacyDemoSchedules();

  if (hasProtectedDataset || legacyScheduleCount > 0) {
    throw new AppError('Cannot delete demo dataset. Delete related schedules first from Schedule Versions.', 409);
  }

  await prisma.$transaction(async (tx) => {
    for (const currentDatasetKey of DEMO_DATASET_KEYS) {
      await clearDemoDatasetWithTx(tx, currentDatasetKey);
    }
    await clearLegacyDemoDataWithTx(tx);
  }, { timeout: 120000 });

  return {
    message: 'Demo datasets cleared successfully.',
    overallSummary: await countDemoData(),
  };
};
