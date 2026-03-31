/**
 * Helper function to catch Async errors in Express route handlers.
 * Wraps the route handler and passes any errors to the global error handler middleware.
 */
export const catchAsync = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
