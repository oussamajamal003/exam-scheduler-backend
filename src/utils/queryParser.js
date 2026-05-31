/**
 * Standard list-query parser.
 *
 * Accepted parameters (all optional):
 *   page            – integer ≥ 1  (default: 1)
 *   pageSize        – integer 1-200 (new canonical name)
 *   limit           – integer 1-200 (legacy alias, pageSize takes precedence)
 *   search          – string        (trimmed; empty string treated as absent)
 *   sortField       – string        (whitelisted per entity in buildOrderBy)
 *   sortDirection   – 'asc'|'desc'  (default: 'asc')
 */
export const parseListQuery = (query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.pageSize ?? query.limit) || 10));
  const skip = (page - 1) * limit;
  const sortDirection = query.sortDirection === 'desc' ? 'desc' : 'asc';
  const sortField =
    typeof query.sortField === 'string' ? query.sortField.trim() || undefined : undefined;
  const search =
    typeof query.search === 'string' ? query.search.trim() || undefined : undefined;
  return { page, limit, skip, sortDirection, sortField, search };
};

/**
 * Resolves a Prisma orderBy clause from a whitelisted sort-field map.
 *
 * @param {string|undefined}  sortField     – requested sort field name
 * @param {'asc'|'desc'}      sortDirection – sort direction
 * @param {Record<string, (dir: string) => object | object[]>} allowed
 *   Map of field name → function that receives the direction and returns a
 *   Prisma-compatible orderBy object or array.
 * @param {object | object[]} defaultOrder  – fallback when sortField is absent/unknown
 */
export const buildOrderBy = (sortField, sortDirection, allowed, defaultOrder) => {
  if (sortField && Object.prototype.hasOwnProperty.call(allowed, sortField)) {
    return allowed[sortField](sortDirection);
  }
  return defaultOrder;
};

/**
 * Builds the standard meta envelope for list responses.
 * Includes both `limit` (legacy) and `pageSize` (new) so clients can use either.
 */
export const buildMeta = (total, page, limit) => ({
  total,
  totalCount: total,
  page,
  limit,
  pageSize: limit,
  totalPages: Math.ceil(total / limit) || 1,
});

/**
 * Parses a search string into a Prisma date range filter.
 * Supports:
 *   "2025-04-15" → single day  (gte start-of-day, lte end-of-day)
 *   "2025-04"    → full month
 *   "2025"       → full year
 * Returns null if the string doesn't match any of those patterns.
 */
export const parseSearchDateRange = (search) => {
  const s = String(search).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return { gte: new Date(`${s}T00:00:00.000Z`), lte: new Date(`${s}T23:59:59.999Z`) };
  }
  if (/^\d{4}-\d{2}$/.test(s)) {
    const [y, mo] = s.split('-').map(Number);
    return { gte: new Date(Date.UTC(y, mo - 1, 1)), lte: new Date(Date.UTC(y, mo, 0, 23, 59, 59, 999)) };
  }
  if (/^\d{4}$/.test(s)) {
    const y = parseInt(s, 10);
    return { gte: new Date(Date.UTC(y, 0, 1)), lte: new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999)) };
  }
  return null;
};
