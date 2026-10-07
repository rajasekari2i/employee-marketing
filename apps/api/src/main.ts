import { loadEnv } from '@field-sales/shared';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';

function validateEnv() {
  try {
    return loadEnv(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * WU-04 DoD item 1 / Architecture §4's first pipeline stage: "Helmet, CORS,
 * body limit (10 MB for multipart, 1 MB JSON)" — applied before any other
 * middleware/guard runs, including `RequestIdMiddleware`
 * (apps/api/src/common/middleware/request-id.middleware.ts).
 *
 * `JSON_BODY_LIMIT`/`MULTIPART_BODY_LIMIT_BYTES` are defined here (not in
 * `packages/shared`, out of this work unit's file scope) purely as the
 * documented, single-sourced numbers this file's own `useBodyParser` call
 * applies — and the exact figure a later work unit (WU-06, the avatar file
 * pipeline) should match when it configures multer's own `limits.fileSize`
 * for its multipart upload route(s). There is no multipart route yet in
 * this slice, so there is nothing to apply `MULTIPART_BODY_LIMIT_BYTES` to
 * here today; express's JSON/urlencoded body parsers (registered below via
 * `useBodyParser`) never touch `multipart/form-data` requests regardless
 * (Express only decodes the content types it's configured for), so a
 * global "multipart limit" has no Express-level hook to attach to until a
 * multer-backed route exists.
 */
const JSON_BODY_LIMIT = '1mb';
export const MULTIPART_BODY_LIMIT_BYTES = 10 * 1024 * 1024;

/**
 * Strict CORS allowlist: comma-separated origins from `CORS_ALLOWED_ORIGINS`
 * (read directly from `process.env`, not through `loadEnv()` —
 * `packages/shared/src/env.ts` is out of this work unit's file scope to
 * extend, and this value isn't required at boot the way the Zod-validated
 * vars are: an empty/unset value simply means "allow no cross-origin
 * browser callers", which is the correct strict default for an API whose
 * only client today is a bare React Native app that doesn't send a
 * same-origin-policy-relevant `Origin` header the way a browser does).
 */
function corsAllowlist(): string[] {
  const raw = process.env.CORS_ALLOWED_ORIGINS;
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

async function bootstrap() {
  const env = validateEnv();

  // `bufferLogs: true` holds Nest's own bootstrap-phase log lines (module
  // registration, route mapping, etc.) until `app.useLogger()` below swaps
  // in the pino-backed logger, so even those early lines come out as pino
  // JSON instead of Nest's default console formatter. WU-07 DoD item 1 /
  // Architecture §18 — `LoggerModule.forRoot(...)` (registered in
  // `app.module.ts`) is what actually configures pino (JSON output, the
  // `requestId`/`companyId`/`userId`/`route`/`durationMs` fields via
  // `pinoHttp.customProps`, and the redaction list); this file only wires
  // the resulting `Logger` in as Nest's app-wide logger.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  const logger = app.get(Logger);

  app.use(helmet());

  const allowlist = corsAllowlist();
  app.enableCors({
    origin: allowlist.length > 0 ? allowlist : false,
    credentials: true,
  });

  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: JSON_BODY_LIMIT, extended: true });

  // Architecture D-15 ("REST, `/api/v1`, cursor pagination...") and every
  // contracts/*.md base-path declaration (e.g. "Base path `/api/v1/auth`")
  // require this prefix — it was never actually wired in despite
  // throttler.config.ts's `isAuthRoute` already anticipating it (see that
  // file's own comment). Applies to every route, `@Public()` included —
  // this only changes where a route is mounted, not who can reach it.
  app.setGlobalPrefix('api/v1');

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  logger.log(`API listening on port ${port} (log level: ${env.LOG_LEVEL})`);
}

void bootstrap();
