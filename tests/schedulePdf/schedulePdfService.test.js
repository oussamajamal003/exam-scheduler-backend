import { describe, expect, it } from '@jest/globals';
import { groupAssignmentsByExamSlot } from '../../src/modules/schedulePdf/schedulePdfService.js';

const makeAssignment = ({ examId, timeSlotId, roomName, centerName, proctorName, startTime }) => ({
  examId,
  timeSlotId,
  roomId: `${roomName}-id`,
  proctorId: `${proctorName}-id`,
  timeSlot: {
    startTime,
    date: startTime,
  },
  exam: {
    courseOffering: {
      course: {
        code: examId.toUpperCase(),
        title: `Course ${examId}`,
      },
      registrations: [],
      expectedStudents: 0,
    },
  },
  room: {
    name: roomName,
    center: { name: centerName },
  },
  proctor: {
    user: { name: proctorName },
  },
});

describe('groupAssignmentsByExamSlot', () => {
  it('collapses duplicate exam-slot rows into a single logical PDF row', () => {
    const grouped = groupAssignmentsByExamSlot([
      makeAssignment({
        examId: 'exam-1',
        timeSlotId: 'slot-1',
        roomName: 'Room A',
        centerName: 'Center 1',
        proctorName: 'Proctor 1',
        startTime: '2026-06-01T08:00:00.000Z',
      }),
      makeAssignment({
        examId: 'exam-1',
        timeSlotId: 'slot-1',
        roomName: 'Room B',
        centerName: 'Center 1',
        proctorName: 'Proctor 2',
        startTime: '2026-06-01T08:00:00.000Z',
      }),
      makeAssignment({
        examId: 'exam-2',
        timeSlotId: 'slot-2',
        roomName: 'Room C',
        centerName: 'Center 2',
        proctorName: 'Proctor 3',
        startTime: '2026-06-01T10:00:00.000Z',
      }),
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toMatchObject({
      examId: 'exam-1',
      timeSlotId: 'slot-1',
      assignmentRowCount: 2,
      roomDisplayName: '2 rooms assigned',
      proctorDisplayName: '2 proctors assigned',
      centerDisplayName: 'Center 1',
    });
    expect(grouped[1]).toMatchObject({
      examId: 'exam-2',
      timeSlotId: 'slot-2',
      assignmentRowCount: 1,
      roomDisplayName: 'Room C',
      proctorDisplayName: 'Proctor 3',
      centerDisplayName: 'Center 2',
    });
  });
});