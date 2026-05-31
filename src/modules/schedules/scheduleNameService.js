import { AppError } from '../../utils/AppError.js';

export const DUPLICATE_SCHEDULE_NAME_MESSAGE = 'A schedule with this name already exists. Choose a different name.';

export const normalizeScheduleName = (name) => (typeof name === 'string' ? name.trim() : '');

export const assertScheduleNameAvailable = async (client, scheduleName, options = {}) => {
  const normalizedScheduleName = normalizeScheduleName(scheduleName);
  const excludeId = options.excludeId ?? null;

  const existing = await client.$queryRaw`
    SELECT "id"
    FROM "schedules"
    WHERE LOWER(BTRIM("name")) = LOWER(${normalizedScheduleName})
      AND (${excludeId}::text IS NULL OR "id" <> ${excludeId})
    LIMIT 1
  `;

  if (existing.length > 0) {
    throw new AppError(DUPLICATE_SCHEDULE_NAME_MESSAGE, 409);
  }

  return normalizedScheduleName;
};

export const remapScheduleNameConflict = async (client, scheduleName, error, options = {}) => {
  if (error?.code === 'P2002') {
    throw new AppError(DUPLICATE_SCHEDULE_NAME_MESSAGE, 409);
  }

  try {
    await assertScheduleNameAvailable(client, scheduleName, options);
  } catch (availabilityError) {
    if (availabilityError instanceof AppError && availabilityError.statusCode === 409) {
      throw availabilityError;
    }
  }

  throw error;
};