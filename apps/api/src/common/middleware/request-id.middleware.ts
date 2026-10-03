import { randomUUID } from 'node:crypto';

import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Stamps a correlation id into CLS for the lifetime of the request
 * (Architecture §4's pipeline, stage 2 — "RequestIdMiddleware (x-request-id,
 * correlation id into CLS)"). `ProblemDetailsFilter` echoes it back in every
 * error envelope's `requestId` field, and the (later) pino logging work unit
 * (WU-07) will tag every log line with it.
 *
 * Reuses the caller's own `x-request-id` when present (so a client-side
 * retry/trace can thread one id through, e.g. a mobile outbox retry —
 * CLAUDE.md's "field app assumes a bad network" rule) and mints a fresh
 * ULID-shaped-enough `randomUUID()` otherwise. Always echoes the final id
 * back on the response header, so the caller can read it whichever path
 * that was.
 *
 * Wired in `apps/api/src/app.module.ts` via `AppModule implements
 * NestModule` -> `configure()` -> `consumer.apply(RequestIdMiddleware)
 * .forRoutes('*')`. This must run *after* `ClsModule`'s own auto-mounted
 * `ClsMiddleware` (`ClsModule.forRoot({ middleware: { mount: true } })`,
 * from WU-03) has already entered the AsyncLocalStorage context for this
 * request, or `cls.set()` below throws — relying on `ClsModule` being
 * imported first in `AppModule.imports` (Nest wires module middleware in
 * import/registration order). Verified empirically by booting the app and
 * confirming a request completes without the 500 that a missing/inactive
 * CLS context would produce (see this work unit's final report).
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  constructor(private readonly cls: ClsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const requestId =
      typeof incoming === 'string' && incoming.length > 0
        ? incoming
        : randomUUID();

    this.cls.set('requestId', requestId);
    res.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
}
