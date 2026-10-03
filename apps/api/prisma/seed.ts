/**
 * One-time, idempotent deploy-time bootstrap (research.md #2 / WU-05 DoD
 * item 6). Ensures exactly one platform-wide `Role` row
 * (`key: SYSTEM_ADMIN`, `companyId: null`) exists, then ensures exactly
 * one `User` row with that role, built from `SEED_SYSTEM_ADMIN_USERNAME`/
 * `SEED_SYSTEM_ADMIN_PASSWORD`. Safe to re-run on every deploy/restart —
 * never duplicates either row.
 *
 * ---------------------------------------------------------------------
 * MUST be run against the superuser connection, never the live API's
 * own `app_user` connection:
 * ---------------------------------------------------------------------
 * This is a one-time, deploy-time script, not a live HTTP request — there
 * is no CLS context and no request pipeline here to set the
 * `app.is_system_context` session variable `ActiveAccountGuard`/
 * `AuthService` rely on for a `companyId IS NULL` row. Running this
 * through `app_user` (RLS-`FORCE`d on `users`, WU-03) would therefore see
 * *zero* existing rows on every run (always taking the `create` branch,
 * silently duplicating the row — a referential chaos the `@@unique`
 * index wouldn't even catch, see the comment on the `role`/`user` lookups
 * below for why) and would, worse, still coincidentally succeed at
 * *inserting* a `companyId: null` row only if the `WITH CHECK` clause's
 * `is_system_context` escape happened to be set — which it never is
 * here. Bypassing RLS and the Layer-1 tenant extension entirely for this
 * one trusted, non-request-driven action is correct (same reasoning as
 * `execution-state.md`'s "Established Patterns" entry for this exact
 * script).
 *
 * `apps/api/prisma/schema.prisma`'s `datasource db { url =
 * env("DATABASE_URL") }` means the Prisma CLI's `db seed` command (which
 * runs this file, via this package's `package.json` `"prisma": { "seed":
 * ... }` entry) reads whatever `DATABASE_URL` happens to be in the
 * environment at invocation time — there is no separate "seed connection"
 * concept in Prisma. Run this with:
 *
 *   DATABASE_URL="$MIGRATE_DATABASE_URL" pnpm --filter api exec prisma db seed
 *
 * NOT a bare `pnpm --filter api exec prisma db seed` (which would
 * silently use `.env`'s default `DATABASE_URL`, i.e. `app_user`, and hit
 * exactly the problem above).
 */
import { PrismaClient } from '@prisma/client';
import { loadEnv } from '@field-sales/shared';

import { hash } from '../src/infra/security/password';

const prisma = new PrismaClient();

const SYSTEM_ADMIN_ROLE_LABEL = 'System Admin';

/**
 * A reasonable first cut at the SYSTEM_ADMIN permission set, derived from
 * PRD §3's role/capability matrix (Companies: C R U D; Company settings:
 * R; Users and roles: C "first admin" only; Own profile/password: U;
 * Audit log: R) and Architecture §6's `resource:action:scope` format.
 * `roles.seed.ts` (a later work unit, T042) only creates this row "if it
 * doesn't already exist" — it will never overwrite whatever is picked
 * here, so this is the value that actually ships unless hand-edited
 * later; kept intentionally close to the PRD table rather than inventing
 * a broader set.
 */
const SYSTEM_ADMIN_PERMISSIONS = [
  'companies:create:platform',
  'companies:read:platform',
  'companies:update:platform',
  'companies:deactivate:platform',
  'company-settings:read:platform',
  'users:create:platform',
  'audit:read:platform',
  'self:update:own',
];

async function ensureSystemAdminRole(): Promise<{ id: string }> {
  // Deliberately NOT `prisma.role.upsert()` keyed on the `@@unique([companyId,
  // key])` compound index: Prisma's generated `RoleCompanyIdKeyCompoundUniqueInput`
  // types `companyId` as a non-nullable `string` (a known Prisma limitation
  // with nullable fields inside a compound unique index), so `{ companyId:
  // null, key: 'SYSTEM_ADMIN' }` is not even expressible as a `where` there —
  // and, separately, Postgres itself would never have enforced this
  // constraint across multiple `companyId IS NULL` rows anyway (`NULL <>
  // NULL` in a unique index, so two such rows could coexist). A plain
  // find-then-create is therefore not a workaround but the actually-correct
  // idempotency check for this one row.
  const existing = await prisma.role.findFirst({
    where: { companyId: null, key: 'SYSTEM_ADMIN' },
  });
  if (existing) {
    return existing;
  }

  return prisma.role.create({
    data: {
      key: 'SYSTEM_ADMIN',
      companyId: null,
      label: SYSTEM_ADMIN_ROLE_LABEL,
      permissions: SYSTEM_ADMIN_PERMISSIONS,
      isSystem: true,
    },
  });
}

async function ensureSystemAdminUser(
  roleId: string,
  username: string,
  plainPassword: string,
): Promise<void> {
  const passwordHash = await hash(plainPassword);

  // Same reasoning as ensureSystemAdminRole() above: `User`'s
  // `@@unique([companyId, username])` compound index has the identical
  // non-nullable-`companyId`-in-the-compound-type limitation, so this is a
  // find-then-create/update rather than `prisma.user.upsert()`.
  const existing = await prisma.user.findFirst({
    where: {
      companyId: null,
      username: { equals: username, mode: 'insensitive' },
    },
  });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, roleId, status: 'ACTIVE' },
    });
    console.log(
      `[seed] SYSTEM_ADMIN user "${username}" already existed — refreshed password hash/role/status.`,
    );
    return;
  }

  await prisma.user.create({
    data: {
      companyId: null,
      roleId,
      name: SYSTEM_ADMIN_ROLE_LABEL,
      username,
      passwordHash,
      status: 'ACTIVE',
    },
  });
  console.log(`[seed] Created SYSTEM_ADMIN user "${username}".`);
}

async function main(): Promise<void> {
  const env = loadEnv();

  if (/\bapp_user\b/.test(process.env.DATABASE_URL ?? '')) {
    console.warn(
      '[seed] WARNING: DATABASE_URL looks like the app_user (RLS-enforced, ' +
        'non-superuser) connection. This script must run against ' +
        'MIGRATE_DATABASE_URL instead — see the comment at the top of this ' +
        'file. Proceeding anyway, but this will likely fail or silently ' +
        'duplicate rows.',
    );
  }

  const role = await ensureSystemAdminRole();
  await ensureSystemAdminUser(
    role.id,
    env.SEED_SYSTEM_ADMIN_USERNAME,
    env.SEED_SYSTEM_ADMIN_PASSWORD,
  );
}

main()
  .catch((error: unknown) => {
    console.error('[seed] Failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
