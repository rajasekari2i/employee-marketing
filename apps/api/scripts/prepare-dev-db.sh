#!/bin/sh
# Local release step — run by `predev`, so `pnpm dev` brings the database
# up to date before the server starts: migrate, then seed.
#
# Why this exists: Prisma has no auto-migrate, and nothing in NestJS
# startup applies a migration or a seed (see docker-entrypoint.sh). In a
# container the release step is the entrypoint. Locally there is no
# entrypoint, so `pnpm dev` used to start happily against an empty
# database and fail at the first query.
#
# Why a script and not an inline `DATABASE_URL="$MIGRATE_DATABASE_URL" ...`
# in package.json: MIGRATE_DATABASE_URL lives in .env, not in the shell, so
# the shell expands it to "" before Prisma ever loads .env — and an empty
# DATABASE_URL does NOT fall back to the .env value, it fails with P1012
# ("resolved to an empty string"). The variable has to be read out of .env
# here, before the Prisma CLI is invoked.
set -e

cd "$(dirname "$0")/.."

# A real environment variable wins over .env, matching Prisma's own
# precedence (its dotenv loader never overrides an already-set variable).
if [ -z "$MIGRATE_DATABASE_URL" ] && [ -f .env ]; then
  MIGRATE_DATABASE_URL=$(
    grep -E '^[[:space:]]*MIGRATE_DATABASE_URL[[:space:]]*=' .env \
      | tail -n 1 \
      | sed -E 's/^[^=]*=[[:space:]]*//; s/^"(.*)"[[:space:]]*$/\1/; s/^'"'"'(.*)'"'"'[[:space:]]*$/\1/'
  )
fi

# Both steps need the privileged connection. Migrations need CREATE TABLE,
# which app_user deliberately lacks; the seed needs to bypass RLS, because
# it writes the companyId: null SYSTEM_ADMIN row outside any request
# context — prisma/seed.ts:13-31 explains why running it as app_user would
# silently duplicate rows rather than fail.
#
# Unset is not an error: a developer whose DATABASE_URL is still the
# superuser (the pre-two-role local setup) gets both steps anyway.
if [ -n "$MIGRATE_DATABASE_URL" ]; then
  PRIVILEGED_URL="$MIGRATE_DATABASE_URL"
  SOURCE="MIGRATE_DATABASE_URL"
else
  PRIVILEGED_URL=""
  SOURCE="DATABASE_URL"
fi

# Fail loudly rather than half-work. If the only connection available is
# the unprivileged one, `migrate deploy` cannot create a table and the seed
# would silently insert a duplicate SYSTEM_ADMIN — both worth refusing over.
if [ -z "$PRIVILEGED_URL" ] && grep -qE '^[[:space:]]*DATABASE_URL[[:space:]]*=.*\bapp_user\b' .env 2>/dev/null; then
  echo "[predev] DATABASE_URL is the unprivileged app_user connection and" >&2
  echo "[predev] MIGRATE_DATABASE_URL is not set — cannot migrate or seed." >&2
  echo "[predev] Uncomment MIGRATE_DATABASE_URL in apps/api/.env." >&2
  exit 1
fi

run_prisma() {
  if [ -n "$PRIVILEGED_URL" ]; then
    DATABASE_URL="$PRIVILEGED_URL" npx prisma "$@"
  else
    npx prisma "$@"
  fi
}

echo "[predev] migrating ($SOURCE)"
run_prisma migrate deploy

# Idempotent by construction (prisma/seed.ts:9) — find-then-create for both
# the five global Role rows and the SYSTEM_ADMIN user, so re-running on
# every start never duplicates. It DOES refresh the admin's password hash
# from SEED_SYSTEM_ADMIN_PASSWORD each run (seed.ts:126), which is the
# point locally: .env is the source of truth for the dev login.
echo "[predev] seeding ($SOURCE)"
run_prisma db seed
