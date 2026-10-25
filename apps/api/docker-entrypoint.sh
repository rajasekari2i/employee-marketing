#!/bin/sh
# Release step, then the server.
#
# Prisma has NO auto-migrate: `prisma generate` builds the client and
# touches no database, and nothing in NestJS startup applies a migration.
# Something has to run `migrate deploy`, and running it from inside the
# application process would be wrong — with more than one replica, every
# replica would race the others through the same migration.
#
# So it runs here: once, before `exec` hands the container over to the
# server. If the migration fails the container never starts, which is the
# behaviour you want — a half-migrated schema serving traffic is worse than
# a deploy that visibly refuses.
set -e

# MIGRATE_DATABASE_URL is a SEPARATE, privileged connection, used only by
# this script and never by the application process, which keeps running as
# the unprivileged DATABASE_URL role.
#
# Two credentials is the price of the two-role design: `app_user` cannot
# CREATE TABLE, by intent, because Postgres bypasses row-level security for
# superusers and the application must never be one. The split is what keeps
# the privilege confined to this one step.
if [ -n "$MIGRATE_DATABASE_URL" ]; then
  echo "[entrypoint] applying migrations"
  cd /app/apps/api
  DATABASE_URL="$MIGRATE_DATABASE_URL" npx prisma migrate deploy
  cd /app
else
  # Not an error. A deployment may apply migrations from CI or by hand, and
  # should not be forced to hand a superuser credential to the container to
  # do nothing with it.
  echo "[entrypoint] MIGRATE_DATABASE_URL not set — skipping migrations"
fi

# exec, not a plain call: the server becomes PID 1 and receives SIGTERM
# directly, so Railway's shutdown is graceful instead of a 30-second kill.
exec "$@"
