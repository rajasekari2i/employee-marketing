import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { firstValueFrom, from, Observable } from 'rxjs';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import {
  tenantExtension,
  TenantClsStore,
} from '../../infra/prisma/tenant.extension';

/**
 * CLS store shape this interceptor adds `tx` to, on top of whatever the
 * tenant layer already reads/writes (see tenant.extension.ts).
 */
export interface TransactionClsStore extends TenantClsStore {
  tx?: unknown;
}

/**
 * Single process-wide Prisma client, extended with the Layer-1 tenant
 * isolation query filter from tenant.extension.ts.
 *
 * There is no PrismaModule/PrismaService in the codebase yet — WU-01/WU-02
 * never created one, and it is out of this work unit's file scope to add
 * one. This interceptor therefore owns the one client instance the app
 * currently shares. A later work unit should promote this to a proper
 * injectable PrismaService (reading an active `tx` off CLS, falling back
 * to this base client) that other modules inject directly, instead of a
 * module-level singleton.
 */
const prisma = new PrismaClient();

/**
 * Pulled out to a standalone, non-overloaded function so its return type
 * can be captured with `ReturnType<...>` below — `ReturnType<typeof
 * prisma.$extends>` on the (overloaded) method itself does not resolve to
 * the concrete extended-client type.
 */
function withTenantIsolation(cls: ClsService<TransactionClsStore>) {
  return prisma.$extends(tenantExtension(cls));
}

/**
 * Layer 2 plumbing (Architecture §5 / CLAUDE.md Constitution rule 2):
 * opens one Prisma transaction per request, sets the Postgres session
 * variable row-level-security policies key off (`app.company_id`, via
 * `set_config(..., true)` — transaction-scoped, i.e. `SET LOCAL`
 * semantics), and re-enters CLS with that transaction's client attached so
 * every later piece of code in the same request — the handler, its
 * service, anything it calls — reads the exact same tenant-scoped,
 * transactional Prisma client instead of the bare one.
 *
 * `companyId` itself is not computed here — it is expected to already be
 * in CLS by the time this interceptor runs (Architecture §4's
 * `TenantContextInterceptor`, which reads it from the verified JWT and
 * runs earlier in the pipeline — built in a later work unit). This
 * interceptor only consumes it.
 *
 * Note on `next.handle()`: Architecture §5's illustrative snippet returns
 * `next.handle()` (an Observable) directly from inside `$transaction`'s
 * async callback and `cls.runWith`. That would make `$transaction` await a
 * non-thenable and let the Observable's actual subscription (i.e. the rest
 * of the request pipeline) happen outside the transaction/CLS callback's
 * synchronous extent, which would both fail to wait for the request to
 * finish before committing and risk losing the CLS-scoped `tx` via
 * AsyncLocalStorage. This implementation instead eagerly subscribes with
 * `firstValueFrom` *inside* `cls.runWith`'s callback (subscribing is
 * synchronous), producing a real Promise that `$transaction` can correctly
 * await, then wraps the final settled result back into an Observable with
 * `from(...)` to satisfy `NestInterceptor`'s contract — same pattern,
 * actually awaited.
 *
 * Registered as a global `APP_INTERCEPTOR` in `app.module.ts` by WU-04,
 * together with the `@Public()` skip check below — WU-04's DoD item 11
 * requires registering the two together, never one without the other:
 * without the skip, forcing every public route (`/auth/login`,
 * `/auth/refresh`, ...) through a tenant-scoped transaction before any
 * tenant identity exists would break them outright.
 */
@Injectable()
export class TransactionInterceptor implements NestInterceptor {
  private readonly tenantPrisma: ReturnType<typeof withTenantIsolation>;

  constructor(
    private readonly cls: ClsService<TransactionClsStore>,
    private readonly reflector: Reflector,
  ) {
    this.tenantPrisma = withTenantIsolation(this.cls);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // WU-04 DoD item 11: a `@Public()` handler/class has no tenant identity
    // yet (it runs before any login has happened, e.g. `/auth/login`
    // itself) — opening a transaction and calling `set_config('app.
    // company_id', ...)` for it would be meaningless at best and, once a
    // public handler needs its own non-tenant-scoped queries, actively
    // wrong. Skip straight to the rest of the pipeline with no transaction.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return next.handle();
    }

    // Falsy (missing) companyId resolves to '' here rather than skipping
    // set_config entirely: an empty/unset `app.company_id` makes the RLS
    // policy (NULLIF-guarded, see the RLS migration) match no rows at all
    // — fail closed — rather than leaving a stale value from a previous
    // transaction on a pooled connection.
    const companyId = this.cls.get('companyId') ?? '';

    return from(
      this.tenantPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;

        return this.cls.runWith(
          { ...this.cls.get(), tx },
          (): Promise<unknown> => firstValueFrom(next.handle()),
        );
      }),
    );
  }
}
