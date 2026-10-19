// Zod request contracts for the visit critical path (contracts/visits.md,
// 006-visit-outcomes). "One contract" (Constitution rule 5): both the NestJS
// API (via `nestjs-zod`'s `createZodDto`, wrapped in the controller) and the
// mobile app's outcome screens use these.
//
// EVERYTHING BELOW IS ABSENT ON PURPOSE, so a client that sends one fails
// validation rather than having it silently dropped (CLAUDE.md Constitution
// rule 1 — the server owns the truth, FR-023):
//   * `distanceMeters`, `isExceedRange`, `flags`, `reviewStatus` — the
//     verdict. Computed solely by the server; the device cannot influence
//     what it is measured as.
//   * `effectiveRadiusMeters` and the shop's coordinates — what the verdict
//     is measured against. Frozen on the stop, never client-supplied.
//   * `brandLabel`, `reasonLabel` — snapshots the server takes from the
//     masters, so a client cannot record a label that was never real.
//   * `totalQuantity`, `brandCount` — derived from the submitted lines, so a
//     client cannot assert a total that disagrees with its own lines.
//
// `capturedAt`/`submittedAt` are the DEVICE'S CLAIMS, kept for later quality
// checks. The authoritative time is always the server's `receivedAt`.

import { z } from 'zod';

/** The position reading every field command carries. */
const positionFields = {
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  // Recorded, never a reason to reject a VISIT (FR-014). Pin capture is the
  // one exception, and it enforces that server-side, not here.
  accuracyMeters: z.number().int().min(0),
  capturedAt: z.string().datetime(),
};

const orderLineSchema = z
  .object({
    brandId: z.string().min(1),
    quantity: z.number().int().min(0),
  })
  .strict();

/**
 * `POST /visits` request body (contracts/visits.md).
 *
 * The cross-field rules live in `superRefine` rather than being split across
 * two schemas because the outcome decides which half of the body is legal,
 * and a client sending an order's `lines` alongside a no-order's `reasonId`
 * should be told it is contradictory rather than having one half ignored.
 */
export const submitVisitSchema = z
  .object({
    stopId: z.string().min(1),
    sampleShown: z.boolean(),
    outcome: z.enum(['ORDER', 'NO_ORDER']),
    lines: z.array(orderLineSchema).optional(),
    reasonId: z.string().min(1).optional(),
    reasonText: z.string().trim().min(3).max(280).optional(),
    ...positionFields,
    submittedAt: z.string().datetime(),
    /**
     * Absent today: the installed geolocation library does not expose
     * Android's mock-location signal (research.md §5), so nothing produces
     * it. Kept in the contract so the server's handling is already correct
     * when a producer exists.
     */
    isMockLocation: z.boolean().optional(),
    /** Set by the device's outbox when replaying a held submission. */
    fromOfflineQueue: z.boolean().optional(),
  })
  // LOAD-BEARING, not tidiness. Zod STRIPS unknown keys by default, which
  // would silently ignore a client-sent `distanceMeters`/`isExceedRange`/
  // `flags` rather than rejecting it — found live during verification, where
  // a body carrying `distanceMeters: 0` was accepted. CLAUDE.md rule 1 and
  // FR-023 require the request to FAIL, so that a client attempting to
  // influence the verdict is told no rather than quietly overruled.
  .strict()
  .superRefine((value, ctx) => {
    if (value.outcome === 'ORDER') {
      const lines = value.lines ?? [];

      if (lines.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['lines'],
          message: 'An order needs at least one line.',
        });
      }

      if (lines.length > 0 && !lines.some((line) => line.quantity > 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['lines'],
          message: 'At least one line must have a quantity above zero.',
        });
      }

      const brandIds = lines.map((line) => line.brandId);
      if (new Set(brandIds).size !== brandIds.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['lines'],
          message: 'The same brand cannot appear twice on one order.',
        });
      }

      if (value.reasonId !== undefined || value.reasonText !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['reasonId'],
          message: 'An order cannot carry a no-order reason.',
        });
      }
      return;
    }

    // NO_ORDER
    if (value.reasonId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reasonId'],
        message: 'A no-order needs a reason.',
      });
    }

    if (value.lines !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lines'],
        message: 'A no-order cannot carry order lines.',
      });
    }
    // Whether `reasonText` is required depends on the chosen reason being the
    // company's system "Other" row, which only the server knows — so that
    // rule is enforced there, not here.
  });

export type SubmitVisitInput = z.infer<typeof submitVisitSchema>;

/**
 * `POST /shops/:id/pin` request body — an executive's first capture of a
 * shop's location (contracts/visits.md).
 *
 * `accuracyMeters` is validated for shape here but **gated** server-side
 * against the company's maximum: pin capture is the one place in the product
 * where a poor reading blocks rather than merely flags, because a bad pin
 * poisons every future visit measured against it (FR-031).
 */
export const capturePinSchema = z
  .object({
    ...positionFields,
    source: z.enum(['GPS', 'MAP_SEARCH', 'MANUAL_DRAG']),
  })
  // See submitVisitSchema — unknown keys must be rejected, not stripped.
  .strict();

export type CapturePinInput = z.infer<typeof capturePinSchema>;
