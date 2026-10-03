// Zod request-body contracts for the three auth endpoints WU-05 builds
// (contracts/auth.md): `POST /auth/login`, `POST /auth/refresh`,
// `POST /auth/logout`. "One contract" (Constitution rule 5) — both the
// NestJS API (via `nestjs-zod`'s `createZodDto`, wrapped in
// apps/api/src/modules/auth/auth.controller.ts rather than here, so this
// package stays free of a NestJS-specific dependency that the mobile app
// has no use for) and the mobile app's `react-hook-form` resolvers import
// these same schemas.
//
// `forgot-password`/`verify-otp`/`reset-password`/`change-password` are a
// later story (research.md #5 / orchestration-plan.md WU-05 scope note) —
// deliberately not added here yet.

import { z } from 'zod';

/**
 * `POST /auth/login` request body. `companyCode` is optional — omitted
 * only for a `SYSTEM_ADMIN` login, which is scoped to `companyId: null`
 * (research.md #1). Bounds are deliberately generous (this is a login
 * form, not a creation form) rather than a strict format check, which
 * belongs to whichever endpoint actually creates a `Company`/`User`.
 */
export const loginSchema = z.object({
  companyCode: z.string().min(1).max(64).optional(),
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** `POST /auth/refresh` request body — presents the opaque refresh token. */
export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export type RefreshInput = z.infer<typeof refreshSchema>;

/** `POST /auth/logout` request body — same shape as refresh, different endpoint/intent. */
export const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

export type LogoutInput = z.infer<typeof logoutSchema>;
