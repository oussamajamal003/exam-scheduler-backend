import { verifyToken } from '../utils/jwt.js';
import { auditContext } from './auditContext.js';
import { findUserById } from '../models/userModel.js';
import { normalizeRole } from '../guards/roleGuard.js';

export const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Access denied. No token provided.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyToken(token);
    const user = await findUserById(decoded.id);

    if (!user) {
      return res.status(401).json({ success: false, error: 'User no longer exists.' });
    }

    const role = normalizeRole(user.role);

    if (!role) {
      return res.status(403).json({ success: false, error: 'Invalid user role.' });
    }

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role,
      dbRole: user.role,
      studentId: user.student?.id || null,
      proctorId: user.proctor?.id || null,
    };
    
    auditContext.run({ userId: user.id }, () => {
      next();
    });
  } catch (error) {
    res.status(403).json({ success: false, error: 'Invalid or expired token.' });
  }
};


export const restrictTo = (...roles) => {
  const allowedRoles = roles.map(normalizeRole).filter(Boolean);

  return (req, res, next) => {
    const userRole = normalizeRole(req.user?.role);

    if (!userRole || (!allowedRoles.includes(userRole) && userRole !== 'ADMIN')) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to perform this action',
      });
    }
    next();
  };
};
