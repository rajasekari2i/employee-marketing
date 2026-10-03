import { PrismaClient } from '@prisma/client';
import { RoleKey } from '@field-sales/shared';

/**
 * User Story 1 DoD item 2 (specs/001-company-user-auth/orchestration-plan
 * .md): given a brand-new `companyId`, inserts that company's four
 * tenant-scoped `Role` rows. Does NOT touch the platform-wide
 * `SYSTEM_ADMIN` role — that one row (`companyId: null`) is seeded once by
 * `prisma/seed.ts` (WU-05) and is never re-created or modified here.
 *
 * Permission strings follow Architecture §6's `resource:action:scope`
 * format (scopes: `own | team | company | platform`), translated from PRD
 * §3's role/capability matrix — the exact strings aren't spelled out there,
 * so these are a best-judgment but deliberate translation, kept consistent
 * with the one precedent already in this codebase (`prisma/seed.ts`'s
 * `SYSTEM_ADMIN_PERMISSIONS`, e.g. `'companies:create:platform'`):
 *
 *   - `COMPANY_ADMIN` and `MANAGER` act across their whole company, hence
 *     scope `company` for nearly everything they can touch.
 *   - `MANAGER`'s one PRD-called-out exception is "Reports and CSV export:
 *     R (own team)" — scope `team`, not `company`, for that one resource.
 *   - `MARKETING_EXECUTIVE` only ever acts on their own assigned slice
 *     (own shops, own beat, own visits, own totals) — scope `own`
 *     throughout, and — per PRD §3's explicit rule and CLAUDE.md's
 *     standing structural requirement — NEVER granted anything under
 *     `visit-range` (distanceMeters/isExceedRange/quality flags).
 *   - `EMPLOYEE` never signs in (FR-008/no `passwordHash`); its permissions
 *     exist only to describe what it is a *subject* of (attendance, salary
 *     runs), not anything it can call itself.
 */
export interface CompanyRoleDefinition {
  key: Exclude<RoleKey, 'SYSTEM_ADMIN'>;
  label: string;
  permissions: string[];
}

export const COMPANY_ROLE_DEFINITIONS: readonly CompanyRoleDefinition[] = [
  {
    key: RoleKey.COMPANY_ADMIN,
    label: 'Company Admin',
    permissions: [
      'companies:read:company',
      'company-settings:read:company',
      'company-settings:update:company',
      'users:create:company',
      'users:read:company',
      'users:update:company',
      'users:deactivate:company',
      'self:update:own',
      'brands:create:company',
      'brands:read:company',
      'brands:update:company',
      'brands:deactivate:company',
      'reasons:create:company',
      'reasons:read:company',
      'reasons:update:company',
      'reasons:deactivate:company',
      'shops:create:company',
      'shops:read:company',
      'shops:update:company',
      'shops:deactivate:company',
      'shop-pins:create:company',
      'shop-pins:update:company',
      'shop-pin-changes:update:company',
      'beat-plans:create:company',
      'beat-plans:read:company',
      'beat-plans:update:company',
      'beat-plans:deactivate:company',
      'daily-assignments:read:company',
      'beat-days:read:company',
      'visits:read:company',
      'visit-range:read:company',
      'orders:update:company',
      'attendance:read:company',
      'attendance:update:company',
      'salary-runs:create:company',
      'salary-runs:read:company',
      'salary-runs:update:company',
      'salary-runs:finalise:company',
      'reports:read:company',
      'audit:read:company',
    ],
  },
  {
    key: RoleKey.MANAGER,
    label: 'Manager',
    permissions: [
      'company-settings:read:company',
      'users:read:company',
      'self:update:own',
      'brands:read:company',
      'reasons:read:company',
      'shops:read:company',
      'shop-pins:update:company',
      'shop-pin-changes:approve:company',
      'beat-plans:read:company',
      'daily-assignments:read:company',
      'extra-shops:create:company',
      'beat-days:read:company',
      'visits:read:company',
      'visit-range:read:company',
      'orders:update:company',
      'attendance:create:company',
      'attendance:read:company',
      'attendance:update:company',
      'salary-runs:read:company',
      'reports:read:team',
    ],
  },
  {
    key: RoleKey.MARKETING_EXECUTIVE,
    label: 'Marketing Executive',
    permissions: [
      'self:update:own',
      'brands:read:own',
      'reasons:read:own',
      'shops:read:own',
      'shop-pins:create:own',
      'shop-pin-changes:create:own',
      'beat-plans:read:own',
      'daily-assignments:read:own',
      'extra-shops:create:own',
      'beat-days:create:own',
      'visits:create:own',
      'reports:read:own',
    ],
  },
  {
    key: RoleKey.EMPLOYEE,
    label: 'Employee',
    permissions: ['attendance:read:own', 'salary-runs:read:own'],
  },
];

/** The subset of a Prisma (transaction) client this helper needs. */
export type RoleSeedingClient = Pick<PrismaClient, 'role'>;

export interface SeededRole {
  id: string;
  key: Exclude<RoleKey, 'SYSTEM_ADMIN'>;
}

/**
 * Inserts the four `COMPANY_ROLE_DEFINITIONS` rows for `companyId`, inside
 * whatever transaction/client the caller passes in (`companies.service.ts`
 * calls this inside the same transaction that creates the `Company` row,
 * per DoD item 3 — one atomic insert for company + settings + roles +
 * first admin).
 *
 * `Role` is not one of `tenant.extension.ts`'s `TENANT_MODELS` (Architecture
 * §5's documented exemption list), so no RLS/CLS tenant-context dance is
 * needed here — a plain `create` per row with an explicit `companyId` is
 * correct and sufficient.
 *
 * Returns the created rows (id + key) so the caller can look up
 * `COMPANY_ADMIN`'s id without a second round-trip query.
 */
export async function seedCompanyRoles(
  client: RoleSeedingClient,
  companyId: string,
): Promise<SeededRole[]> {
  const created: SeededRole[] = [];

  for (const definition of COMPANY_ROLE_DEFINITIONS) {
    const role = await client.role.create({
      data: {
        key: definition.key,
        companyId,
        label: definition.label,
        permissions: definition.permissions,
        isSystem: true,
      },
    });
    created.push({
      id: role.id,
      key: role.key as CompanyRoleDefinition['key'],
    });
  }

  return created;
}
