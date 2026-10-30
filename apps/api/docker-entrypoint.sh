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

  # Retry loop, for Railway's private network specifically.
  #
  # "postgres.railway.internal" resolves over a wireguard mesh that is NOT
  # up the instant the container is: Railway documents a short delay before
  # private networking is established, and it is IPv6-only. The release
  # step is the very first thing this container does, so it races that
  # setup and loses — Prisma reports P1001 "Can't reach database server",
  # `set -e` kills the container, and Railway restarts it into the same
  # race. The visible symptom is a crash-looping deploy and a database
  # with no tables, which looks identical to the migration never being
  # attempted.
  #
  # Only P1001 is retried. A migration that fails on its SQL fails on the
  # first try and stays failed, rather than being hidden behind ten
  # retries of a genuine error.
  attempt=1
  max_attempts=10
  while :; do
    echo "[entrypoint] applying migrations (attempt $attempt/$max_attempts)"
    # Redirect-then-cat, NOT `... | tee`: the exit status of a pipeline is
    # the status of its LAST command, so piping through tee would report
    # tee's success and the failure branch below would be dead code.
    # /bin/sh here is dash, which has no `set -o pipefail` to fix that.
    if DATABASE_URL="$MIGRATE_DATABASE_URL" npx prisma migrate deploy \
         >/tmp/migrate.log 2>&1; then
      cat /tmp/migrate.log
      break
    fi
    cat /tmp/migrate.log >&2

    if ! grep -q "P1001" /tmp/migrate.log; then
      echo "[entrypoint] FATAL: migration failed for a reason other than" >&2
      echo "[entrypoint] reachability — see the Prisma error above." >&2
      exit 1
    fi

    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "[entrypoint] FATAL: database still unreachable after" >&2
      echo "[entrypoint] $max_attempts attempts. Check that the Postgres" >&2
      echo "[entrypoint] service is running and that MIGRATE_DATABASE_URL's" >&2
      echo "[entrypoint] host matches it." >&2
      exit 1
    fi

    echo "[entrypoint] database not reachable yet (P1001), retrying in 3s"
    attempt=$((attempt + 1))
    sleep 3
  done

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
