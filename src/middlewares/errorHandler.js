import { sendResponse } from '../utils/response.js';

export const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  // Handle Zod Validation Errors gracefully
  if (err.name === 'ZodError') {
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      data: err.errors
    });
  }

  // Log error for internal tracking (skip verbose logging in testing)
  if (process.env.NODE_ENV !== 'test') {
    console.error(`[Error] ${statusCode} - ${message}\n${err.stack}`);
  }

  res.status(statusCode).json({
    success: false,
    message: message, // Standardized to "message" instead of "error"
    data: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
};
