// Zod request-body/query contracts for `/companies` (contracts/companies.md,
// User Story 1 — specs/001-company-user-auth/orchestration-plan.md). "One
// contract" (Constitution rule 5): both the NestJS API (via `nestjs-zod`'s
// `createZodDto`, wrapped in apps/api/src/modules/companies/
// companies.controller.ts rather than here, same reasoning as
// `auth.schema.ts`) and any future System-Admin-facing client import these.

import { z } from 'zod';

import { companyStatusSchema } from './enums';

/**
 * Same password policy as FR-013 (at least 8 characters, at least one
 * letter and one digit) — the "differs from the user's current password"
 * half of FR-013 doesn't apply here: this is the *first* password ever set
 * for a brand-new admin, there is no prior password to differ from.
 */
export const passwordPolicySchema = z
  .string()
  .min(8)
  .max(128)
  .refine(
    (value) => /[A-Za-z]/.test(value) && /[0-9]/.test(value),
    'Password must be at least 8 characters and include at least one letter and one digit.',
  );

/**
 * The first `Company Admin`'s own details, nested inside `POST /companies`
 * (research.md #3 — company + first admin created atomically, one request).
 */
export const createCompanyAdminSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(200).optional(),
  username: z.string().min(1).max(64),
  temporaryPassword: passwordPolicySchema,
  mobile: z.string().min(1).max(32).optional(),
});

export type CreateCompanyAdminInput = z.infer<typeof createCompanyAdminSchema>;

/**
 * `POST /companies` request body. `code` is unique platform-wide and
 * immutable once set (FR-003); `timezone` defaults to "Asia/Kolkata" per
 * the contract, matching `CompanySettings`'s own default in
 * `prisma/schema.prisma`.
 */
export const createCompanySchema = z.object({
  code: z
    .string()
    .min(1)
    .max(32)
    .regex(
      /^[A-Za-z0-9_-]+$/,
      'Company code may only contain letters, digits, "_" and "-".',
    ),
  name: z.string().min(1).max(200),
  place: z.string().min(1).max(200).optional(),
  contactEmail: z.string().email().max(200).optional(),
  contactPhone: z.string().min(1).max(32).optional(),
  timezone: z.string().min(1).max(64).default('Asia/Kolkata'),
  admin: createCompanyAdminSchema,
});

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

/** `GET /companies` query string — cursor pagination. */
export const listCompaniesQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListCompaniesQuery = z.infer<typeof listCompaniesQuerySchema>;

/** `PATCH /companies/:id` request body — every field optional. */
export const updateCompanySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  place: z.string().min(1).max(200).optional(),
  contactEmail: z.string().email().max(200).optional(),
  contactPhone: z.string().min(1).max(32).optional(),
  status: companyStatusSchema.optional(),
});

export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
