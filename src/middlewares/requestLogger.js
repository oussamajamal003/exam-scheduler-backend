import logger from '../utils/logger.js';

export const requestLogger = (req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const elapsed = Date.now() - start;
    const { statusCode } = res;
    
    let message = '';
    let level = 'INFO';
    
    if (statusCode >= 500) {
      level = 'ERROR';
      message = `${statusCode} Server Error - ${elapsed}ms`;
    } else if (statusCode >= 400 && statusCode < 500) {
      level = 'WARN';
      message = `${statusCode} Client/Validation Error - ${elapsed}ms`;
    } else {
      level = 'INFO';
      message = `${statusCode} success - ${elapsed}ms`;
    }

    // Call logger with req explicitly to capture method, url, and user
    if (level === 'INFO') logger.info(message, req);
    if (level === 'WARN') logger.warn(message, req);
    if (level === 'ERROR') logger.error(message, null, req);
  });

  next();
};
