// Realistic FEIT Spring 2026 seed builder.
// Reads the fixture JSON and persists a fully wired scheduling scenario
// (departments, programs, semester, courses, offerings, students,
// registrations, centers, rooms, time slots, proctors with availability).
//
// The seeder supports overrides so individual tests can selectively starve
// the scenario (e.g. shrink rooms, hide proctor availability) WITHOUT
// inventing fake data — every entity still comes from the real fixture.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import bcrypt from 'bcrypt';
import prisma from '../../src/config/prisma.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, '../fixtures/feit-spring-2026.json');

export const loadFeitFixture = () => JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

const PASSWORD_HASH_CACHE = { value: null };
const getPasswordHash = async () => {
  if (!PASSWORD_HASH_CACHE.value) {
    PASSWORD_HASH_CACHE.value = await bcrypt.hash('Test12345!', 4);
  }
  return PASSWORD_HASH_CACHE.value;
};

const firstNames = ['Layla', 'Omar', 'Sara', 'Adam', 'Nour', 'Yara', 'Karim', 'Maya', 'Ziad', 'Rana', 'Tala', 'Fadi', 'Hala', 'Samir', 'Dina'];
const lastNames = ['Ahmed', 'Hassan', 'Khalil', 'Nasser', 'Mansour', 'Saleh', 'Fouad', 'Issa', 'Rahman', 'Darwish'];
const fullName = (i) => `${firstNames[i % firstNames.length]} ${lastNames[Math.floor(i / firstNames.length) % lastNames.length]}`;
const toDate = (d, t) => new Date(`${d}T${t}:00.000Z`);

const buildTimeSlotSpecs = (fixture, { dayCount, sessions } = {}) => {
  const specs = [];
  const slotDays = dayCount ?? fixture.slotDays;
  const slotSessions = sessions ?? fixture.slotSessions;
  const base = new Date(`${fixture.semesterStartDate}T00:00:00.000Z`);
  for (let d = 0; d < slotDays; d += 1) {
    const date = new Date(base);
    date.setUTCDate(base.getUTCDate() + d);
    const dateStr = date.toISOString().slice(0, 10);
    for (const [start, end] of slotSessions) {
      specs.push({ dateStr, start, end });
    }
  }
  return specs;
};

/**
 * Seed the FEIT scenario.
 *
 * @param {object} options
 * @param {string} [options.namespace] - prefix isolating this run (default 'FEIT-T')
 * @param {boolean} [options.realistic=true] - include all FEIT offerings/registrations
 * @param {number} [options.studentCount] - override student pool size
 * @param {number} [options.proctorCount] - override proctor count
 * @param {number} [options.dayCount] - override number of exam days
 * @param {Array}  [options.sessions] - override slot sessions
 * @param {(room) => boolean} [options.roomFilter] - drop rooms to starve capacity
 * @param {(proctor, index) => Array<number>} [options.proctorAvailabilityFilter] - choose timeSlot indices each proctor is available at
 * @param {string} [options.semesterName] - override semester display name
 */
export const seedFeitScenario = async (options = {}) => {
  const {
    namespace = 'FEIT-T',
    realistic = true,
    studentCount: overrideStudentCount,
    proctorCount: overrideProctorCount,
    dayCount,
    sessions,
    roomFilter,
    proctorAvailabilityFilter,
    semesterName,
  } = options;

  const fixture = loadFeitFixture();
  const passwordHash = await getPasswordHash();
  const studentCount = overrideStudentCount ?? fixture.studentCount;
  const proctorCount = overrideProctorCount ?? fixture.proctorCount;
  const createdBy = `test:${namespace}`;

  return prisma.$transaction(async (tx) => {
    // Departments
    const departmentByCode = new Map();
    for (const dep of fixture.departments) {
      const code = `${namespace}-DEPT-${dep.code}`;
      const row = await tx.department.create({ data: { name: dep.name, code } });
      departmentByCode.set(dep.code, row);
    }

    // Programs
    const programByCode = new Map();
    for (const prog of fixture.programs) {
      const code = `${namespace}-PROG-${prog.code}`;
      const row = await tx.program.create({
        data: {
          name: prog.name,
          code,
          departmentId: departmentByCode.get(prog.departmentCode).id,
          isActive: true,
          createdBy,
        },
      });
      programByCode.set(prog.code, row);
    }

    // Semester
    const semester = await tx.semester.create({
      data: {
        name: semesterName ?? `${fixture.semesterName} [${namespace}]`,
        startDate: toDate(fixture.semesterStartDate, '00:00'),
        endDate: toDate(fixture.semesterEndDate, '23:59'),
        academicYear: fixture.academicYear,
        isActive: true,
        createdBy,
      },
    });

    // Centers + rooms
    const centerByCode = new Map();
    for (const c of fixture.centers) {
      const center = await tx.center.create({
        data: {
          name: `${c.name} [${namespace}]`,
          code: `${namespace}-CTR-${c.code}`,
          location: c.location,
          isActive: true,
          createdBy,
        },
      });
      centerByCode.set(c.code, center);
    }
    const createdRooms = [];
    for (const r of fixture.rooms) {
      if (roomFilter && !roomFilter(r)) continue;
      const room = await tx.room.create({
        data: {
          name: r.name,
          capacity: r.capacity,
          status: 'AVAILABLE',
          centerId: centerByCode.get(r.centerCode).id,
          createdBy,
        },
      });
      createdRooms.push(room);
    }

    // Courses (one per unique baseCode) + offerings
    const courseByCode = new Map();
    const offeringByCode = new Map();
    const offerings = realistic
      ? fixture.offerings
      : fixture.offerings.filter((o) => o.hasExam);

    for (const o of offerings) {
      const courseCode = `${namespace}-${o.baseCode}`;
      let course = courseByCode.get(courseCode);
      if (!course) {
        course = await tx.course.create({
          data: {
            code: courseCode,
            title: o.title,
            programId: programByCode.get(o.programCode).id,
            semesterId: semester.id,
            credits: o.credits ?? 3,
            isActive: true,
            createdBy,
          },
        });
        courseByCode.set(courseCode, course);
      }
      const offering = await tx.courseOffering.create({
        data: {
          courseId: course.id,
          semesterId: semester.id,
          section: o.section ?? 'A',
          instructor: o.instructor,
          expectedStudents: o.target,
          capacity: Math.max(o.target + 12, 40),
          day: o.day,
          time: o.time,
          notes: `FEIT ${o.type} - ${o.day} ${o.time}`,
          priority: o.hasExam ? 70 : 30,
          difficulty: o.hasExam ? 6 : 3,
          courseType: o.hasExam ? 'COURSE' : 'PROJECT',
          hasExam: !!o.hasExam,
          status: 'ACTIVE',
          createdBy,
        },
      });
      offeringByCode.set(`${o.baseCode}-${o.section ?? 'A'}`, { offering, plan: o });
    }

    // Students (round-robin across programs) + user accounts
    const programCodes = fixture.programs.map((p) => p.code);
    const students = [];
    for (let i = 0; i < studentCount; i += 1) {
      const programCode = programCodes[i % programCodes.length];
      const email = `test.${namespace.toLowerCase()}.stu${String(i).padStart(4, '0')}@uni.test`;
      const user = await tx.user.create({
        data: { name: fullName(i), email, role: 'STUDENT', password: passwordHash },
      });
      const student = await tx.student.create({
        data: {
          userId: user.id,
          universityId: `${namespace}-STU-${String(i).padStart(4, '0')}`,
          programId: programByCode.get(programCode).id,
          createdBy,
        },
      });
      students.push({ ...student, programCode });
    }

    // Time slots
    const slotSpecs = buildTimeSlotSpecs(fixture, { dayCount, sessions });
    const timeSlots = [];
    for (const spec of slotSpecs) {
      const startTime = toDate(spec.dateStr, spec.start);
      const endTime = toDate(spec.dateStr, spec.end);
      const slot = await tx.timeSlot.create({
        data: {
          startTime,
          endTime,
          date: toDate(spec.dateStr, '00:00'),
          duration: Math.round((endTime.getTime() - startTime.getTime()) / 60000),
          createdBy,
        },
      });
      timeSlots.push(slot);
    }

    // Proctors + availability
    const proctors = [];
    for (let i = 0; i < proctorCount; i += 1) {
      const email = `test.${namespace.toLowerCase()}.proc${String(i).padStart(3, '0')}@uni.test`;
      const user = await tx.user.create({
        data: { name: `Proctor ${fullName(i)}`, email, role: 'PROCTOR', password: passwordHash },
      });
      const proctor = await tx.proctor.create({
        data: {
          userId: user.id,
          department: 'Exam Operations',
          maxExamsPerDay: 4,
          createdBy,
          updatedBy: createdBy,
        },
      });
      const availableSlotIndices = proctorAvailabilityFilter
        ? proctorAvailabilityFilter({ proctor, index: i }, timeSlots) ?? []
        : timeSlots.map((_, idx) => idx);
      if (availableSlotIndices.length > 0) {
        await tx.proctorAvailability.createMany({
          data: availableSlotIndices.map((idx) => ({
            proctorId: proctor.id,
            timeSlotId: timeSlots[idx].id,
          })),
          skipDuplicates: true,
        });
      }
      proctors.push(proctor);
    }

    // Registrations: pick `target` students whose program is in `cohorts`
    const studentsByProgram = new Map();
    for (const program of fixture.programs) studentsByProgram.set(program.code, []);
    for (const student of students) studentsByProgram.get(student.programCode).push(student);

    let registrationCount = 0;
    for (const [key, { offering, plan }] of offeringByCode.entries()) {
      const pool = plan.cohorts.flatMap((c) => studentsByProgram.get(c) ?? []);
      // Deterministic interleave so the same student is reused across overlapping cohorts.
      const seen = new Set();
      const selected = [];
      let cursor = 0;
      while (selected.length < plan.target && cursor < pool.length * 2) {
        const s = pool[cursor % pool.length];
        cursor += 1;
        if (!s || seen.has(s.id)) continue;
        seen.add(s.id);
        selected.push(s);
      }
      if (selected.length === 0) continue;
      await tx.registration.createMany({
        data: selected.map((s) => ({
          studentId: s.id,
          courseOfferingId: offering.id,
          status: 'ACTIVE',
        })),
        skipDuplicates: true,
      });
      registrationCount += selected.length;
      // Touch key to silence lint
      void key;
    }

    // Pre-create Exam rows for COURSE offerings (mirrors prod flow).
    for (const { offering, plan } of offeringByCode.values()) {
      if (!plan.hasExam) continue;
      await tx.exam.create({
        data: {
          courseOfferingId: offering.id,
          status: 'DRAFT',
          duration: plan.duration && plan.duration > 0 ? plan.duration : 120,
          createdBy,
        },
      });
    }

    return {
      namespace,
      semester,
      programs: [...programByCode.values()],
      centers: [...centerByCode.values()],
      rooms: createdRooms,
      timeSlots,
      proctors,
      students,
      offerings: [...offeringByCode.values()].map(({ offering, plan }) => ({ offering, plan })),
      counts: {
        students: students.length,
        proctors: proctors.length,
        rooms: createdRooms.length,
        timeSlots: timeSlots.length,
        offerings: offeringByCode.size,
        registrations: registrationCount,
        examsExpected: [...offeringByCode.values()].filter(({ plan }) => plan.hasExam).length,
      },
    };
  }, { timeout: 180000 });
};
