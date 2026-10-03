// Zod request-body/query contracts for `/users` (contracts/users.md, User
// Story 3 — specs/001-company-user-auth/orchestration-plan.md). "One
// contract" (Constitution rule 5): both the NestJS API (via `nestjs-zod`'s
// `createZodDto`, wrapped in apps/api/src/modules/users/users.controller.ts
// rather than here, same reasoning as `auth.schema.ts`/`companies.schema.ts`)
// and the mobile app's `react-hook-form` resolvers import these same
// schemas.

import { z } from 'zod';

import { passwordPolicySchema } from './companies.schema';
import { RoleKey, userStatusSchema } from './enums';

/**
 * `role` on `POST /users` is deliberately narrower than the full
 * `roleKeySchema` (apps/api's `@Roles()` vocabulary, which also contains
 * `SYSTEM_ADMIN`) — gap found during plan review: a Company Admin must
 * never be able to mint a System Admin through this endpoint.
 */
export const TENANT_ASSIGNABLE_ROLE_KEYS = [
  RoleKey.COMPANY_ADMIN,
  RoleKey.MANAGER,
  RoleKey.MARKETING_EXECUTIVE,
  RoleKey.EMPLOYEE,
] as const;

export const tenantAssignableRoleKeySchema = z.enum(
  TENANT_ASSIGNABLE_ROLE_KEYS,
);

export type TenantAssignableRoleKey = z.infer<
  typeof tenantAssignableRoleKeySchema
>;

/** `monthlySalary`/`halfDayRate` — "decimal as string" per contracts/users.md. */
const decimalStringSchema = z
  .string()
  .regex(
    /^\d{1,10}(\.\d{1,2})?$/,
    'Must be a decimal number with at most 2 decimal places.',
  );

/** `rateEffectiveFrom` — "ISO date" per contracts/users.md (date only, no time component). */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be an ISO date (YYYY-MM-DD).');

/**
 * `halfDayRate` and `rateEffectiveFrom` are a pair — contracts/users.md
 * requires `rateEffectiveFrom` "if halfDayRate is present", and the reverse
 * (a bare `rateEffectiveFrom` with no rate) is equally meaningless. Shared
 * by `createUserSchema` and `updateUserSchema` via `.superRefine()`.
 */
function checkRatePair(
  value: { halfDayRate?: string; rateEffectiveFrom?: string },
  ctx: z.RefinementCtx,
): void {
  const hasRate = value.halfDayRate !== undefined;
  const hasEffectiveFrom = value.rateEffectiveFrom !== undefined;
  if (hasRate !== hasEffectiveFrom) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'halfDayRate and rateEffectiveFrom must be supplied together.',
      path: [hasRate ? 'rateEffectiveFrom' : 'halfDayRate'],
    });
  }
}

/**
 * `POST /users` request body (contracts/users.md). FR-017's cross-field
 * rule: `username`/`temporaryPassword`/`mobile` are all required when
 * `role != EMPLOYEE` and all forbidden when `role == EMPLOYEE` — checked
 * via `.superRefine()` rather than Zod's own `.optional()` per-field typing,
 * since the requirement depends on the sibling `role` field.
 */
export const createUserSchema = z
  .object({
    name: z.string().min(1).max(200),
    email: z.string().email().max(200).optional(),
    role: tenantAssignableRoleKeySchema,
    status: userStatusSchema.default('ACTIVE'),
    // From a prior POST /files/avatars upload (contracts/files.md gap #1) —
    // never a bare multipart field on this JSON endpoint.
    photoFileId: z.string().min(1).optional(),
    monthlySalary: decimalStringSchema.optional(),
    halfDayRate: decimalStringSchema.optional(),
    rateEffectiveFrom: isoDateSchema.optional(),
    // Required only when role != EMPLOYEE (FR-017):
    username: z.string().min(1).max(64).optional(),
    temporaryPassword: passwordPolicySchema.optional(),
    mobile: z.string().min(1).max(32).optional(),
  })
  .superRefine((value, ctx) => {
    checkRatePair(value, ctx);

    const isEmployee = value.role === RoleKey.EMPLOYEE;
    const loginFields: Array<
      ['username' | 'temporaryPassword' | 'mobile', string | undefined]
    > = [
      ['username', value.username],
      ['temporaryPassword', value.temporaryPassword],
      ['mobile', value.mobile],
    ];

    for (const [field, fieldValue] of loginFields) {
      const present = fieldValue !== undefined && fieldValue.length > 0;
      if (isEmployee && present) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${field} must not be set when role is EMPLOYEE.`,
          path: [field],
        });
      }
      if (!isEmployee && !present) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${field} is required when role is not EMPLOYEE.`,
          path: [field],
        });
      }
    }
  });

export type CreateUserInput = z.infer<typeof createUserSchema>;

/**
 * `PATCH /users/:id` request body — every field optional (contracts/users
 * .md). `role` is deliberately absent: "not patchable here in this slice."
 */
export const updateUserSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    email: z.string().email().max(200).optional(),
    status: userStatusSchema.optional(),
    photoFileId: z.string().min(1).optional(),
    monthlySalary: decimalStringSchema.optional(),
    halfDayRate: decimalStringSchema.optional(),
    rateEffectiveFrom: isoDateSchema.optional(),
  })
  .superRefine(checkRatePair);

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/** `POST /users/:id/salary-rates` request body — both fields required (contracts/users.md). */
export const salaryRateSchema = z.object({
  halfDayRate: decimalStringSchema,
  rateEffectiveFrom: isoDateSchema,
});

export type SalaryRateInput = z.infer<typeof salaryRateSchema>;

/** `GET /users` query string (contracts/users.md). */
export const listUsersQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().min(1).max(200).optional(),
  role: tenantAssignableRoleKeySchema.optional(),
  status: userStatusSchema.optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
