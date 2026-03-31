export const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  // Log error for internal tracking (skip verbose logging in testing)
  if (process.env.NODE_ENV !== 'test') {
    console.error(`[Error] ${statusCode} - ${message}\n${err.stack}`);
  }

  res.status(statusCode).json({
    success: false,
    error: message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
};
