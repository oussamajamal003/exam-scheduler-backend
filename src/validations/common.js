import { z } from 'zod';

export const uuidParamSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

/**
 * Base Zod shape for all paginated list query params.
 * Use `.extend({...})` to add entity-specific filters per module.
 *
 * Supports both `pageSize` (new) and `limit` (legacy) — the service layer
 * resolves the effective limit via parseListQuery().
 */
export const listQueryBase = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  search: z.string().optional(),
  sortField: z.string().optional(),
  sortDirection: z.enum(['asc', 'desc']).optional().default('asc'),
});