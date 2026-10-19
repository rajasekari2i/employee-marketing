// Zod request contracts for adding an extra shop to today's route
// (contracts/extra-shops.md, 007-extra-shops). "One contract"
// (Constitution rule 5): both the NestJS API (via `nestjs-zod`'s
// `createZodDto`, wrapped in the controller) and the mobile app's board-1.4
// picker use these.
//
// EVERYTHING BELOW IS ABSENT ON PURPOSE, so a client that sends one fails
// validation with a 400 rather than having it silently dropped (CLAUDE.md
// Constitution rule 1 — the server owns the truth, FR-022). Slice 006 found
// this exact hole live; `.strict()` is what closes it:
//   * `sequence`, `source`, `status` — where the stop sits on the day and
//     where it came from. The server appends it and tags it `EXEC_EXTRA`.
//   * `effectiveRadiusMeters`, `shopLatitude`, `shopLongitude` — what a
//     later visit is measured against, frozen by the server at creation.
//   * `addedByUserId`, `addedAt` — who and when. Taken from the JWT and the
//     server clock, never from the body.
//   * `locationStatus` — whether a created shop's pin is approved. Decided
//     by the company's auto-approve setting, not by the device (FR-018).
//   * `distanceMeters` — the device never computes a distance for any
//     purpose, cosmetic or otherwise.
//
// `shopCode` is absent from `newShopSchema` for a different reason: it is
// required and unique per company, but asking someone standing in front of a
// shop to invent a unique code is a bad field interaction and a collision
// waiting to happen. The server generates one and retries; the Company Admin
// can rename it during review (research.md §6).

import { z } from 'zod';

/**
 * `GET /shops/nearby` query (contracts/extra-shops.md).
 *
 * `excludeAssignment` is the day whose stops are excluded — FR-EXTRA-08, and
 * what stops the picker being used to range-find a stop the executive is
 * about to visit. It must be the caller's OWN assignment; the server returns
 * 404 otherwise.
 */
export const nearbyShopsQuerySchema = z
  .object({
    excludeAssignment: z.string().min(1),
    /**
     * Omitted TOGETHER when the device has no fix — the list then sorts by
     * name and the screen shows no distances. A missing position degrades
     * this screen rather than blocking it.
     */
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    search: z.string().min(1).max(200).optional(),
    /** The architecture's hard cap for this query is 200 (§8). */
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  // A query carrying a field the server owns must be a 400, not a silent
  // drop — the same discipline the bodies below use.
  .strict()
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), {
    message: 'lat and lng must be supplied together',
  });

export type NearbyShopsQuery = z.infer<typeof nearbyShopsQuerySchema>;

/**
 * A shop the executive is creating from the field (FR-016 … FR-018).
 *
 * The position is the executive's own, pre-filled by the form. It becomes
 * the shop's location, captured as `GPS` and attributed to them — and it is
 * NOT auto-approved unless the company says so, because FR-018 requires the
 * shop to be identifiable to the Company Admin as awaiting confirmation.
 */
const newShopSchema = z
  .object({
    name: z.string().min(1).max(200),
    ownerName: z.string().min(1).max(200).optional(),
    phone: z.string().min(1).max(32).optional(),
    addressLine1: z.string().min(1).max(200).optional(),
    city: z.string().min(1).max(100).optional(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    /** Recorded, and gated server-side against the company's maximum. */
    accuracyMeters: z.number().int().min(0),
    /** The device's claim. The server's clock remains authoritative. */
    capturedAt: z.string().datetime(),
  })
  .strict();

/**
 * `POST /assignments/:id/stops` request body (contracts/extra-shops.md).
 *
 * Exactly one of `shopId` and `newShop`. The two are one endpoint rather
 * than two because FR-017 requires the shop and its stop to arrive together
 * — two calls from the device could leave a shop created and never added,
 * which is the orphan the "one transaction" rule exists to prevent.
 */
export const addExtraStopSchema = z
  .object({
    shopId: z.string().min(1).optional(),
    newShop: newShopSchema.optional(),
    /**
     * Set by the outbox when this add is a queued item being drained, so the
     * server can tell a live add from one recorded minutes or hours ago.
     */
    fromOfflineQueue: z.boolean().optional(),
  })
  // See the header — unknown keys must be rejected, not stripped.
  .strict()
  .refine((v) => (v.shopId === undefined) !== (v.newShop === undefined), {
    message: 'Supply exactly one of shopId or newShop',
  });

export type AddExtraStopInput = z.infer<typeof addExtraStopSchema>;
export type NewShopInput = z.infer<typeof newShopSchema>;
