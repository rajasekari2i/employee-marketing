// Zod request-body contracts for `/brands` and `/reasons`
// (contracts/masters.md, 004-brands-reasons-crud). "One contract"
// (Constitution rule 5): both the NestJS API (via `nestjs-zod`'s
// `createZodDto`, wrapped in the controllers rather than here, same
// reasoning as `shops.schema.ts`/`beat-plans.schema.ts`) and the mobile
// app's `BrandsReasonsListScreen` import these same schemas.
//
// Four fields are deliberately ABSENT from every schema below, so a client
// that sends one fails validation rather than having it silently dropped
// (CLAUDE.md Constitution rule 1 — the server owns the truth):
//   * `displayOrder` — always derived server-side from array position.
//   * `isSystem` / `requiresText` — set once, by the company-bootstrap path.
//   * `companyId` — injected from the request's CLS context, never input.
//
// Renaming IS supported (user request, 2026-10-19 — this reverses the
// earlier "no rename" scoping decision recorded in spec.md). Board 4.12 has
// no rename affordance of its own, so the screen edits a label in place in
// the row rather than adding a control the board does not draw.

import { z } from 'zod';

/**
 * A brand's or reason's label. Trimmed before validation AND before
 * storage, then bounded at 2–60 characters (data-model.md "Validation
 * rules"). The bound is a display-fit choice for board 4.12's 54px row —
 * deliberately distinct from the 3–280 character bound PRD FR-VISIT-08 sets
 * on the executive's free-text "Other" note, which is a different field in
 * a different feature.
 *
 * Uniqueness is NOT expressed here: it is per-company and case-insensitive,
 * so it needs a database lookup (the service) plus the functional unique
 * index in the migration, not a schema rule.
 */
const labelSchema = z.string().trim().min(2).max(60);

/** `POST /brands` request body (contracts/masters.md). */
export const createBrandSchema = z.object({ label: labelSchema });

export type CreateBrandInput = z.infer<typeof createBrandSchema>;

/** `POST /reasons` request body — identical to brands by design. */
export const createReasonSchema = z.object({ label: labelSchema });

export type CreateReasonInput = z.infer<typeof createReasonSchema>;

/**
 * Both update bodies: every field optional, only the provided ones change —
 * the same "partial patch" convention `updateShopSchema` and
 * `updateBeatPlanSchema` already established. An empty body is rejected
 * rather than silently doing nothing, so a client bug surfaces as a 400
 * instead of a successful no-op.
 *
 * Renaming to a label another row in the same list already uses is rejected
 * by the service (case-insensitively), exactly like create.
 */
const updateFields = {
  label: labelSchema.optional(),
  isActive: z.boolean().optional(),
};

const atLeastOneField = (value: Record<string, unknown>) =>
  Object.values(value).some((field) => field !== undefined);

const atLeastOneFieldMessage = {
  message: 'Provide at least one field to update.',
};

/** `PATCH /brands/:id` request body (contracts/masters.md). */
export const updateBrandSchema = z
  .object(updateFields)
  .refine(atLeastOneField, atLeastOneFieldMessage);

export type UpdateBrandInput = z.infer<typeof updateBrandSchema>;

/** `PATCH /reasons/:id` request body — identical to brands by design. */
export const updateReasonSchema = z
  .object(updateFields)
  .refine(atLeastOneField, atLeastOneFieldMessage);

export type UpdateReasonInput = z.infer<typeof updateReasonSchema>;

/**
 * `PATCH /brands/order` and `PATCH /reasons/order` request body
 * (contracts/masters.md). `ids` is the COMPLETE ordered list of that
 * company's reorderable rows, first to last; the server renumbers every
 * row's `displayOrder` from its position here.
 *
 * "Exactly the reorderable set — every row once, nothing missing, nothing
 * extra" is enforced in the service, not here: it needs to compare against
 * what's actually stored for the caller's company, which a schema cannot
 * see. For reasons, the system "Other" row is excluded from that set and
 * must not appear in `ids` (FR-013).
 */
export const reorderSchema = z.object({
  ids: z.array(z.string().min(1)),
});

export type ReorderInput = z.infer<typeof reorderSchema>;
