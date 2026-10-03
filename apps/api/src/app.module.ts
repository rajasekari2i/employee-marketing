import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ClsModule, ClsServiceManager } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import pino from 'pino';
import type { Request, Response } from 'express';
import type { IncomingMessage, ServerResponse } from 'http';

import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { deepRedact } from './infra/logging/deep-redact';
import type { AuthenticatedRequest } from './common/guards/jwt-auth.guard';
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
import { UsersModule } from './modules/users/users.module';

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
    // User Story 3 adds `POST /files/avatars` to this same module/
    // controller (ordinary authenticated, not `@Public()`).
    FilesModule,
    // User Story 3 (specs/001-company-user-auth/orchestration-plan.md):
    // `GET/POST /users`, `PATCH /users/:id`, `POST
    // /users/:id/salary-rates` — the first ordinary (non-`@SkipTenant()`)
    // module to genuinely exercise Layer-1 tenant scoping end-to-end.
    UsersModule,
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
    // WU-07 DoD item 1 / Architecture §18 ("Observability"): pino JSON logs
    // carrying `requestId`/`companyId`/`userId`/`route`/`durationMs` on
    // every HTTP request, with a redaction list so none of
    // password/token/authorization/latitude/longitude/reasonText/otp can
    // ever appear in plaintext even if a future handler logs a body/header
    // containing one. `requestId`/`companyId` are read straight off CLS via
    // `ClsServiceManager.getClsService()` (the same escape hatch
    // `nestjs-cls` documents for code that isn't itself a Nest provider) —
    // not through DI here, so this stays a single `forRoot(...)` entry
    // rather than a `forRootAsync` with its own `inject`/`useFactory`,
    // keeping this file's diff to "one import + one array entry" per this
    // work unit's file-scope note. `companyId` is `undefined` for most
    // routes today (`TenantContextInterceptor` doesn't exist yet — see
    // tenant.extension.ts), which is expected. `userId` comes from
    // `request.user.sub`, the verified JWT claim `JwtAuthGuard` attaches
    // (apps/api/src/common/guards/jwt-auth.guard.ts) — absent for
    // `@Public()` routes, same as `companyId`. `route` is Express's own
    // matched route pattern (`req.route.path`, e.g. `/companies/:id`), not
    // the literal URL — omitted (not a literal-URL fallback — see
    // `customProps` below for why) for a request no app route ever
    // matched.
    LoggerModule.forRoot<Request, Response>({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        // WU-07 DoD item 1 / Constitution rule 9: an earlier version of this
        // config used pino's built-in `redact.paths` option (fast-redact) —
        // adversarial review live-verified that option only matches a fixed
        // set of exact, literal paths (`req.body.password`, bare top-level
        // `password`, etc.) and leaves every OTHER nesting depth completely
        // unprotected (e.g. `{ user: { credentials: { password } } }` logged
        // in plaintext), since fast-redact has no arbitrary-depth/recursive
        // matching mode. `formatters.log` (below, via `deepRedact` —
        // src/infra/logging/deep-redact.ts) replaces it: it walks the
        // ENTIRE object pino is about to serialize, at any depth, under any
        // parent key, so a sensitive field name can never slip through
        // regardless of where a future handler happens to nest it.
        //
        // `formatters.log` alone was then found (retry 2) to still leak the
        // real `Authorization: Bearer <token>` header in plaintext on every
        // authenticated request. Root cause: pino-http attaches `req`/`res`
        // to each request's child logger as *bindings* (`logger.child({req,
        // res})`), and pino applies the `serializers.req`/`serializers.res`
        // functions to those bindings itself, independently of
        // `formatters.log` — `formatters.log` only ever sees the object
        // passed directly to a given `log()` call, never the serialized
        // binding object. Fixed by also redacting inside the `req`/`res`
        // serializers themselves (below): each wraps pino's own default
        // serializer (`pino.stdSerializers.req`/`.res`, the same ones
        // pino-http uses internally) and runs `deepRedact` over its output
        // before returning, so `req.headers.authorization` (and any other
        // sensitive key nested anywhere under the serialized req/res) is
        // caught here too. Safe to deep-walk: pino's req/res serializers
        // expose `.raw` (the actual live Node req/res objects, with
        // circular references) only as a non-enumerable property, so
        // `deepRedact`'s `Object.entries()` walk — like `JSON.stringify` —
        // never touches it.
        //
        // `deepRedact` was then found (retry 3) to still leak a real
        // `GET /files/:id?token=...` file-access token in plaintext, side
        // by side with the SAME value correctly redacted one key over in
        // `query.token`. Root cause: `deepRedact` only matches sensitive
        // object *keys* — it has no way to notice a sensitive value
        // embedded as a substring inside an unrelated string field, and
        // pino's default req serializer's `url` is exactly that: the raw
        // path+query string verbatim, carrying a second, unredacted copy
        // of whatever the (already-redacted) `query` object holds. Fixed
        // by dropping the query string from `url` entirely in the
        // serializer below — the parsed, per-key-redacted `query` object
        // already carries that data in loggable form, so `url` keeping
        // only the path is strictly a removal of a redundant, unsafe-by
        // construction copy, not a loss of any field this DoD needs.
        serializers: {
          req: (req: IncomingMessage) => {
            const serialized = deepRedact(
              pino.stdSerializers.req(req),
            ) as Record<string, unknown>;
            if (typeof serialized.url === 'string') {
              serialized.url = serialized.url.split('?')[0];
            }
            return serialized;
          },
          res: (res: ServerResponse) =>
            deepRedact(pino.stdSerializers.res(res)) as Record<string, unknown>,
        },
        formatters: {
          log: (object) => deepRedact(object) as Record<string, unknown>,
        },
        customAttributeKeys: {
          // Renamed so the field name matches this work unit's DoD exactly
          // (`durationMs`), instead of pino-http's default `responseTime`.
          responseTime: 'durationMs',
        },
        customProps: (req: Request) => {
          const cls = ClsServiceManager.getClsService();
          const authReq = req as AuthenticatedRequest;
          // `.get()`'s own generic resolution (nestjs-cls, see
          // cls.service.d.ts) only comes out typed when the base `ClsStore`
          // interface itself declares the key, which it doesn't for either
          // of these two (companyId is only declared on the narrower
          // `TenantClsStore` tenant.extension.ts defines, requestId is
          // never declared on a typed store interface at all) — explicit
          // return-typed helpers, same pattern `problem-details.filter.ts`
          // already uses for the identical `cls.get('requestId')` call.
          const getRequestId = (): string | undefined => cls.get('requestId');
          const getCompanyId = (): string | undefined => cls.get('companyId');
          // Express's own types declare `Request.route` as `any` (see
          // `@types/express-serve-static-core`), so this narrows it to the
          // one field actually used instead of propagating that `any`.
          //
          // pino-http (logger.js) calls `customProps` twice per request:
          // once at request-start (building the logger `req` ends up bound
          // to) and again at response-finish (producing the actual
          // "request completed" line) — and when the two calls disagree on
          // a field's value, it layers on a second set of chindings rather
          // than replacing the first, so the one line that's actually
          // written ends up with a literal duplicate JSON key. `req.route`
          // disagrees between the two calls by construction: at
          // request-start only `RequestIdMiddleware`'s own global
          // `forRoutes('*')` layer has matched (Express 5 renders that
          // wildcard as `{/*splat}`, never starting with `/`); by
          // response-finish the real controller route (always `/...`) has
          // taken over the same `req.route`. Returning `undefined` (which
          // pino drops entirely, never emitting the key) for anything that
          // isn't yet a genuine `/`-rooted app route makes the
          // request-start call contribute no `route` key at all, so only
          // the response-finish call's correct value is ever written —
          // verified empirically (see this work unit's final report).
          const matchedRoute = (authReq.route as { path?: string } | undefined)
            ?.path;
          const route =
            matchedRoute && matchedRoute.startsWith('/')
              ? matchedRoute
              : undefined;
          return {
            requestId: getRequestId(),
            companyId: getCompanyId(),
            userId: authReq.user?.sub,
            route,
          };
        },
      },
    }),
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
