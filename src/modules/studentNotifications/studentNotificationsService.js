import { AppError } from '../../utils/AppError.js';
import {
  NOTIFICATION_TYPES,
  listForUser,
  markAllReadForUser,
  markReadForUser,
} from '../notifications/notificationsService.js';

export const STUDENT_NOTIFICATION_TYPES = NOTIFICATION_TYPES;

const assertStudent = (user) => {
  if (!user?.studentId) {
    throw new AppError('Student profile not found for this user.', 404);
  }
  return user.studentId;
};

const mapStudentNotification = (notification, studentId) => ({
  ...notification,
  studentId,
});

export const listForStudent = async (user, query = {}) => {
  const studentId = assertStudent(user);
  const result = await listForUser(user, query);
  return {
    ...result,
    notifications: result.notifications.map((notification) => mapStudentNotification(notification, studentId)),
  };
};

export const markRead = async (user, notificationId) => {
  const studentId = assertStudent(user);
  const notification = await markReadForUser(user, notificationId);
  return mapStudentNotification(notification, studentId);
};

export const markAllRead = async (user) => {
  assertStudent(user);
  return markAllReadForUser(user);
};
