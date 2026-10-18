// Zod request-body/query contracts for `/beat-plans` (contracts/beat-plans.md,
// 003-beat-plans-crud). "One contract" (Constitution rule 5): both the
// NestJS API (via `nestjs-zod`'s `createZodDto`, wrapped in
// apps/api/src/modules/beat-plans/beat-plans.controller.ts rather than here,
// same reasoning as `shops.schema.ts`) and the mobile app's
// `BeatPlanFormScreen` import these same schemas.
//
// `sequence` never appears anywhere below — it's server-only, always derived
// from `shopIds`' array position (data-model.md's Validation rules,
// CLAUDE.md Constitution rule 1). The only client-facing shop-list input is
// the plain ordered `shopIds: string[]`.

import { z } from 'zod';

/** 1 = Mon … 7 = Sun (Architecture's own convention). Distinct values only — a day can't be selected twice. */
const workingDaysSchema = z
  .array(z.number().int().min(1).max(7))
  .refine((days) => new Set(days).size === days.length, {
    message: 'workingDays must not contain duplicate values.',
  });

/** Fields common to create and update. */
const beatPlanFieldsSchema = {
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  isActive: z.boolean().default(true),
  executiveId: z.string().min(1).optional(),
  workingDays: workingDaysSchema.default([]),
  shopIds: z.array(z.string().min(1)).default([]),
};

/** `POST /beat-plans` request body (contracts/beat-plans.md). */
export const createBeatPlanSchema = z.object(beatPlanFieldsSchema);

export type CreateBeatPlanInput = z.infer<typeof createBeatPlanSchema>;

/**
 * `PATCH /beat-plans/:id` request body — every field optional
 * (contracts/beat-plans.md). Omitting `shopIds` entirely means "leave the
 * shop list untouched"; an explicit `[]` fully clears it — both are valid,
 * distinguished by `'shopIds' in input` in the service, not by this schema.
 * `executiveId` additionally accepts an explicit `null` (unlike create's
 * create-only-ever-sets shape) so an edit can unassign a plan's executive
 * entirely, not just reassign it to someone else.
 */
export const updateBeatPlanSchema = z.object({
  code: beatPlanFieldsSchema.code.optional(),
  name: beatPlanFieldsSchema.name.optional(),
  isActive: z.boolean().optional(),
  executiveId: z.string().min(1).nullable().optional(),
  workingDays: workingDaysSchema.optional(),
  shopIds: z.array(z.string().min(1)).optional(),
});

export type UpdateBeatPlanInput = z.infer<typeof updateBeatPlanSchema>;

/** `GET /beat-plans` query string (contracts/beat-plans.md). */
export const listBeatPlansQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().min(1).max(200).optional(),
  assignment: z.enum(['ALL', 'UNASSIGNED']).optional(),
  // NOT `z.coerce.boolean()` — 002-shops-crud found live that
  // `Boolean("false")` is `true` (any non-empty string coerces truthy), so
  // `?isActive=false` would silently filter for ACTIVE plans instead of
  // inactive ones. Only the two literal query-string values are accepted.
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export type ListBeatPlansQuery = z.infer<typeof listBeatPlansQuerySchema>;
