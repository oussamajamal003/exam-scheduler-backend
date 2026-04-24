import { sendResponse } from '../utils/response.js';
import logger from '../utils/logger.js';

export const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  // Handle Zod Validation Errors gracefully
  if (err.name === 'ZodError') {
    logger.warn(`Zod Validation Error: ${JSON.stringify(err.errors)}`, req);
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      data: err.errors
    });
  }

  if (err.code === 'P2002') {
    statusCode = 409;

    const targetFields = Array.isArray(err.meta?.target)
      ? err.meta.target.filter(Boolean).join(', ')
      : '';

    message = targetFields
      ? `A record with this ${targetFields} already exists.`
      : 'A record with the same values already exists.';
  }

  // Log error for internal tracking (skip verbose logging in testing)
  if (process.env.NODE_ENV !== 'test') {
    logger.error(`[Error] ${statusCode} - ${message}`, err.stack, req);
  }

  res.status(statusCode).json({
    success: false,
    message: message, // Standardized to "message" instead of "error"
    data: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
};
