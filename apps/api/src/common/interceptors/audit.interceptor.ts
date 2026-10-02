import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma, PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { Observable, concatMap, from, map } from 'rxjs';
import type { Request } from 'express';

import {
  AUDITED_KEY,
  type AuditedOptions,
} from '../decorators/audited.decorator';
import type { AuthenticatedRequest } from '../guards/jwt-auth.guard';
import type { TransactionClsStore } from './transaction.interceptor';

/**
 * Own module-level Prisma client — same pattern as `transaction.interceptor
 * .ts` (WU-03) — used only as the *fallback* when no transaction is active
 * on CLS (e.g. a `@Public()` route that is also, unusually, `@Audited()`).
 * The normal path uses the request's own transaction client (see below).
 */
const prisma = new PrismaClient();

/** The subset of a Prisma (transaction) client this interceptor needs. */
type AuditCapablePrisma = Pick<PrismaClient, 'auditEvent'>;

/**
 * Round-trips an arbitrary handler return value through `JSON.stringify`/
 * `parse` so it's guaranteed representable as Prisma's `InputJsonValue`
 * (drops `undefined`s, functions, etc., the same way the HTTP response
 * body itself would ultimately be serialized) rather than an unchecked type
 * assertion. `Prisma.JsonNull` is Prisma's own sentinel for "explicitly
 * store SQL NULL in this JSON column", used for a `null`/`undefined`
 * result instead of a plain JS `null`, which Prisma's typings don't accept
 * here.
 */
function toJsonValue(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) {
    return Prisma.JsonNull;
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * WU-04 DoD item 8 / Architecture §4's final pipeline stage: writes exactly
 * one `AuditEvent` row for any handler marked `@Audited()`
 * (apps/api/src/common/decorators/audited.decorator.ts), *inside the same
 * transaction* `TransactionInterceptor` opened for the request.
 *
 * That "same transaction" guarantee is purely a consequence of registration
 * *order* in `app.module.ts`'s global `APP_INTERCEPTOR` list:
 * `[IdempotencyInterceptor, TransactionInterceptor, AuditInterceptor]`.
 * NestJS interceptors nest in registration order — the first registered is
 * outermost, each calling `next.handle()` to invoke the next one inward.
 * So `TransactionInterceptor` (registered second) calls `next.handle()`
 * *from inside* its own `cls.runWith({ ...; tx }, ...)` callback
 * (transaction.interceptor.ts), which is what actually invokes this
 * interceptor (registered third, innermost, right next to the handler) —
 * meaning this interceptor's `tap()` callback runs within that same
 * `AsyncLocalStorage` extent and can read the live `tx` off CLS. If this
 * interceptor were ever registered *before* `TransactionInterceptor`
 * instead, `cls.get('tx')` here would always be `undefined` and every
 * audit write would silently happen outside the handler's transaction —
 * this ordering is load-bearing, not cosmetic.
 *
 * `entityType`/`entityId` are best-effort generic derivations (no live
 * controller exists yet in this work unit to validate them against): the
 * controller's class name with a trailing `Controller` stripped, and
 * `req.params.id` falling back to the response body's own `id` field.
 * `before` is not populated by this generic interceptor — a handler that
 * needs to record a before/after diff (e.g. a profile edit) should do so
 * itself; this interceptor only guarantees the row exists with `action`,
 * `entityType`, `entityId` and `after` filled in from what it can see
 * generically.
 *
 * The audit write is sequenced with `concatMap` (not `tap`) deliberately —
 * found the hard way while verifying this interceptor end-to-end for this
 * work unit's report: `tap()`'s callback is synchronous as far as RxJS is
 * concerned, so a `tap(() => { void this.record(...) })` fire-and-forget
 * call returns *before* `record()`'s `await` resolves. That let
 * `TransactionInterceptor`'s `firstValueFrom(next.handle())` resolve (and
 * its `$transaction` callback return, committing/closing the connection)
 * while `record()` was still running on a separate, un-awaited promise —
 * which then tried to run `auditEvent.create()` against an already-closed
 * transaction client and threw `PrismaClientKnownRequestError` (`P2028:
 * Transaction already closed`) as an *unhandled promise rejection*,
 * crashing the entire Node process (Node's default behavior since Node
 * 15). `concatMap` instead makes this interceptor's own returned
 * `Observable` not emit/complete until `record()`'s promise has actually
 * settled, so `firstValueFrom` upstream genuinely waits for it — keeping
 * the transaction open for the full duration of the audit write, and
 * surfacing a write failure as a normal rejected request (failing the
 * whole transaction, which is the correct behavior for an audit write
 * DoD item 8 requires to be transactionally atomic with the handler) in
 * place of a crash.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService<TransactionClsStore>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<
      AuditedOptions | undefined
    >(AUDITED_KEY, [context.getHandler(), context.getClass()]);

    if (!options) {
      return next.handle();
    }

    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest & Request>();

    return next
      .handle()
      .pipe(
        concatMap((result: unknown) =>
          from(this.record(options, context, request, result)).pipe(
            map((): unknown => result),
          ),
        ),
      );
  }

  private async record(
    options: AuditedOptions,
    context: ExecutionContext,
    request: AuthenticatedRequest,
    result: unknown,
  ): Promise<void> {
    const store = this.cls.get();
    const tx = store?.tx as AuditCapablePrisma | undefined;
    const client = tx ?? prisma;

    const entityType =
      options.entityType ?? context.getClass().name.replace(/Controller$/, '');
    const entityId = this.resolveEntityId(request, result);

    await client.auditEvent.create({
      data: {
        companyId: store?.companyId ?? null,
        // No TenantContextInterceptor yet (deferred to a later slice per
        // this work unit's design notes) to guarantee `request.user` is
        // populated for every `@Audited()` route; falling back to a
        // literal 'system' for the not-yet-possible case of an audited
        // public route rather than writing an invalid empty string into
        // this NOT NULL column.
        actorUserId: request.user?.sub ?? 'system',
        action: options.action,
        entityType,
        entityId,
        after: toJsonValue(result),
      },
    });
  }

  private resolveEntityId(
    request: AuthenticatedRequest,
    result: unknown,
  ): string {
    const paramId = (request.params as Record<string, string> | undefined)?.id;
    if (paramId) {
      return paramId;
    }

    if (
      result &&
      typeof result === 'object' &&
      'id' in (result as Record<string, unknown>)
    ) {
      return String((result as Record<string, unknown>).id);
    }

    return 'unknown';
  }
}
