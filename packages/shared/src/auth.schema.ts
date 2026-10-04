// Zod request-body contracts for the auth endpoints (contracts/auth.md):
// `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` (WU-05),
// plus `POST /auth/forgot-password`, `POST /auth/verify-otp`,
// `POST /auth/reset-password`, `POST /auth/change-password` (User Story 4).
// "One contract" (Constitution rule 5) — both the NestJS API (via
// `nestjs-zod`'s `createZodDto`, wrapped in
// apps/api/src/modules/auth/auth.controller.ts rather than here, so this
// package stays free of a NestJS-specific dependency that the mobile app
// has no use for) and the mobile app's `react-hook-form` resolvers import
// these same schemas.

import { z } from 'zod';

import { passwordPolicySchema } from './companies.schema';

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

/**
 * `POST /auth/forgot-password` request body (User Story 4, decision #3a).
 * `companyCode` is the identical optional field `loginSchema` already has
 * — same bounds, same "omitted only for a SYSTEM_ADMIN" semantics — added
 * here because `User.username` is only unique *within* a company (FR-006),
 * so a bare username has no well-defined target to reset without it.
 */
export const forgotPasswordSchema = z.object({
  companyCode: z.string().min(1).max(64).optional(),
  username: z.string().min(1).max(64),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/**
 * `POST /auth/verify-otp` request body. `code` is exactly 6 digits
 * (contracts/auth.md); `companyCode` is the same correction/semantics as
 * `forgotPasswordSchema` above.
 */
export const verifyOtpSchema = z.object({
  companyCode: z.string().min(1).max(64).optional(),
  username: z.string().min(1).max(64),
  code: z.string().regex(/^\d{6}$/, 'Code must be exactly 6 digits.'),
});

export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

/**
 * `POST /auth/reset-password` request body. `newPassword` reuses
 * `companies.schema.ts`'s `passwordPolicySchema` (FR-013: minimum 8
 * characters, at least one letter and one digit) plus a cross-field
 * `.refine()` confirming `newPassword === confirmPassword`. The
 * "differs from the current password" half of FR-013 needs the live
 * stored hash and cannot live in a Zod schema — enforced in `AuthService`
 * itself.
 */
export const resetPasswordSchema = z
  .object({
    resetToken: z.string().min(1),
    newPassword: passwordPolicySchema,
    confirmPassword: z.string().min(1).max(128),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: 'New password and confirm password must match.',
    path: ['confirmPassword'],
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/**
 * `POST /auth/change-password` request body — same FR-013 policy +
 * cross-field match as `resetPasswordSchema`, plus `currentPassword`
 * (verified against the stored hash by `AuthService`, not by this schema).
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordPolicySchema,
    confirmPassword: z.string().min(1).max(128),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: 'New password and confirm password must match.',
    path: ['confirmPassword'],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
