/**
 * Custom Error class to standardise operational errors.
 * Extends the built-in Error class to add a statusCode field.
 */
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;

    // Captures the stack trace, excluding the constructor call from it
    Error.captureStackTrace(this, this.constructor);
  }
}

export { AppError };
export default AppError;
