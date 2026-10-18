// Zod request-body/query contracts for `/shops` (contracts/shops.md,
// 002-shops-crud). "One contract" (Constitution rule 5): both the NestJS
// API (via `nestjs-zod`'s `createZodDto`, wrapped in
// apps/api/src/modules/shops/shops.controller.ts rather than here, same
// reasoning as `users.schema.ts`) and the mobile app's `ShopFormScreen`
// import these same schemas.
//
// None of `locationStatus`, `geohash`, `locationCapturedAt/By`,
// `locationVerifiedAt/By` appear anywhere below — those are server-only
// (data-model.md Validation rules; CLAUDE.md Constitution rule 1). The only
// client-facing location input is `location: { latitude, longitude,
// source }`, which `ShopsService` turns into those server-computed fields.

import { z } from 'zod';

import { locationSourceSchema } from './enums';

/** Shared by `createShopSchema` and `updateShopSchema`. */
const shopLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  source: locationSourceSchema,
});

export type ShopLocationInput = z.infer<typeof shopLocationSchema>;

/**
 * Fields common to create and update. `beatPlanId` is deliberately absent
 * — a shop's beat-plan membership is never settable from this side. It's
 * owned by `BeatPlan`/`BeatPlanShop` (003-beat-plans-crud): added/removed
 * via a beat plan's own `shopIds` array (contracts/beat-plans.md). `GET
 * /shops`'s `beatPlanNames` is read-only, display-only data computed from
 * that same join — see `shops.service.ts`.
 */
const shopFieldsSchema = {
  shopCode: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  isActive: z.boolean().default(true),
  ownerName: z.string().min(1).max(200).optional(),
  phone: z.string().min(1).max(32).optional(),
  addressLine1: z.string().min(1).max(200).optional(),
  addressLine2: z.string().min(1).max(200).optional(),
  city: z.string().min(1).max(100).optional(),
  state: z.string().min(1).max(100).optional(),
  postalCode: z.string().min(1).max(16).optional(),
  verificationRadiusMeters: z.number().int().positive().optional(),
  location: shopLocationSchema.optional(),
};

/** `POST /shops` request body (contracts/shops.md). */
export const createShopSchema = z.object(shopFieldsSchema);

export type CreateShopInput = z.infer<typeof createShopSchema>;

/** `PATCH /shops/:id` request body — every field optional (contracts/shops.md). */
export const updateShopSchema = z.object({
  shopCode: shopFieldsSchema.shopCode.optional(),
  name: shopFieldsSchema.name.optional(),
  isActive: z.boolean().optional(),
  ownerName: shopFieldsSchema.ownerName,
  phone: shopFieldsSchema.phone,
  addressLine1: shopFieldsSchema.addressLine1,
  addressLine2: shopFieldsSchema.addressLine2,
  city: shopFieldsSchema.city,
  state: shopFieldsSchema.state,
  postalCode: shopFieldsSchema.postalCode,
  verificationRadiusMeters: shopFieldsSchema.verificationRadiusMeters,
  location: shopFieldsSchema.location,
});

export type UpdateShopInput = z.infer<typeof updateShopSchema>;

/** `GET /shops` query string (contracts/shops.md). */
export const listShopsQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().min(1).max(200).optional(),
  pinStatus: z.enum(['ALL', 'NO_PIN']).optional(),
  // NOT `z.coerce.boolean()` — found live during quickstart verification:
  // `Boolean("false")` is `true` (any non-empty string coerces truthy), so
  // `?isActive=false` would silently filter for ACTIVE shops instead of
  // inactive ones. Only the two literal query-string values are accepted.
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  // 003-beat-plans-crud follow-up: "All beats" filter on the directory —
  // now that BeatPlan exists, matches shops that are on this specific plan.
  beatPlanId: z.string().min(1).optional(),
});

export type ListShopsQuery = z.infer<typeof listShopsQuerySchema>;
