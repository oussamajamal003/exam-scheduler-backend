import { config } from '../config/env.js';

/**
 * Example JWT Authorization Middleware
 * Verifies the token from the Authorization header
 */
export const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Access denied. No token provided.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // In a real application, you would use jsonwebtoken (jwt.verify)
    // const decoded = jwt.verify(token, config.jwtSecret);
    // req.user = decoded;
    next();
  } catch (error) {
    res.status(403).json({ success: false, error: 'Invalid or expired token.' });
  }
};
