import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration.
 *
 * This replaces the `"prisma": { "seed": ... }` block that used to live in
 * package.json. That form is deprecated in Prisma 6 and is removed in
 * Prisma 7 — the CLI prints a `package.json#prisma is deprecated` warning
 * on every invocation, which is noise in the release step's output (see
 * docker-entrypoint.sh) and would become a hard break on the next major.
 *
 * ---------------------------------------------------------------------
 * The config file turns OFF Prisma's own .env loading — hence the block
 * below:
 * ---------------------------------------------------------------------
 * With no config file the CLI loads .env itself and prints "Environment
 * variables loaded from .env". The moment this file exists it prints
 * "Prisma config detected, skipping environment variable loading" instead
 * and loads nothing. Without replacing that, `prisma migrate deploy` and
 * `prisma db seed` would fail locally with P1012 ("Environment variable
 * not found: DATABASE_URL") against schema.prisma's `env("DATABASE_URL")`,
 * and prisma/seed.ts would see no SEED_SYSTEM_ADMIN_* either — it inherits
 * this process's environment.
 *
 * `process.loadEnvFile` (Node >= 20.12; this package requires >= 22) keeps
 * Prisma's own precedence: it does NOT overwrite a variable already set in
 * the real environment. That is load-bearing, not incidental — both
 * release steps invoke the CLI as
 * `DATABASE_URL="$MIGRATE_DATABASE_URL" npx prisma ...` to migrate and
 * seed over the privileged connection, and an overriding loader would
 * silently put .env's unprivileged app_user URL back and break migrations.
 *
 * The existsSync guard is for the container, where there is no .env at all
 * — .dockerignore keeps it out of the image and Railway supplies the
 * variables directly — and where loadEnvFile would otherwise throw ENOENT.
 */
const envPath = join(__dirname, '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

export default defineConfig({
  // Absolute, so the CLI resolves the same schema whether it is invoked
  // from apps/api (both release scripts cd here first) or the repo root.
  schema: join(__dirname, 'prisma', 'schema.prisma'),
  migrations: {
    // Unchanged from the package.json entry it replaces: ts-node, because
    // prisma/seed.ts is TypeScript and is covered by this package's
    // tsconfig. Run with apps/api as the cwd, as both release steps do.
    seed: 'ts-node prisma/seed.ts',
  },
});
