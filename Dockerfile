# Deployment image for the API (Railway).
#
# **A Dockerfile exists here to take package-manager detection out of the
# equation entirely.** Railway's builders infer the package manager from the
# repo, and that inference kept choosing npm for this pnpm workspace —
# `apps/api/package.json` declares `"@field-sales/shared": "workspace:*"`,
# which npm cannot resolve, so the build died on `npm install` with
# EUNSUPPORTEDPROTOCOL. When a Dockerfile is present Railway builds it and
# runs nothing else: no detection, no install step chosen on our behalf.
#
# Single stage on purpose. A multi-stage build would produce a smaller
# image, but pnpm's node_modules is a tree of symlinks into
# node_modules/.pnpm, and copying that between stages is a well-known way to
# get a subtly broken image. For a pilot-sized service, an image that is
# certainly correct beats one that is smaller.

FROM node:22-bookworm-slim

# openssl is required by Prisma's query engine; ca-certificates for TLS to
# Railway's Postgres. Debian slim rather than Alpine because Prisma's engines
# are built against glibc and the musl variants are a recurring source of
# "could not locate the Query Engine" at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# corepack reads `packageManager` from the root package.json, so the pnpm
# version here is the same one the lockfile was written with.
RUN corepack enable

# Copy the whole workspace before installing. The usual
# "lockfile-first for layer caching" trick needs every package.json in the
# workspace copied individually, which silently breaks the moment someone
# adds a package — and this build is infrequent enough that the cache is not
# worth that failure mode.
COPY . .

# --frozen-lockfile: fail loudly if pnpm-lock.yaml and the manifests
# disagree, rather than quietly resolving something different from what was
# tested.
#
# --prod=false: do NOT let an ambient NODE_ENV decide what gets installed.
# Railway injects service variables into the build, so a NODE_ENV=production
# set on the service would make pnpm skip devDependencies — which is where
# the Prisma CLI and ts-node live. The entrypoint needs both (`prisma
# migrate deploy`, and `prisma db seed` running prisma/seed.ts through
# ts-node), so without this the container would build fine and then die at
# boot on "prisma: not found". ENV NODE_ENV=production below is set after
# this line deliberately, for the same reason.
RUN pnpm install --frozen-lockfile --prod=false

# Turborepo builds @field-sales/shared first (its `build` task declares
# dependsOn: ["^build"]), and the API's own build runs `prisma generate`
# before compiling — a fresh container has no generated client.
RUN pnpm build

ENV NODE_ENV=production

# Quiet the two update notifiers that write into the release step's output.
# Neither is actionable from inside a container, and between them they made
# a genuine deprecation warning ("package.json#prisma is deprecated") easy
# to miss in a deploy log. Note what Prisma's notifier actually advertises
# at the time of writing — 8.0.0-rc.28, a release candidate — which is not
# something a production image should be nudging anyone toward.
ENV PRISMA_HIDE_UPDATE_MESSAGE=true
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

# Migrations run in the entrypoint, before the server starts — see the
# script for why not in the app process.
ENTRYPOINT ["/app/apps/api/docker-entrypoint.sh"]

# Railway injects PORT; main.ts reads it and falls back to 3000.
EXPOSE 3000

# NOT `dist/main`. `nest build` preserves the src/ folder because the API's
# tsconfig also covers prisma/ and scripts/, so the entry is dist/src/main.js.
CMD ["node", "apps/api/dist/src/main"]
