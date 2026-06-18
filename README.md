# Smart Multi-Center Exam Scheduling and Optimization System

[![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express.js-4.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15%2B-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Jest](https://img.shields.io/badge/Jest-Testing-C21325?logo=jest&logoColor=white)](https://jestjs.io/)
[![Render](https://img.shields.io/badge/Deploy-Render-46E3B7?logo=render&logoColor=black)](https://render.com/)

## Overview

This repository contains the **Node.js + Express backend** for the **Smart Multi-Center Exam Scheduling and Optimization System**.

The backend powers a conflict-aware scheduling platform capable of generating exam timetables across multiple centers, optimizing schedule quality, publishing approved schedules, and serving role-aware data to administrators, students, and proctors.

It is responsible for:

- academic master data management,
- scheduling engine execution,
- schedule validation and optimization,
- role-based access control,
- PDF generation,
- notifications,
- audit logging,
- and REST API delivery for the frontend.

## Architecture

```mermaid
flowchart TD
  A[React Frontend] --> B[REST API]
  B --> C[Node.js + Express Backend]
  C --> D[Modules]
  D --> E[PostgreSQL + Prisma]
```

### Architectural layers

| Layer | Responsibility |
| --- | --- |
| React Frontend | Calls the backend REST API and renders schedules, dashboards, and admin workflows. |
| REST API | Exposes authentication, CRUD, scheduling, reporting, and role-specific endpoints. |
| Node.js + Express Backend | Hosts middleware, routing, validation, and application services. |
| Modules | Organize the domain into feature-focused service, controller, and route boundaries. |
| PostgreSQL + Prisma | Stores academic, scheduling, user, and notification data with typed persistence. |

### Internal backend pattern

| Concern | Role |
| --- | --- |
| Controllers | Receive HTTP requests, call services, and return standardized responses. |
| Services | Hold business logic, scheduling logic, and data orchestration. |
| Repositories / Models | Encapsulate database queries and persistence helpers. |
| Middleware | Handle authentication, validation, logging, errors, and audit context. |
| Scheduling Engine | Generates and evaluates candidate schedules, resolves constraints, and persists final results. |

## Tech Stack

| Category | Technology |
| --- | --- |
| Runtime | Node.js |
| Web Framework | Express.js |
| Database | PostgreSQL |
| ORM | Prisma ORM |
| Authentication | JWT |
| Authorization | RBAC |
| PDF Generation | PDFKit |
| Notifications | Database-backed notification system |
| Testing | Jest |
| Deployment | Render |

Additional backend tooling includes `bcrypt`, `cors`, `compression`, `swagger-ui-express`, `yamljs`, `zod`, `pg`, and `dotenv`.

## Database

The Prisma schema models the complete academic and scheduling domain.

### Academic Data

| Entity | Purpose |
| --- | --- |
| Students | Student identity and academic membership. |
| Courses | Course catalog and academic definitions. |
| Course Offerings | Semester-specific offerings, capacity, instructor, and exam linkage. |
| Enrollments | Student registrations for offerings. |
| Departments | Academic organizational units. |
| Programs | Degree or program structure. |
| Semesters | Academic periods used to scope schedules. |

### Scheduling Data

| Entity | Purpose |
| --- | --- |
| Exams | Exam records attached to course offerings. |
| Rooms | Physical exam locations. |
| Time Slots | Candidate or assigned exam windows. |
| Schedules | Generated schedules and lifecycle state. |
| Exam Assignments | Final room/proctor/time-slot placement rows. |
| Scheduling Versions | Schedule history, generation snapshots, and publication versions. |

### User Management

| Entity | Purpose |
| --- | --- |
| Users | Authentication identity and role binding. |
| Roles | Admin, student, and proctor authorization model. |
| User Settings | Notification and preference storage. |
| Proctors | Proctor profile, workload limits, and assignment linkage. |

### Notifications

| Entity | Purpose |
| --- | --- |
| Notifications | Generic event notifications and metadata. |
| Student Notifications | Student-facing schedule and update messages. |

## Backend Modules

| Module | Responsibility |
| --- | --- |
| `assignments` | CRUD for schedule assignment rows, list/detail/update/delete operations, and assignment-level constraint checks. |
| `audit` | Persists audit logs for create, update, and delete operations through Prisma extensions. |
| `auth` | Login, logout, current-user lookup, user listing, admin seeding, and account removal. |
| `centers` | Center management and CRUD. |
| `courseOfferings` | Course offering CRUD, schedule linkage, and exam-assignment awareness. |
| `courses` | Course management and curriculum data. |
| `demoData` | Demo dataset generation and cleanup for evaluation and testing. |
| `departments` | Department CRUD and academic structure management. |
| `enrollments` | Registration CRUD, filters, student views, offering views, and bulk import. |
| `exams` | Exam listing, exam details, and exam generation from course offerings. |
| `notifications` | Notification creation, visibility, publication messages, and targeted schedule alerts. |
| `proctorPortal` | Proctor dashboard, assignments, students, schedule PDF, notifications, and settings APIs. |
| `proctors` | Proctor management and workload queries. |
| `programs` | Program CRUD and academic structure management. |
| `roleDashboards` | Aggregated admin, student, and proctor dashboard data for the frontend. |
| `rooms` | Room management, availability, and capacity rules. |
| `schedulePdf` | PDF rendering for admin, student, proctor, and full published schedules. |
| `schedules` | Schedule CRUD, publish/unpublish lifecycle, PDF access, and assignment routing. |
| `scheduling` | Hybrid scheduling engine, preparation, validation, generation, analysis, and publishing. |
| `search` | Global search across key entities. |
| `semesters` | Semester CRUD and date-range control. |
| `studentNotifications` | Student-only notification inbox and read-state management. |
| `studentPortal` | Student dashboard, courses, exams, schedule PDF, notifications, and settings APIs. |
| `students` | Student management and student-specific queries. |
| `systemSettings` | Admin system settings, account management, profile, and notification preferences. |
| `timeslots` | Time slot management and availability queries. |
| `userSettings` | User preference and password update helpers used by portal/settings flows. |

## Scheduling Engine

The backend uses a **hybrid constraint-based scheduling engine** implemented in `src/modules/scheduling/schedulingService.js` and coordinated with schedule synchronization logic in `src/modules/schedules/scheduleSyncService.js`.

### Hybrid Scheduling Engine

The engine follows a staged pipeline:

1. **Priority Scoring** - exams are ranked by priority, load, and constraint pressure.
2. **Candidate Generation** - feasible room/time/proctor combinations are built from available resources.
3. **Candidate Filtering** - invalid combinations are removed using hard constraints and availability rules.
4. **Best Candidate Selection** - the engine picks the candidate with the lowest normalized penalty.
5. **Resource Reservation** - selected rooms, proctors, and time slots are reserved into draft assignments.
6. **Draft Schedule Creation** - a provisional schedule is created for the semester.
7. **Optimization Phase** - lightweight refinement passes improve quality without violating hard constraints.
8. **Quality Evaluation** - the schedule is scored using room utilization, proctor balance, student spacing, and exam distribution.
9. **Final Validation** - the result is validated again before persisting or publishing.

### Supported scheduling strategies

#### Multi-Room Allocation

When no single room can host an exam, the engine can split students across multiple rooms in the same time slot. This keeps the exam conflict-free while respecting room capacities.

#### Shared-Room Scheduling

Multiple exams may share the same room and same time slot when room capacity permits. The engine also respects **shared proctor groups**, meaning a common proctor pool can be assigned to related exams when workload and availability rules allow it.

### Hard constraints

- Student Conflicts
- Room Capacity
- Room Availability
- Shared-Room Capacity Validation
- Proctor Availability
- Daily Limits
- Semester Date Range
- Exam Duration Rules

### Soft constraints

- Room Utilization
- Proctor Balance
- Student Spacing
- Exam Distribution

### Candidate penalty scoring

Each candidate is assigned a **normalized penalty score** in the range of **0 to 100**.

The backend weighs the following factors:

| Factor | Meaning |
| --- | --- |
| `unusedRoomSeats` | Penalizes wasted capacity. |
| `roomCount` | Penalizes spreading a single exam across too many rooms. |
| `proctorWorkload` | Penalizes overloaded proctors. |
| `studentDailyLoad` | Penalizes excessive daily concentration for students. |
| `roomCenterSpread` | Penalizes excessive fragmentation across centers. |

Lower scores are preferred. The engine keeps the best valid candidate rather than simply the first feasible one.

### Quality evaluation

The backend computes scheduling quality using four major metrics:

| Metric | Description |
| --- | --- |
| Room Utilization | How efficiently room capacity is used. |
| Proctor Balance | How evenly duties are distributed. |
| Student Spacing | How well exams are spread for students. |
| Exam Distribution | How well exams are spread across time and resources. |

Overall quality is calculated with the following formula:

$$
0.25 \times Room\ Utilization + 0.30 \times Proctor\ Balance + 0.30 \times Student\ Spacing + 0.15 \times Exam\ Distribution
$$

## API Documentation

API documentation is also exposed through Swagger at `/api/docs`.

### Auth

| Method | Route | Description |
| --- | --- | --- |
| POST | `/api/auth/login` | Authenticate a user and issue a JWT. |
| GET | `/api/auth/me` | Return the authenticated user profile. |
| GET | `/api/auth/` | List all users as an admin. |
| POST | `/api/auth/logout` | Log out the current user. |
| DELETE | `/api/auth/delete` | Delete the current user account. |

### Students

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/students` | List students. |
| POST | `/api/students` | Create a student. |
| GET | `/api/students/:id` | Fetch a student by ID. |
| PUT | `/api/students/:id` | Update a student. |
| DELETE | `/api/students/:id` | Delete a student. |
| GET | `/api/students/:id/exams` | Fetch exams for a student. |

### Courses

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/courses` | List courses. |
| POST | `/api/courses` | Create a course. |
| GET | `/api/courses/:id` | Fetch a course by ID. |
| PUT | `/api/courses/:id` | Update a course. |
| DELETE | `/api/courses/:id` | Delete a course. |

### Programs

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/programs` | List programs. |
| POST | `/api/programs` | Create a program. |
| GET | `/api/programs/:id` | Fetch a program by ID. |
| PUT | `/api/programs/:id` | Update a program. |
| DELETE | `/api/programs/:id` | Delete a program. |

### Departments

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/departments` | List departments. |
| POST | `/api/departments` | Create a department. |
| GET | `/api/departments/:id` | Fetch a department by ID. |
| PUT | `/api/departments/:id` | Update a department. |
| DELETE | `/api/departments/:id` | Delete a department. |

### Semesters

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/semesters` | List semesters. |
| POST | `/api/semesters` | Create a semester. |
| GET | `/api/semesters/:id` | Fetch a semester by ID. |
| PUT | `/api/semesters/:id` | Update a semester. |
| DELETE | `/api/semesters/:id` | Delete a semester. |

### Centers

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/centers` | List centers. |
| POST | `/api/centers` | Create a center. |
| GET | `/api/centers/:id` | Fetch a center by ID. |
| PUT | `/api/centers/:id` | Update a center. |
| DELETE | `/api/centers/:id` | Delete a center. |

### Rooms

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/rooms` | List rooms. |
| POST | `/api/rooms` | Create a room. |
| GET | `/api/rooms/available` | List available rooms. |
| GET | `/api/rooms/:id` | Fetch a room by ID. |
| PUT | `/api/rooms/:id` | Update a room. |
| DELETE | `/api/rooms/:id` | Delete a room. |

### Proctors

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/proctors` | List proctors. |
| POST | `/api/proctors` | Create a proctor. |
| GET | `/api/proctors/:id` | Fetch a proctor by ID. |
| GET | `/api/proctors/:id/workload` | Inspect a proctor workload. |
| PUT | `/api/proctors/:id` | Update a proctor. |
| DELETE | `/api/proctors/:id` | Delete a proctor. |

### Time slots

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/timeslots` | List time slots. |
| GET | `/api/timeslots/available` | List available time slots. |
| POST | `/api/timeslots` | Create a time slot. |
| GET | `/api/timeslots/:id` | Fetch a time slot by ID. |
| PUT | `/api/timeslots/:id` | Update a time slot. |
| DELETE | `/api/timeslots/:id` | Delete a time slot. |

### Enrollments

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/enrollments` | List enrollments. |
| GET | `/api/enrollments/filters` | Get filter options. |
| GET | `/api/enrollments/student/:studentId` | Get enrollments for a student. |
| GET | `/api/enrollments/offering/:offeringId` | Get enrollments for a course offering. |
| POST | `/api/enrollments/bulk-import` | Bulk import enrollments. |
| GET | `/api/enrollments/:id` | Fetch an enrollment by ID. |
| POST | `/api/enrollments` | Create an enrollment. |
| PUT | `/api/enrollments/:id` | Update an enrollment. |
| DELETE | `/api/enrollments/:id` | Delete an enrollment. |

### Course offerings

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/course-offerings` | List course offerings. |
| POST | `/api/course-offerings` | Create a course offering. |
| GET | `/api/course-offerings/:id` | Fetch a course offering by ID. |
| PUT | `/api/course-offerings/:id` | Update a course offering. |
| DELETE | `/api/course-offerings/:id` | Delete a course offering. |

### Exams

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/exams` | List exams. |
| GET | `/api/exams/:id` | Fetch an exam by ID. |
| POST | `/api/exams/generate-from-courses` | Generate exams from course offerings. |

### Scheduling engine

| Method | Route | Description |
| --- | --- | --- |
| POST | `/api/scheduling/prepare` | Prepare normalized scheduling input. |
| POST | `/api/scheduling/validate-input` | Validate scheduling input before generation. |
| POST | `/api/scheduling/generate` | Run the hybrid scheduling engine. |
| GET | `/api/scheduling/:id/analysis` | Fetch scheduling quality analysis. |
| PATCH | `/api/scheduling/:id/publish` | Publish a generated schedule. |

### Schedules and assignments

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/schedules` | List schedules. |
| POST | `/api/schedules` | Create a schedule. |
| GET | `/api/schedules/:id` | Fetch a schedule by ID. |
| GET | `/api/schedules/:id/pdf` | Download the admin schedule PDF. |
| PUT | `/api/schedules/:id` | Update a schedule. |
| DELETE | `/api/schedules/:id` | Delete a schedule. |
| PATCH | `/api/schedules/:id/unpublish` | Unpublish a schedule. |
| GET | `/api/schedules/:scheduleId/assignments` | List schedule assignments. |
| GET | `/api/schedules/:scheduleId/assignments/:assignmentId` | Fetch a schedule assignment. |
| PUT | `/api/schedules/:scheduleId/assignments/:assignmentId` | Update a schedule assignment. |
| DELETE | `/api/schedules/:scheduleId/assignments/:assignmentId` | Delete a schedule assignment. |

### Role dashboards

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/role-dashboards/admin/counts` | Admin dashboard summary counts. |
| GET | `/api/role-dashboards/student` | Student dashboard data. |
| GET | `/api/role-dashboards/proctor` | Proctor dashboard data. |
| GET | `/api/role-dashboards/published-schedules` | Published schedules visible to student/proctor roles. |

### Student notifications

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/student-notifications` | List student notifications. |
| PATCH | `/api/student-notifications/read-all` | Mark all student notifications as read. |
| PATCH | `/api/student-notifications/:id/read` | Mark one student notification as read. |

### Student portal

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/student/dashboard` | Student dashboard. |
| GET | `/api/student/courses` | Student courses. |
| GET | `/api/student/exams` | Student exams. |
| GET | `/api/student/schedule/pdf` | Download the student schedule PDF. |
| GET | `/api/student/schedule/full-pdf` | Download the full published schedule PDF in student scope. |
| GET | `/api/student/notifications` | Student notifications. |
| PATCH | `/api/student/notifications/read-all` | Mark all student notifications as read. |
| PATCH | `/api/student/notifications/:id/read` | Mark one student notification as read. |
| GET | `/api/student/published-schedules` | Published schedules available to students. |
| GET | `/api/student/settings` | Student settings. |
| GET | `/api/student/settings/profile` | Student profile. |
| PATCH | `/api/student/settings/profile` | Update student profile. |
| PATCH | `/api/student/settings` | Update student settings. |
| PATCH | `/api/student/settings/change-password` | Change student password. |

### Proctor portal

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/proctor/dashboard` | Proctor dashboard. |
| GET | `/api/proctor/assignments` | Proctor assignments. |
| GET | `/api/proctor/assigned-students` | Students assigned to the proctor's duties. |
| GET | `/api/proctor/schedule/pdf` | Download the proctor schedule PDF. |
| GET | `/api/proctor/schedule/full-pdf` | Download the full published schedule PDF in proctor scope. |
| GET | `/api/proctor/notifications` | Proctor notifications. |
| PATCH | `/api/proctor/notifications/read-all` | Mark all proctor notifications as read. |
| PATCH | `/api/proctor/notifications/:id/read` | Mark one proctor notification as read. |
| GET | `/api/proctor/published-schedules` | Published schedules available to proctors. |
| GET | `/api/proctor/settings` | Proctor settings. |
| GET | `/api/proctor/settings/profile` | Proctor profile. |
| PATCH | `/api/proctor/settings/profile` | Update proctor profile. |
| PATCH | `/api/proctor/settings` | Update proctor settings. |
| PATCH | `/api/proctor/settings/change-password` | Change proctor password. |

### Demo data and search

| Method | Route | Description |
| --- | --- | --- |
| POST | `/api/demo-data/generate` | Generate demo data for evaluation. |
| DELETE | `/api/demo-data/clear` | Clear generated demo data. |
| GET | `/api/search` | Search across supported entities. |

### System settings

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/settings` | Fetch system settings. |
| PUT | `/api/settings` | Update system settings. |
| GET | `/api/settings/notifications` | Get admin notification preferences. |
| PUT | `/api/settings/notifications` | Update admin notification preferences. |
| GET | `/api/settings/profile` | Get admin profile. |
| PUT | `/api/settings/profile` | Update admin profile. |
| PUT | `/api/settings/change-password` | Change admin password. |
| GET | `/api/settings/accounts` | List user accounts. |
| GET | `/api/settings/accounts/:userId` | Fetch a user account. |
| PUT | `/api/settings/accounts/:userId` | Update a user account. |
| DELETE | `/api/settings/accounts/:userId` | Delete a user account. |

## Environment Variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | No | HTTP server port, defaults to `5000`. |
| `DATABASE_URL` | Yes | PostgreSQL connection string used by Prisma and the direct `pg` pool. |
| `JWT_SECRET` | Yes | Secret used to sign and verify JWTs. |
| `JWT_EXPIRES_IN` | No | JWT expiration window, defaults to `150m`. |
| `NODE_ENV` | No | Environment selector such as `development`, `test`, or `production`. |
| `FRONTEND_URL` | No | Allowed origin for CORS in production/staging. |
| `TEST_DATABASE_URL` | Yes for tests | Isolated PostgreSQL database used by Jest. |

### Example `.env`

```env
PORT=5000
DATABASE_URL=postgresql://user:password@localhost:5432/exam_scheduler
JWT_SECRET=replace-with-a-strong-secret
JWT_EXPIRES_IN=150m
FRONTEND_URL=https://your-vercel-app.vercel.app
NODE_ENV=development
```

## Running Locally

```bash
npm install
npx prisma migrate deploy
npm run dev
```

`npx prisma migrate deploy` applies the database schema to the target PostgreSQL instance before the server starts.

## Testing

The backend uses Jest with an isolated PostgreSQL test database.

### Test coverage categories

- Unit tests
- Integration tests
- Large dataset tests
- Shared-room scheduling tests

### Commands

```bash
npm test
npm run test:watch
```

### Test setup

- `tests/setup/testEnv.cjs` redirects Prisma to `TEST_DATABASE_URL`.
- `tests/setup/globalSetup.js` applies migrations before the suite starts.
- The scheduling suite includes regression coverage for candidate filtering, multi-room allocation, shared-room partitioning, large datasets, synchronization, and publishing rules.

## Deployment

### Render deployment

Use the following build and start commands on Render:

| Setting | Value |
| --- | --- |
| Build Command | `npm install && npx prisma generate` |
| Start Command | `npm start` |

### Deployment notes

- Set `DATABASE_URL` to the Render PostgreSQL instance or to a Neon PostgreSQL database, depending on your deployment target.
- Set `JWT_SECRET` and `FRONTEND_URL` in the Render environment.
- Run `npx prisma migrate deploy` during deployment or as part of a release job so the schema is applied before the app starts.
- The backend writes through Prisma and reads/writes schedule data from PostgreSQL only; the frontend never connects to the database directly.

## Logging & Audit

The backend records both operational logs and data-change audit trails.

- `src/utils/logger.js` captures application and error logs.
- `src/middlewares/requestLogger.js` traces HTTP requests.
- `src/modules/audit/auditService.js` adds Prisma extensions that record CREATE, UPDATE, and DELETE events into `AuditLog`.
- Audit context is propagated from the auth middleware so entity changes can be attributed to the authenticated user.

This is especially important for schedule generation, publication, assignment updates, and administrative CRUD operations.

## Security

| Control | Description |
| --- | --- |
| JWT | Tokens are issued at login and verified on protected routes. |
| RBAC | Role guards restrict routes by `ADMIN`, `PROCTOR`, and `STUDENT`. |
| Protected Routes | All major API groups require authentication except login and docs. |
| Role Guards | `roleGuard` and `strictRoleGuard` enforce access rules at the router layer. |

Additional protections include password hashing with bcrypt, CORS origin checking, validated request schemas, and standardized error handling.

## Backend Modules in Practice

The codebase is organized around the scheduling workflow:

- `auth` establishes the signed-in user and seeds default admin accounts.
- `scheduling` generates candidate assignments and evaluates quality.
- `schedules` stores and publishes the resulting schedule versions.
- `assignments` manages individual assignment rows.
- `roleDashboards`, `studentPortal`, and `proctorPortal` shape role-specific outputs.
- `schedulePdf` renders printable PDF reports for administrators, students, and proctors.
- `notifications` and `studentNotifications` deliver schedule lifecycle updates.

## Future Enhancements

- AI-assisted optimization for more adaptive room and proctor selection.
- ML-based quality prediction to estimate schedule risk before publication.
- Advanced analytics for trend detection across semesters, centers, and workloads.
- Fine-grained schedule conflict explanations in the public API.
- More export formats such as CSV and ICS.

## Summary

This backend is the operational core of the Smart Multi-Center Exam Scheduling and Optimization System. It validates academic data, runs the hybrid scheduling engine, persists schedules and versions, publishes notifications, produces PDFs, and enforces secure role-based access across all user types.