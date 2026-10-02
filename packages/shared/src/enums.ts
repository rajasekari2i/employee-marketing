// Mirrors of the Prisma enums declared in `apps/api/prisma/schema.prisma`
// (WU-02/T007). This file is the "one contract" (Constitution rule 5) copy
// that both the NestJS API and the React Native app import instead of each
// redeclaring the same string literals — keep these in lockstep with the
// schema by hand; there is no automated drift check yet (CLAUDE.md's
// no-tests-for-now policy defers that).
//
// Only the three enums WU-04 guards/decorators actually need to reference at
// the HTTP boundary are mirrored here (`RoleKey`, `UserStatus`,
// `CompanyStatus`). `PhotoKind` is schema-only until the files slice (WU-06)
// needs it at this layer.

import { z } from 'zod';

/**
 * `apps/api/prisma/schema.prisma`'s `RoleKey` enum — the five release-1
 * roles (BRD §2). Used by `@Roles()` (apps/api/src/common/decorators/
 * roles.decorator.ts) and the access-token `role` claim.
 */
export const RoleKey = {
  SYSTEM_ADMIN: 'SYSTEM_ADMIN',
  COMPANY_ADMIN: 'COMPANY_ADMIN',
  MANAGER: 'MANAGER',
  MARKETING_EXECUTIVE: 'MARKETING_EXECUTIVE',
  EMPLOYEE: 'EMPLOYEE',
} as const;

export type RoleKey = (typeof RoleKey)[keyof typeof RoleKey];

export const roleKeySchema = z.enum([
  RoleKey.SYSTEM_ADMIN,
  RoleKey.COMPANY_ADMIN,
  RoleKey.MANAGER,
  RoleKey.MARKETING_EXECUTIVE,
  RoleKey.EMPLOYEE,
]);

/** `apps/api/prisma/schema.prisma`'s `UserStatus` enum. */
export const UserStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;

export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const userStatusSchema = z.enum([
  UserStatus.ACTIVE,
  UserStatus.INACTIVE,
]);

/** `apps/api/prisma/schema.prisma`'s `CompanyStatus` enum. */
export const CompanyStatus = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;

export type CompanyStatus = (typeof CompanyStatus)[keyof typeof CompanyStatus];

export const companyStatusSchema = z.enum([
  CompanyStatus.ACTIVE,
  CompanyStatus.SUSPENDED,
]);
