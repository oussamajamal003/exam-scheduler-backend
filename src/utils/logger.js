import fs from 'fs';
import path from 'path';

const LOGS_DIR = path.join(process.cwd(), 'logs');

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const appLogStream = fs.createWriteStream(path.join(LOGS_DIR, 'app.log'), { flags: 'a' });
const errorLogStream = fs.createWriteStream(path.join(LOGS_DIR, 'error.log'), { flags: 'a' });

const formatLog = (level, message, req = null) => {
  const timestamp = new Date().toISOString();
  
  let reqInfo = '';
  if (req) {
    const method = req.method || 'METHOD';
    const originalUrl = req.originalUrl || '/';
    const userId = req.user?.id ? `user:${req.user.id}` : 'guest';
    reqInfo = `${method} ${originalUrl} ${userId} `;
  }

  return `[${level}] ${timestamp} ${reqInfo}${message}\n`;
};

const writeLog = (level, message, req = null) => {
  const formattedMessage = formatLog(level, message, req);
  
  // Always log to app.log (including errors for chronological tracking)
  appLogStream.write(formattedMessage);
  
  // Terminal output for developers
  if (process.env.NODE_ENV !== 'test') {
    if (level === 'ERROR') process.stderr.write(formattedMessage);
    else process.stdout.write(formattedMessage);
  }
  
  // Also log errors to error.log
  if (level === 'ERROR') {
    errorLogStream.write(formattedMessage);
  }
};

const logger = {
  info: (message, req = null) => writeLog('INFO', message, req),
  warn: (message, req = null) => writeLog('WARN', message, req),
  error: (message, errorStack = null, req = null) => {
    const fullMessage = errorStack ? `${message} | Stack: ${errorStack}` : message;
    writeLog('ERROR', fullMessage, req);
  }
};

export default logger;
