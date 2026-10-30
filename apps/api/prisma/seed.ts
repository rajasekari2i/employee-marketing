/**
 * One-time, idempotent deploy-time bootstrap (research.md #2 / WU-05 DoD
 * item 6). Ensures exactly one platform-wide `Role` row
 * (`key: SYSTEM_ADMIN`) exists, then ensures exactly one `User` row with
 * that role, built from `SEED_SYSTEM_ADMIN_USERNAME`/
 * `SEED_SYSTEM_ADMIN_PASSWORD`. Also ensures the four non-`SYSTEM_ADMIN`
 * `Role` rows exist (`roles.seed.ts`'s `ensureGlobalRoles()`) — `Role` is
 * application-wide, not per-company, so this is the one place all five
 * roles get created, ever. Safe to re-run on every deploy/restart — never
 * duplicates any row.
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
 *   cd apps/api
 *   DATABASE_URL="postgresql://postgres:<pwd>@localhost:5432/field_sales" \
 *     pnpm exec prisma db seed
 *
 * NOT a bare `pnpm --filter api exec prisma db seed` (which would
 * silently use `.env`'s default `DATABASE_URL`, i.e. `app_user`, and hit
 * exactly the problem above).
 *
 * The privileged URL is passed inline rather than stored as a second env
 * var: a superuser connection sitting in the app's own environment is one
 * copy-paste away from becoming the app's connection, and that failure is
 * silent — RLS simply stops applying.
 */
import { PrismaClient } from '@prisma/client';
import { loadEnv } from '@field-sales/shared';

import { hash } from '../src/infra/security/password';
import { ensureGlobalRoles } from '../src/modules/roles/roles.seed';

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
  // Find-then-create, not `prisma.role.upsert()` — same reasoning as
  // `roles.seed.ts`'s `ensureGlobalRoles()`: a re-run must never overwrite
  // permissions hand-edited after the first deploy.
  const existing = await prisma.role.findUnique({
    where: { key: 'SYSTEM_ADMIN' },
  });
  if (existing) {
    return existing;
  }

  return prisma.role.create({
    data: {
      key: 'SYSTEM_ADMIN',
      label: SYSTEM_ADMIN_ROLE_LABEL,
      permissions: SYSTEM_ADMIN_PERMISSIONS,
      isSystem: true,
    },
  });
}

/**
 * Create-only for credentials.
 *
 * This used to overwrite `passwordHash` on every run. That was harmless
 * while the seed was a local-only step, but docker-entrypoint.sh now runs
 * it on every boot, which made SEED_SYSTEM_ADMIN_PASSWORD — not the
 * database — the effective source of truth for this account: a password
 * changed through the app was silently reverted by the next restart or
 * redeploy, with nothing in the logs to explain it.
 *
 * So an existing row's password is left alone. `roleId` is still repaired,
 * because that is a referential concern rather than a credential: a user
 * pointing at a `Role` row that no longer exists cannot authorise anything
 * and there is no way to fix it from inside the app.
 *
 * Deliberately resetting the password is still possible — losing the only
 * platform-level login with no recovery path would be worse than the
 * problem this fixes — but it now has to be asked for, once, rather than
 * happening on every restart:
 *
 *   SEED_FORCE_ADMIN_PASSWORD=true  (then unset it again)
 */
async function ensureSystemAdminUser(
  roleId: string,
  username: string,
  plainPassword: string,
): Promise<void> {
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
    // Read straight from process.env rather than the shared env schema:
    // this is a seed-only escape hatch, and the API has no business
    // carrying a variable that can rewrite an admin credential.
    const forceReset = /^(1|true|yes)$/i.test(
      process.env.SEED_FORCE_ADMIN_PASSWORD ?? '',
    );

    if (forceReset) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash: await hash(plainPassword), roleId, status: 'ACTIVE' },
      });
      console.warn(
        `[seed] SEED_FORCE_ADMIN_PASSWORD is set — reset "${username}"'s ` +
          'password, role and status from the environment. Unset it so the ' +
          'next restart does not do this again.',
      );
      return;
    }

    if (existing.roleId !== roleId) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { roleId },
      });
      console.log(
        `[seed] SYSTEM_ADMIN user "${username}" re-pointed at the current ` +
          'SYSTEM_ADMIN role. Password left unchanged.',
      );
      return;
    }

    console.log(
      `[seed] SYSTEM_ADMIN user "${username}" already exists — left unchanged.`,
    );
    return;
  }

  // Only reached when the account does not exist, so the argon2 hash is
  // computed on a first deploy rather than on every boot.
  await prisma.user.create({
    data: {
      companyId: null,
      roleId,
      name: SYSTEM_ADMIN_ROLE_LABEL,
      username,
      passwordHash: await hash(plainPassword),
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
        'non-superuser) connection. This script must run against the ' +
        'privileged (superuser) connection instead, passed inline — see ' +
        'the comment at the top of this file. Proceeding anyway, but this ' +
        'will likely fail or silently duplicate rows.',
    );
  }

  const role = await ensureSystemAdminRole();
  await ensureSystemAdminUser(
    role.id,
    env.SEED_SYSTEM_ADMIN_USERNAME,
    env.SEED_SYSTEM_ADMIN_PASSWORD,
  );
  await ensureGlobalRoles(prisma);
}

main()
  .catch((error: unknown) => {
    console.error('[seed] Failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
