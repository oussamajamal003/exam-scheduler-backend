import bcrypt from 'bcrypt';
import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

const DEMO_PREFIX = 'DEMO-';
const DEMO_PASSWORD = 'Demo12345!';
const DEMO_DATASET_KEYS = ['A', 'B', 'C', 'REAL', 'FEIT2027', 'FAIL', 'FAIL2', 'FAIL3'];

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
  { code: 'IT310', title: 'Cloud Infrastructure', programCode: 'IT', cohorts: ['IT'], target: 36, duration: 150, priority: 62, difficulty: 8 },
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

// Room capacities constrained to 30..200 with a mix of small/medium/large
const roomCapacityPool = [
  // small (30-60)
  30, 36, 42, 48, 54, 60,
  // medium (61-120)
  64, 72, 80, 88, 96, 104, 112, 120,
  // large (121-200)
  128, 140, 156, 172, 188, 200,
];
const slotSessions = [
  ['09:00', '11:00'],
  ['11:30', '13:30'],
  ['14:00', '16:00'],
  ['09:00', '11:30'],
  ['13:00', '15:30'],
];
const failDemo2SlotSpecs = [
  ['2027-06-01', '09:00', '11:00'],
  ['2027-06-01', '11:30', '13:30'],
  ['2027-06-02', '09:00', '11:00'],
  ['2027-06-02', '11:30', '13:30'],
  ['2027-06-03', '09:00', '11:00'],
  ['2027-06-03', '11:30', '13:30'],
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
  FEIT2027: {
    key: 'FEIT2027',
    namespace: 'DEMO-FEIT-2027',
    label: 'FEIT Spring 2027',
    description: 'Optimization showcase dataset with FEIT-style overlap, uneven slots, and zero-hard-violation feasibility.',
    semesterName: 'FEIT Spring 2027',
    semesterStartDate: '2027-05-17',
    semesterEndDate: '2027-05-23',
    academicYear: '2026-2027',
    studentCount: 1080,
    proctorCount: 88,
    centerCount: 5,
    roomCount: 58,
    offeringCount: 52,
    slotDays: 5,
    targetScale: 1,
    maxOfferingTarget: 180,
    feitShowcase: true,
  },
  FAIL: {
    key: 'FAIL',
    namespace: 'DEMO-FAIL',
    label: 'Fail Demo Dataset',
    description: 'Deterministically unschedulable dataset demonstrating generation failures',
    semesterName: 'Demo Fail - Constrained Exam Window',
    semesterStartDate: '2027-06-01',
    semesterEndDate: '2027-06-05',
    academicYear: '2026-2027',
    studentCount: 300,
    proctorCount: 10,
    centerCount: 2,
    roomCount: 4,
    offeringCount: 80,
    slotDays: 0,
    targetScale: 1,
    maxOfferingTarget: 200,
    // Mark specially so generator can produce an impossible schedule every run.
    constrainedFailureDemo: true,
  },
  FAIL2: {
    key: 'FAIL2',
    namespace: 'DEMO-FAIL2',
    label: 'Fail Demo Dataset 2',
    description: 'Deterministically unschedulable dataset with a small time-slot window for failure-path testing',
    semesterName: 'Demo Fail 2 - Constrained Exam Window',
    semesterStartDate: '2027-06-01',
    semesterEndDate: '2027-06-05',
    academicYear: '2026-2027',
    studentCount: 300,
    proctorCount: 20,
    centerCount: 2,
    roomCount: 4,
    offeringCount: 80,
    slotDays: 1,
    targetScale: 1,
    maxOfferingTarget: 200,
    constrainedFailureDemo: true,
  },
  FAIL3: {
    key: 'FAIL3',
    namespace: 'DEMO-FAIL3',
    label: 'Fail Demo Dataset 3',
    description: 'Deterministically unschedulable dataset that fails during candidate filtering',
    semesterName: 'Demo Fail 3 - Candidate Filtering Trap',
    semesterStartDate: '2027-06-01',
    semesterEndDate: '2027-06-12',
    academicYear: '2026-2027',
    studentCount: 420,
    proctorCount: 80,
    centerCount: 4,
    roomCount: 20,
    offeringCount: 30,
    slotDays: 5,
    targetScale: 1,
    maxOfferingTarget: 120,
    candidateFilteringFailureDemo: true,
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
const feitShowcaseDepartmentTemplates = [
  { name: 'Computer Engineering', code: 'CE' },
  { name: 'Communications Engineering', code: 'COM' },
  { name: 'Electrical Engineering', code: 'EE' },
  { name: 'Computer Science', code: 'CS' },
  { name: 'Informatics', code: 'INF' },
];
const feitShowcaseProgramTemplates = [
  { name: 'Computer Engineering', code: 'CE', departmentCode: 'CE' },
  { name: 'Embedded Systems Engineering', code: 'EMB', departmentCode: 'CE' },
  { name: 'Communications Engineering', code: 'COM', departmentCode: 'COM' },
  { name: 'Network Engineering', code: 'NET', departmentCode: 'COM' },
  { name: 'Electrical Engineering', code: 'EE', departmentCode: 'EE' },
  { name: 'Control and Instrumentation Engineering', code: 'CIE', departmentCode: 'EE' },
  { name: 'Computer Science', code: 'CS', departmentCode: 'CS' },
  { name: 'Informatics', code: 'INF', departmentCode: 'INF' },
];
const feitShowcaseCenterTemplates = [
  { code: 'NORTH', name: 'North Academic Complex', location: 'North Campus' },
  { code: 'SOUTH', name: 'South Engineering Center', location: 'South Campus' },
  { code: 'EAST', name: 'East Digital Labs', location: 'East Campus' },
  { code: 'WEST', name: 'West Examination Halls', location: 'West Campus' },
  { code: 'CENTRAL', name: 'Central Learning Commons', location: 'Main Campus' },
];
// Ensure FEIT showcase capacities also respect 30..200 limits
const feitShowcaseRoomCapacities = {
  NORTH: [30, 32, 36, 44, 52, 60, 72, 84, 128, 168, 180, 200],
  SOUTH: [30, 34, 42, 48, 56, 68, 80, 104, 124, 164, 180, 200],
  EAST: [30, 32, 40, 46, 54, 66, 76, 100, 118, 152, 180, 200],
  WEST: [30, 36, 44, 50, 58, 70, 82, 100, 132, 176, 190],
  CENTRAL: [30, 34, 42, 48, 56, 68, 78, 100, 126, 166, 190],
};
const feitShowcaseSlotSpecs = [
  ['2027-05-17', '09:00', '11:00'],
  ['2027-05-17', '13:00', '15:00'],
  ['2027-05-18', '08:00', '10:00'],
  ['2027-05-18', '10:15', '12:15'],
  ['2027-05-18', '12:30', '14:30'],
  ['2027-05-18', '14:45', '16:45'],
  ['2027-05-18', '17:00', '19:00'],
  ['2027-05-18', '19:15', '21:15'],
  ['2027-05-19', '08:00', '10:00'],
  ['2027-05-19', '10:05', '12:05'],
  ['2027-05-19', '12:10', '14:10'],
  ['2027-05-19', '14:15', '16:15'],
  ['2027-05-19', '16:20', '18:20'],
  ['2027-05-19', '18:25', '20:25'],
  ['2027-05-20', '08:30', '10:30'],
  ['2027-05-20', '10:45', '12:45'],
  ['2027-05-20', '13:00', '15:00'],
  ['2027-05-20', '15:15', '17:15'],
  ['2027-05-20', '17:30', '19:30'],
  ['2027-05-21', '08:30', '10:30'],
  ['2027-05-21', '10:45', '12:45'],
  ['2027-05-21', '13:00', '15:00'],
  ['2027-05-22', '09:00', '11:00'],
  ['2027-05-22', '11:15', '13:15'],
  ['2027-05-22', '14:00', '16:00'],
  ['2027-05-22', '16:15', '18:15'],
  ['2027-05-23', '09:00', '11:00'],
  ['2027-05-23', '11:15', '13:15'],
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

const buildFeitSpring2027ProctorAvailability = (timeSlots, index) => {
  const slotMeta = timeSlots.map((slot, slotIndex) => ({
    slotId: slot.id,
    slotIndex,
    weekday: new Date(slot.date ?? slot.startTime).getUTCDay(),
    startHour: new Date(slot.startTime).getUTCHours(),
  }));

  return slotMeta.filter((meta) => {
    if (index < 28) {
      const blockedFridayLate = meta.weekday === 5 && meta.startHour >= 11;
      const saturdayWindow = meta.weekday === 6 && meta.startHour < 18;
      const sundayWindow = meta.weekday === 0 && meta.startHour < 18;
      return (!blockedFridayLate || saturdayWindow || sundayWindow) && (meta.slotIndex + index) % 7 !== 0;
    }
    if (index < 62) {
      const peakDays = meta.weekday >= 2 && meta.weekday <= 4;
      const mondayWindow = meta.weekday === 1 && meta.startHour < 12 && index % 2 === 0;
      const fridayWindow = meta.weekday === 5 && meta.startHour < 11;
      const fridayRecoveryWindow = meta.weekday === 5 && meta.startHour >= 11 && index % 3 === 0;
      const saturdayWindow = meta.weekday === 6 && index % 2 === 0;
      const sundayWindow = meta.weekday === 0 && index % 2 === 0;
      return (peakDays || mondayWindow || fridayWindow || fridayRecoveryWindow || saturdayWindow || sundayWindow) && (meta.slotIndex + index) % 5 !== 0;
    }
    const preferredDay = ((index - 62) % 5) + 1;
    const narrowWindow = meta.weekday === preferredDay && meta.startHour < 15;
    const backupWindow = meta.weekday === 3 && meta.startHour < 12 && index % 2 === 0;
    const fridayRecoveryWindow = meta.weekday === 5 && meta.startHour >= 11 && index % 4 === 0;
    const saturdayWindow = meta.weekday === 6 && index % 3 === 0;
    const sundayWindow = meta.weekday === 0 && index % 3 === 0;
    return (narrowWindow || backupWindow || fridayRecoveryWindow || saturdayWindow || sundayWindow) && (meta.slotIndex + index) % 9 !== 0;
  }).map((meta) => ({ timeSlotId: meta.slotId }));
};

const buildFeitSpring2027OfferingPlans = (profile) => {
  const offerings = [];
  const allPrograms = feitShowcaseProgramTemplates.map((program) => `${profile.namespace}-PROG-${program.code}`);
  const coreTitlesByProgram = {
    CE: ['Digital Logic and Computer Architecture', 'Microprocessor Systems', 'Computer Organization', 'Embedded Firmware Design'],
    EMB: ['Embedded Systems Integration', 'IoT Hardware Platforms', 'VLSI Design Fundamentals', 'Real-Time Operating Systems'],
    COM: ['Communication Theory', 'Digital Signal Processing', 'Wireless Networks', 'Antenna and Wave Propagation'],
    NET: ['Network Routing and Switching', 'Signal Processing Applications', 'Mobile Communications', 'RF Systems Laboratory'],
    EE: ['Power Systems Analysis', 'Electrical Machines', 'Protection and Switching', 'Power Electronics'],
    CIE: ['Control Systems', 'Instrumentation and Sensors', 'Industrial Automation', 'Mechatronic Systems'],
    CS: ['Data Structures and Algorithms', 'Operating Systems', 'Database Systems', 'Software Engineering'],
    INF: ['Programming Fundamentals', 'Human-Computer Interaction', 'Data Analytics Foundations', 'Information Systems'],
  };
  const cohortMap = {
    CE: ['CE', 'EMB', 'CS'],
    EMB: ['EMB', 'CE', 'CS'],
    COM: ['COM', 'NET'],
    NET: ['NET', 'COM'],
    EE: ['EE', 'CIE', 'NET'],
    CIE: ['CIE', 'EE', 'NET'],
    CS: ['CS', 'INF', 'CE'],
    INF: ['INF', 'CS', 'COM'],
  };
  const sharedCourseSpecs = [
    { title: 'Engineering Mathematics II', target: 166, cohorts: allPrograms, programCode: 'CS' },
    { title: 'Probability and Statistics for Engineers', target: 158, cohorts: allPrograms, programCode: 'INF' },
    { title: 'Research Methods and Technical Writing', target: 142, cohorts: allPrograms, programCode: 'CS' },
    { title: 'Ethics and Professional Practice', target: 136, cohorts: allPrograms, programCode: 'INF' },
    { title: 'Optimization and Decision Support', target: 154, cohorts: allPrograms, programCode: 'CE' },
    { title: 'Numerical Methods for Engineers', target: 146, cohorts: ['CE', 'EMB', 'EE', 'CIE', 'CS', 'INF'].map((code) => `${profile.namespace}-PROG-${code}`), programCode: 'EE' },
    { title: 'Project Management for Engineering Teams', target: 134, cohorts: allPrograms, programCode: 'CS' },
    { title: 'Entrepreneurship and Innovation', target: 128, cohorts: allPrograms, programCode: 'INF' },
    { title: 'Engineering Economics', target: 138, cohorts: ['EE', 'CIE', 'CE', 'COM', 'NET'].map((code) => `${profile.namespace}-PROG-${code}`), programCode: 'EE' },
    { title: 'Applied Linear Algebra', target: 150, cohorts: allPrograms, programCode: 'CE' },
    { title: 'Scientific Computing', target: 126, cohorts: ['CS', 'INF', 'CE', 'EMB', 'COM'].map((code) => `${profile.namespace}-PROG-${code}`), programCode: 'CS' },
    { title: 'Sustainability in Engineering', target: 122, cohorts: allPrograms, programCode: 'INF' },
  ];
  const electiveCourseSpecs = [
    { title: 'Mobile App Development Studio', target: 34, cohorts: ['CS', 'INF'], programCode: 'CS' },
    { title: 'Robotics and Autonomous Systems', target: 46, cohorts: ['CE', 'EMB', 'CIE'], programCode: 'CE' },
    { title: 'Smart Grid Applications', target: 28, cohorts: ['EE', 'CIE'], programCode: 'EE' },
    { title: 'Secure Cloud Infrastructure', target: 52, cohorts: ['CS', 'INF', 'COM'], programCode: 'CS' },
    { title: 'Biomedical Signal Processing Concepts', target: 32, cohorts: ['COM', 'CIE', 'NET'], programCode: 'COM' },
    { title: 'Computer Vision for Engineers', target: 58, cohorts: ['CS', 'INF', 'CE'], programCode: 'CS' },
    { title: 'IoT Systems Studio', target: 38, cohorts: ['CE', 'EMB', 'INF'], programCode: 'CE' },
    { title: 'Advanced Human-Computer Interaction', target: 26, cohorts: ['CS', 'INF'], programCode: 'INF' },
  ];
  const coreTargets = [108, 86, 68, 48];
  const coreDayPatterns = [
    { day: 'MW', time: '08:00-09:30' },
    { day: 'TTH', time: '10:00-11:30' },
    { day: 'MW', time: '13:00-14:30' },
    { day: 'TTH', time: '15:00-16:30' },
  ];

  feitShowcaseProgramTemplates.forEach((program, programIndex) => {
    coreTitlesByProgram[program.code].forEach((title, courseIndex) => {
      const pattern = coreDayPatterns[courseIndex % coreDayPatterns.length];
      const cohorts = program.code === 'NET' && courseIndex >= 2
        ? [`${profile.namespace}-PROG-NET`]
        : program.code === 'COM' && courseIndex === 3
          ? [`${profile.namespace}-PROG-COM`]
          : cohortMap[program.code].map((code) => `${profile.namespace}-PROG-${code}`);
      offerings.push({
        code: `${profile.namespace}-${program.code}C${courseIndex + 1}`,
        title,
        programCode: `${profile.namespace}-PROG-${program.code}`,
        cohorts,
        // Clamp core targets to 5..60
        target: Math.min(60, Math.max(5, coreTargets[courseIndex] - (programIndex % 2) * 4 - (program.code === 'NET' && courseIndex >= 2 ? 24 : 0))),
        duration: 120,
        priority: 88 - courseIndex * 5,
        difficulty: 7 - (courseIndex === 3 ? 2 : 0),
        instructor: instructorNames[(programIndex * 4 + courseIndex) % instructorNames.length],
        day: pattern.day,
        time: pattern.time,
        notes: 'FEIT Spring 2027 core offering',
      });
    });
  });

  sharedCourseSpecs.forEach((spec, index) => {
    offerings.push({
      code: `${profile.namespace}-S${String(index + 1).padStart(2, '0')}`,
      title: spec.title,
      programCode: `${profile.namespace}-PROG-${spec.programCode}`,
      cohorts: spec.cohorts,
      target: Math.min(60, Math.max(5, spec.target)),
      duration: 120,
      priority: 82,
      difficulty: 6,
      instructor: instructorNames[(index + 5) % instructorNames.length],
      day: ['MW', 'TTH', 'MW', 'TTH', 'F', 'MW', 'TTH', 'MW', 'TTH', 'MW', 'TTH', 'F'][index],
      time: ['09:00-10:30', '10:45-12:15', '12:30-14:00', '14:15-15:45', '08:30-10:00', '10:15-11:45', '13:00-14:30', '15:00-16:30', '08:00-09:30', '10:00-11:30', '13:30-15:00', '15:15-16:45'][index],
      notes: 'FEIT Spring 2027 shared course',
    });
  });

  electiveCourseSpecs.forEach((spec, index) => {
    offerings.push({
      code: `${profile.namespace}-E${String(index + 1).padStart(2, '0')}`,
      title: spec.title,
      programCode: `${profile.namespace}-PROG-${spec.programCode}`,
      cohorts: spec.cohorts.map((code) => `${profile.namespace}-PROG-${code}`),
      target: Math.min(60, Math.max(5, spec.target)),
      duration: 120,
      priority: 60,
      difficulty: 4,
      instructor: instructorNames[(index + 9) % instructorNames.length],
      day: ['MW', 'TTH', 'F', 'MW', 'TTH', 'F', 'MW', 'TTH'][index],
      time: ['08:30-10:00', '10:15-11:45', '12:00-13:30', '13:45-15:15', '15:30-17:00', '17:15-18:45', '09:00-10:30', '11:00-12:30'][index],
      notes: 'FEIT Spring 2027 elective course',
    });
  });

  return offerings;
};

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
  const templates = profile.feitShowcase ? feitShowcaseDepartmentTemplates : profile.realData ? realDepartmentTemplates : departmentTemplates;
  return templates.map((item) => ({
    code: `${profile.namespace}-DEPT-${item.code}`,
    name: profile.realData || profile.feitShowcase ? item.name : `${item.name} (${profile.label})`,
  }));
};

const buildProgramSpecs = (profile) => {
  const templates = profile.feitShowcase ? feitShowcaseProgramTemplates : profile.realData ? realProgramTemplates : programTemplates;
  return templates.map((item) => ({
    code: `${profile.namespace}-PROG-${item.code}`,
    name: profile.realData || profile.feitShowcase ? item.name : `${item.name} (${profile.label})`,
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
  // Clamp real offering targets to 5..60 as part of demo constraints
  target: Math.min(60, Math.max(5, offering.target)),
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



// Special-case injection for candidate-filtering failure dataset: replace the
// first offering with an explicitly impossible exam (Advanced AI Final)
// that cannot be split across multiple rooms and has 65 students while the
// room inventory will be constrained to a 60-seat maximum.
const buildOfferingPlans = (profile) => {
  if (profile.feitShowcase) return buildFeitSpring2027OfferingPlans(profile);
  if (profile.realData) return buildRealOfferingPlans(profile);
  const offerings = Array.from({ length: profile.offeringCount }, (_, index) => {
    const template = courseTemplates[index % courseTemplates.length];
    const cycle = Math.floor(index / courseTemplates.length);
    const variant = cycle === 0 ? '' : ` ${courseTitleVariants[(cycle - 1) % courseTitleVariants.length]}`;
    let target = Math.min(
      profile.maxOfferingTarget,
      Math.max(5, Math.round(template.target * profile.targetScale) + cycle * 6 + (index % 4) * 3),
    );
    target = Math.min(60, Math.max(5, target));

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

  if (profile.candidateFilteringFailureDemo) {
    // Replace the first offering with the impossible Advanced AI Final.
    offerings[0] = {
      code: `${profile.namespace}-ADVAI-01`,
      title: 'Advanced AI Final',
      programCode: `${profile.namespace}-PROG-CS`,
      cohorts: [`${profile.namespace}-PROG-CS`],
      target: 65,
      duration: 120,
      priority: 100,
      difficulty: 9,
      notes: 'NO_SPLIT',
    };
  }

  return offerings;
};

const buildCenterSpecs = (profile) => {
  if (profile.feitShowcase) {
    return feitShowcaseCenterTemplates.map((center) => ({
      code: `${profile.namespace}-CENTER-${center.code}`,
      name: center.name,
      location: center.location,
    }));
  }
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
  if (profile.feitShowcase) {
    return centers.flatMap((center) => {
      const centerCode = center.code.split('-CENTER-')[1];
      return (feitShowcaseRoomCapacities[centerCode] ?? []).map((capacity, index) => ({
        centerCode: center.code,
        name: `${centerCode} Hall ${String(index + 1).padStart(2, '0')}`,
        capacity,
      }));
    });
  }
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
      const capacities = profile.candidateFilteringFailureDemo ? [30, 36, 42, 48, 54, 60] : roomCapacityPool;
      roomPlans.push({
        centerCode: center.code,
        name: `${roomNamePool[roomIndex % roomNamePool.length]} ${String(roomIndex + 1).padStart(2, '0')}`,
        capacity: capacities[roomIndex % capacities.length],
      });
      roomIndex += 1;
    }
  }

  return roomPlans;
};

const buildTimeSlotSpecs = (profile) => {
  if (profile.key === 'FAIL2') return failDemo2SlotSpecs;
  if (profile.constrainedFailureDemo) return [];
  if (profile.feitShowcase) return feitShowcaseSlotSpecs;
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

  return { roomIds, scheduleIds, assignmentScheduleIds };
};

const clearDemoDatasetWithTx = async (tx, datasetKey) => {
  const scope = buildDatasetScope(datasetKey);

  const scopedAssignments = await deleteScopedAssignmentsWithTx(tx, {
    scheduleWhere: { createdBy: scope.createdBy },
    examWhere: { courseOffering: { course: { code: { startsWith: scope.namespace } } } },
    roomWhere: { center: { code: { startsWith: scope.centerCodePrefix } } },
    proctorWhere: { user: { email: { startsWith: scope.proctorEmailPrefix } } },
    timeSlotWhere: { createdBy: scope.createdBy },
  });

  const ownedScheduleIds = new Set(scopedAssignments.scheduleIds);
  const foreignScheduleIds = scopedAssignments.assignmentScheduleIds.filter((scheduleId) => !ownedScheduleIds.has(scheduleId));
  if (foreignScheduleIds.length > 0) {
    throw new AppError('Cannot delete demo dataset. Delete related schedules first from Schedule Versions.', 409);
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
      isActive: true,
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
        department: profile.feitShowcase
          ? feitShowcaseDepartmentTemplates[index % feitShowcaseDepartmentTemplates.length].name
          : index % 2 === 0 ? 'Exam Operations' : 'Academic Quality Office',
        maxExamsPerDay: profile.feitShowcase ? (index < 28 ? 3 : 2) : index % 4 === 0 ? 2 : index % 3 === 0 ? 3 : 4,
        createdBy: buildCreatedBy(profile.key),
        updatedBy: buildCreatedBy(profile.key),
      },
    });

    await tx.proctorAvailability.createMany({
      data: (profile.feitShowcase
        ? buildFeitSpring2027ProctorAvailability(timeSlots, index)
        : timeSlots.map((slot) => ({ timeSlotId: slot.id }))
      ).map((entry) => ({ proctorId: proctor.id, timeSlotId: entry.timeSlotId })),
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
  // Enforce per-student and per-offering constraints before persisting:
  // - per-offering registrations between 5..60 (target was clamped earlier)
  // - per-student course load between 1..7
  const offeringIdToTarget = new Map();
  for (const plan of offeringPlans) {
    const offering = offeringByCode.get(plan.code);
    if (offering) offeringIdToTarget.set(offering.id, Math.min(60, Math.max(5, plan.target ?? 5)));
  }

  // Build counts
  const studentCount = new Map();
  const offeringCount = new Map();
  for (const row of data) {
    studentCount.set(row.studentId, (studentCount.get(row.studentId) || 0) + 1);
    offeringCount.set(row.courseOfferingId, (offeringCount.get(row.courseOfferingId) || 0) + 1);
  }

  // Ensure every student has at least 1 registration
  for (const student of students) {
    const cur = studentCount.get(student.id) || 0;
    if (cur === 0) {
      // find an offering with available capacity
      const candidateOffering = [...offeringIdToTarget.entries()].sort((a, b) => (offeringCount.get(a[0]) || 0) - (offeringCount.get(b[0]) || 0)).find(([offId, cap]) => (offeringCount.get(offId) || 0) < cap);
      if (candidateOffering) {
        const [offId] = candidateOffering;
        data.push({ studentId: student.id, courseOfferingId: offId, status: 'ACTIVE' });
        studentCount.set(student.id, 1);
        offeringCount.set(offId, (offeringCount.get(offId) || 0) + 1);
      }
    }
  }

  // Ensure no student exceeds 7 registrations: trim excess
  for (const [studentId, count] of Array.from(studentCount.entries())) {
    if (count > 7) {
      let toRemove = count - 7;
      // remove registrations for this student, prefer offerings with surplus (>5)
      for (let i = data.length - 1; i >= 0 && toRemove > 0; i -= 1) {
        const row = data[i];
        if (row.studentId !== studentId) continue;
        const offCount = offeringCount.get(row.courseOfferingId) || 0;
        const offTarget = offeringIdToTarget.get(row.courseOfferingId) || 5;
        if (offCount > Math.max(5, Math.min(offTarget, 60))) {
          data.splice(i, 1);
          offeringCount.set(row.courseOfferingId, offCount - 1);
          toRemove -= 1;
        }
      }
      // recompute student count
      studentCount.set(studentId, Math.max(7, count - (count - 7)));
    }
  }

  // Ensure offerings have at least 5 registrations; attempt to fill from students who have <7
  const offeringsNeeding = [...offeringIdToTarget.keys()].filter((offId) => (offeringCount.get(offId) || 0) < 5);
  for (const offId of offeringsNeeding) {
    while ((offeringCount.get(offId) || 0) < 5) {
      // find a student with <7 registrations who is not yet registered to this offering
      const candidate = students.find((s) => (studentCount.get(s.id) || 0) < 7 && !data.some((d) => d.studentId === s.id && d.courseOfferingId === offId));
      if (!candidate) break;
      data.push({ studentId: candidate.id, courseOfferingId: offId, status: 'ACTIVE' });
      studentCount.set(candidate.id, (studentCount.get(candidate.id) || 0) + 1);
      offeringCount.set(offId, (offeringCount.get(offId) || 0) + 1);
    }
  }

  // Persist in batches
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
  const timeSlotCount = buildTimeSlotSpecs(profile).length;
  if (profile.constrainedFailureDemo) {
    return {
      dataset: `${profile.label} - ${profile.description}`,
      expectedResult: [
        'No conflict-free schedule exists for current resources/data.',
      ].join('\n'),
      offerings: `${offeringCount} active course offerings seeded for ${profile.semesterName} (${examCount} producing exams; PROJECT and LAB-only offerings are excluded).`,
      rooms: `${profile.roomCount} available rooms distributed across ${profile.centerCount} centers; intentionally constrained to keep generation unschedulable.`,
      proctors: `${profile.proctorCount} proctors available — intentionally constrained to keep generation unschedulable.`,
      timeSlots: `${timeSlotCount} valid time slots are available inside the semester exam window; intentionally constrained to keep generation unschedulable.`,
    };
  }

  return {
    dataset: `${profile.label} - ${profile.description}`,
    expectedResult: profile.feitShowcase
      ? 'Hybrid schedule generation should show a visible optimization gain on FEIT Spring 2027 while preserving zero hard violations.'
      : 'Hybrid schedule generation should complete cleanly with all hard constraints satisfied.',
    offerings: `${offeringCount} active course offerings seeded for ${profile.semesterName} (${examCount} producing exams; PROJECT and LAB-only offerings are excluded).`,
    rooms: `${profile.roomCount} available rooms distributed across ${profile.centerCount} centers with large-capacity halls for high-demand exams.`,
    proctors: profile.feitShowcase
      ? `${profile.proctorCount} department-mapped proctors use mixed availability patterns to create balancing pressure without hard violations.`
      : `${profile.proctorCount} proctors are available across the full time-slot grid to keep the dataset feasible.`,
    timeSlots: `${timeSlotCount} valid time slots are available inside the semester exam window.`,
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
        department: profile.feitShowcase
          ? feitShowcaseDepartmentTemplates[index % feitShowcaseDepartmentTemplates.length].name
          : index % 2 === 0 ? 'Exam Operations' : 'Academic Quality Office',
        maxExamsPerDay: profile.feitShowcase ? (index < 28 ? 3 : 2) : index % 4 === 0 ? 2 : index % 3 === 0 ? 3 : 4,
        createdBy: buildCreatedBy(profile.key),
        updatedBy: buildCreatedBy(profile.key),
      },
    });
    await tx.proctorAvailability.deleteMany({ where: { proctorId: proctor.id } });
    await tx.proctorAvailability.createMany({
      data: (profile.feitShowcase
        ? buildFeitSpring2027ProctorAvailability(timeSlots, index)
        : timeSlots.map((slot) => ({ timeSlotId: slot.id }))
      ).map((entry) => ({ proctorId: proctor.id, timeSlotId: entry.timeSlotId })),
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
  const legacyScheduleCount = await countLegacyDemoSchedules();

  if (legacyScheduleCount > 0) {
    throw new AppError('Cannot delete legacy demo data while legacy schedules exist. Delete related schedules first from Schedule Versions.', 409);
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
