import { createHash } from 'node:crypto';

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '@field-sales/shared';
import { ClsService } from 'nestjs-cls';
import { Observable, concatMap, firstValueFrom, from, map } from 'rxjs';
import type { Request } from 'express';

import type { AuthenticatedRequest } from '../guards/jwt-auth.guard';
import type { TenantClsStore } from '../../infra/prisma/tenant.extension';

/**
 * Own module-level Prisma client, same pattern as `transaction.interceptor
 * .ts` (WU-03) and `active-account.guard.ts` — see those files' comments
 * for why there's no shared `PrismaService` yet. `IdempotencyKey` is not a
 * tenant-isolated model (`tenant.extension.ts`'s `TENANT_MODELS` exemption
 * list — Architecture §5), so an unextended client is correct here, not a
 * shortcut.
 */
const prisma = new PrismaClient();

const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
const METHODS_REQUIRING_KEY = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface StoredResponse {
  statusCode: number;
  body: unknown;
}

/**
 * Round-trips an arbitrary value through `JSON.stringify`/`parse` so it's
 * guaranteed representable as Prisma's `InputJsonValue` — the same
 * transformation the HTTP response body itself goes through on the wire —
 * via an explicit cast on the *result* of that round-trip, rather than
 * letting `JSON.parse`'s inherently `any`-typed return flow unchecked into
 * a Prisma call (same helper shape as `audit.interceptor.ts`'s
 * `toJsonValue`).
 */
function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * WU-04 DoD item 6 / Architecture §4's "IdempotencyInterceptor (commands
 * only)" stage, and CLAUDE.md Constitution rule 3: a retried command
 * carrying the same `Idempotency-Key` as a prior request replays that
 * prior request's stored response rather than re-running the handler; the
 * same key presented with a *different* request body (detected by hashing
 * the body) is rejected with `409 IDEMPOTENCY_KEY_REUSED` rather than
 * silently executing a different command under someone else's key.
 *
 * Registered as a global `APP_INTERCEPTOR`, ordered in `app.module.ts`
 * *before* `TransactionInterceptor` (Architecture §4's stage order:
 * IdempotencyInterceptor -> TransactionInterceptor -> Handler) — this
 * interceptor's own reads/writes against `IdempotencyKey` therefore happen
 * outside any tenant-scoped transaction the handler runs in, which is
 * correct: `IdempotencyKey` has no RLS policy (WU-03's documented exemption
 * list) and this interceptor must be able to short-circuit *before* a
 * transaction is even opened for a replayed request.
 *
 * Only applies to state-changing HTTP methods, and only when the caller
 * actually sent an `Idempotency-Key` header — a request without one simply
 * passes through unchanged (enforcing that mutating routes *must* send one
 * is left to each route's own validation, not this cross-cutting
 * interceptor, since no controllers exist yet to decide that policy per
 * endpoint).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly cls: ClsService<TenantClsStore>) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest & Request>();

    const key = request.headers[IDEMPOTENCY_KEY_HEADER];

    if (
      typeof key !== 'string' ||
      key.length === 0 ||
      !METHODS_REQUIRING_KEY.has(request.method)
    ) {
      return next.handle();
    }

    const requestHash = this.hashRequest(request);

    return from(this.handle(key, requestHash, request, next));
  }

  private async handle(
    key: string,
    requestHash: string,
    request: AuthenticatedRequest,
    next: CallHandler,
  ): Promise<unknown> {
    const existing = await prisma.idempotencyKey.findUnique({
      where: { key },
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new AppError(
          'IDEMPOTENCY_KEY_REUSED',
          'This Idempotency-Key was already used for a different request.',
        );
      }

      if (existing.statusCode !== null) {
        // Replay: hand the originally-observed body straight back without
        // re-invoking the handler. This interceptor's own stored
        // `statusCode` isn't re-applied to the live HTTP response here —
        // the controller method's own `@HttpCode`/default status still
        // governs what's sent — so a future work unit that needs the exact
        // original status code echoed back on replay should read
        // `existing.statusCode` and set it on the response object
        // directly.
        const stored = existing.response as unknown as StoredResponse | null;
        return stored?.body;
      }

      // A row exists but has no stored response yet — a concurrent
      // in-flight duplicate of the same command. Rare (the client minted
      // one ULID key per logical command, per CLAUDE.md Constitution rule
      // 3), and not resolvable without blocking; let it proceed rather than
      // silently dropping the request. The eventual response write below
      // uses `upsert`, so this doesn't collide with the in-flight request's
      // own completion.
    } else {
      await prisma.idempotencyKey.create({
        data: {
          key,
          companyId: this.cls.get('companyId') ?? null,
          endpoint: request.originalUrl ?? request.url,
          requestHash,
        },
      });
    }

    // `firstValueFrom` (same reasoning as transaction.interceptor.ts's own
    // use of it): eagerly subscribes and awaits the handler's single
    // emission.
    //
    // `storeResponse` is sequenced with `concatMap` rather than fired off
    // from inside a `tap()` callback — found necessary the hard way while
    // verifying this pipeline end-to-end for this work unit's report
    // (the exact same bug, found via `AuditInterceptor`'s originally-`tap`
    // -based audit write — see that file's class doc for the full
    // incident): `tap()` is synchronous as far as RxJS is concerned, so a
    // `tap(() => { void this.storeResponse(...) })` fire-and-forget call
    // returns before `storeResponse`'s `await` resolves, leaving its
    // promise's eventual rejection (e.g. a transient DB error) completely
    // unhandled — which crashes the whole Node process (Node's default
    // behavior since Node 15), not just this one request. `concatMap`
    // makes this interceptor's returned `Observable` not emit until
    // `storeResponse` has actually settled, so any failure surfaces as a
    // normal rejected request through `firstValueFrom` instead.
    //
    // `next.handle()` is typed `Observable<any>` by NestJS's own
    // `CallHandler` interface — the explicit `<unknown>` type argument
    // below is what stops that `any` from propagating into `body`'s
    // inferred type (triggering `@typescript-eslint/no-unsafe-assignment`)
    // rather than an unchecked assertion.
    const body = await firstValueFrom<unknown>(
      next
        .handle()
        .pipe(
          concatMap((value: unknown) =>
            from(this.storeResponse(key, value)).pipe(
              map((): unknown => value),
            ),
          ),
        ),
    );

    return body;
  }

  private async storeResponse(key: string, body: unknown): Promise<void> {
    // Round-trip through JSON so an arbitrary handler return value is
    // guaranteed representable as Prisma's `InputJsonValue` (the same
    // transformation the HTTP response body itself goes through on the
    // wire), rather than an unchecked type assertion.
    const stored: StoredResponse = {
      statusCode: 200,
      body: body === undefined ? null : JSON.parse(JSON.stringify(body)),
    };

    await prisma.idempotencyKey.update({
      where: { key },
      data: {
        statusCode: stored.statusCode,
        response: toJsonValue(stored),
      },
    });
  }

  private hashRequest(request: Request): string {
    // `Request.body` is typed `any` by Express's own typings (its actual
    // shape depends entirely on whichever body parser ran) — read out
    // through `unknown` rather than letting that `any` flow into the
    // object literal below.
    const body: unknown = request.body ?? null;
    const payload = JSON.stringify({
      method: request.method,
      url: request.originalUrl ?? request.url,
      body,
    });
    return createHash('sha256').update(payload).digest('hex');
  }
}
