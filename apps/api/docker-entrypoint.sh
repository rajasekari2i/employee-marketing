#!/bin/sh
# Release step, then the server.
#
# Prisma has NO auto-migrate: `prisma generate` builds the client and
# touches no database, and nothing in NestJS startup applies a migration or
# a seed. Something has to run them, and running them from inside the
# application process would be wrong — with more than one replica, every
# replica would race the others through the same migration.
#
# So they run here: once, before `exec` hands the container over to the
# server. If either step fails the container never starts, which is the
# behaviour you want — a half-migrated schema serving traffic is worse than
# a deploy that visibly refuses.
#
# Both steps are idempotent, which is what makes "run on every boot" safe:
# `migrate deploy` applies only migrations not already recorded in
# `_prisma_migrations` and is a no-op once the database is current, and
# prisma/seed.ts is find-then-create throughout (see its header). A restart
# that has nothing to do does nothing.
set -e

# MIGRATE_DATABASE_URL is a SEPARATE, privileged connection, used only by
# this script and never by the application process, which keeps running as
# the unprivileged DATABASE_URL role.
#
# Two credentials is the price of the two-role design: `app_user` cannot
# CREATE TABLE, by intent, because Postgres bypasses row-level security for
# superusers and the application must never be one. The split is what keeps
# the privilege confined to this one step. The seed needs it for a second
# reason: it writes the companyId: null SYSTEM_ADMIN row outside any request
# context, so it has to bypass RLS (prisma/seed.ts:13-31).
if [ -z "$MIGRATE_DATABASE_URL" ]; then
  # Hard failure, deliberately.
  #
  # This used to skip quietly and start the server anyway, on the reasoning
  # that a deployment might migrate from CI instead. That reasoning cost a
  # production deploy: the variable was not set on the service, the skip
  # scrolled past in the deploy log, the server came up against an empty
  # database and the first request failed on a table that was never
  # created. A release step that silently does nothing is worse than no
  # release step, because it looks like it worked.
  #
  # Migrating elsewhere is still supported — it just has to be stated,
  # rather than inferred from an absent variable that is far more often an
  # absent variable.
  if [ "$SKIP_DB_RELEASE" = "1" ]; then
    echo "[entrypoint] SKIP_DB_RELEASE=1 — not migrating or seeding"
  else
    echo "[entrypoint] FATAL: MIGRATE_DATABASE_URL is not set." >&2
    echo "[entrypoint] This is the privileged connection the release step" >&2
    echo "[entrypoint] migrates and seeds with. Set it on the service (it" >&2
    echo "[entrypoint] is NOT read from .env — .dockerignore keeps .env out" >&2
    echo "[entrypoint] of the image), or set SKIP_DB_RELEASE=1 if this" >&2
    echo "[entrypoint] environment applies migrations somewhere else." >&2
    exit 1
  fi
else
  cd /app/apps/api

  echo "[entrypoint] applying migrations"
  DATABASE_URL="$MIGRATE_DATABASE_URL" npx prisma migrate deploy

  # Seeding was missing here entirely while scripts/prepare-dev-db.sh did
  # run it, which is exactly why this worked locally and not in production:
  # the two paths were not doing the same thing.
  #
  # NOTE: the seed refreshes the SYSTEM_ADMIN password hash from
  # SEED_SYSTEM_ADMIN_PASSWORD on every run (prisma/seed.ts:124). On every
  # boot, that means the env var — not the database — is the source of
  # truth for that one account's password, and a password changed through
  # the app would be reset by the next restart.
  echo "[entrypoint] seeding"
  DATABASE_URL="$MIGRATE_DATABASE_URL" npx prisma db seed

  cd /app
fi

# exec, not a plain call: the server becomes PID 1 and receives SIGTERM
# directly, so Railway's shutdown is graceful instead of a 30-second kill.
exec "$@"
