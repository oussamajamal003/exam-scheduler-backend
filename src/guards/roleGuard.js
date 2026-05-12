const ADMIN_ALIASES = new Set(['ADMIN', 'TECH_ADMIN', 'SCHEDULING_ADMIN']);
const PROCTOR_ALIASES = new Set(['PROCTOR', 'SUPERVISOR']);
const VALID_ROLES = new Set(['ADMIN', 'PROCTOR', 'STUDENT']);

export const normalizeRole = (role) => {
  if (ADMIN_ALIASES.has(role)) return 'ADMIN';
  if (PROCTOR_ALIASES.has(role)) return 'PROCTOR';
  if (VALID_ROLES.has(role)) return role;
  return null;
};

export const toDatabaseRole = (role) => {
  const normalizedRole = normalizeRole(role);
  return normalizedRole;
};

export const roleGuard = (allowedRoles) => {
  const normalizedAllowedRoles = new Set(allowedRoles.map(normalizeRole).filter(Boolean));

  return (req, res, next) => {
    const userRole = normalizeRole(req.user?.role);

    if (!userRole || (!normalizedAllowedRoles.has(userRole) && userRole !== 'ADMIN')) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have the required permissions.',
      });
    }

    next();
  };
};