import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';

import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { THROTTLER_CONFIG } from './common/guards/throttler.config';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { ActiveAccountGuard } from './common/guards/active-account.guard';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { TransactionInterceptor } from './common/interceptors/transaction.interceptor';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { MeModule } from './modules/me/me.module';
import { FilesModule } from './modules/files/files.module';

@Module({
  imports: [
    // WU-05 DoD item 7: the first feature module with real controllers
    // (`POST /auth/login`, `/auth/refresh`, `/auth/logout`) — everything
    // above this point in the file (guards/pipes/filters/interceptors) is
    // WU-04's request pipeline, which now has live routes to actually
    // cover.
    AuthModule,
    // User Story 1 (specs/001-company-user-auth/orchestration-plan.md):
    // `POST/GET/PATCH /companies` — the first consumer of `@SkipTenant()`.
    CompaniesModule,
    // User Story 2 (specs/001-company-user-auth/orchestration-plan.md):
    // `GET /me` — covered by the already-global JwtAuthGuard/
    // ActiveAccountGuard with zero new guard code.
    MeModule,
    // WU-06 (specs/001-company-user-auth/orchestration-plan.md): the
    // avatar file pipeline. `GET /files/:id?token=` is `@Public()` (its
    // own HMAC query-token auth, not a JWT) — see files.controller.ts.
    FilesModule,
    // Establishes one AsyncLocalStorage-backed context per request so the
    // tenant isolation layer (Architecture §5 / CLAUDE.md Constitution
    // rule 2) — the Prisma extension in src/infra/prisma/tenant.extension.ts
    // and the TransactionInterceptor in
    // src/common/interceptors/transaction.interceptor.ts — has somewhere to
    // read/write `companyId` and the active transaction from, for the
    // lifetime of a single request. `global: true` makes `ClsService`
    // injectable anywhere without re-importing ClsModule per feature module.
    ClsModule.forRoot({
      global: true,
      middleware: { mount: true },
    }),
    // WU-04 DoD item 2: named throttler configs (per-IP on /auth/*, per-user
    // elsewhere — see throttler.config.ts for why each entry skips itself
    // outside its intended routes). Imported here so the config/storage
    // exist and `ThrottlerGuard`/this config are DI-resolvable; per WU-04's
    // DoD item 10 (the exact five global providers it lists), `ThrottlerGuard`
    // itself is deliberately NOT registered as a global APP_GUARD by this
    // work unit — ready for a later work unit to apply once there are live
    // routes to rate-limit.
    ThrottlerModule.forRoot(THROTTLER_CONFIG),
  ],
  controllers: [],
  providers: [
    // Global pipeline registrations (WU-04 DoD item 10 + item 11).
    //
    // Guard order matters and mirrors Architecture §4's stage order:
    // JwtAuthGuard (verify token, populate request.user) must run before
    // ActiveAccountGuard (reads request.user to look up the live user row).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ActiveAccountGuard },

    { provide: APP_PIPE, useClass: ZodValidationPipe },

    { provide: APP_FILTER, useClass: ProblemDetailsFilter },

    // Interceptor order matters and is load-bearing, not cosmetic — see
    // audit.interceptor.ts's class doc for the full reasoning. NestJS nests
    // globally-registered interceptors in registration order (first
    // registered = outermost):
    //   IdempotencyInterceptor  (outermost — may short-circuit via replay
    //                            before any transaction is even opened)
    //   TransactionInterceptor  (opens the tx, re-enters CLS with `tx` set)
    //   AuditInterceptor        (innermost — runs inside that same tx's CLS
    //                            scope, so its AuditEvent write is part of
    //                            the handler's own transaction)
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransactionInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Runs after ClsModule's own auto-mounted ClsMiddleware (`middleware:
    // { mount: true }` above) has already entered the AsyncLocalStorage
    // context for this request — relies on ClsModule being registered
    // first in `imports` (see request-id.middleware.ts's class doc for the
    // full reasoning and how this was verified).
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
