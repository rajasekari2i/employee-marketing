import { PrismaClient } from '@prisma/client';
import { RoleKey } from '@field-sales/shared';

/**
 * The four non-`SYSTEM_ADMIN` `Role` rows, application-wide (one per `key`,
 * shared by every company — `Role` has no `companyId` at all; see
 * `prisma/schema.prisma`'s comment on the model). Seeded once, idempotently,
 * by `prisma/seed.ts` (the same deploy-time bootstrap that creates
 * `SYSTEM_ADMIN`) — not per company. `companies.service.ts`'s `create()`
 * looks these up by `key` for the new company's first admin; it does not
 * create them.
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
export interface RoleDefinition {
  key: Exclude<RoleKey, 'SYSTEM_ADMIN'>;
  label: string;
  permissions: string[];
}

export const ROLE_DEFINITIONS: readonly RoleDefinition[] = [
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

/**
 * Ensures all four `ROLE_DEFINITIONS` rows exist (find-or-create per `key`,
 * same idempotent posture as `prisma/seed.ts`'s `ensureSystemAdminRole()` —
 * safe to re-run on every deploy/restart). Called once from `prisma/seed.ts`;
 * `companies.service.ts` only reads these rows, never creates them.
 */
export async function ensureGlobalRoles(
  client: RoleSeedingClient,
): Promise<void> {
  for (const definition of ROLE_DEFINITIONS) {
    const existing = await client.role.findUnique({
      where: { key: definition.key },
    });
    if (existing) {
      continue;
    }
    await client.role.create({
      data: {
        key: definition.key,
        label: definition.label,
        permissions: definition.permissions,
        isSystem: true,
      },
    });
  }
}
