import { verifyToken } from '../utils/jwt.js';
import { findUserById } from '../models/userModel.js';
import { normalizeRole } from './roleGuard.js';

export const authGuard = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. No token provided.',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyToken(token);
    const user = await findUserById(decoded.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User no longer exists.',
      });
    }

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: normalizeRole(user.role),
      dbRole: user.role,
      studentId: user.student?.id || null,
      proctorId: user.proctor?.id || null,
    };
    next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      message: 'Invalid or expired token.',
    });
  }
};

