# ProjectEstimation Coding Standard

**Stack**: Node.js 20 LTS, NestJS, TypeScript (strict), Prisma ORM, Supabase-managed PostgreSQL.

This document governs how code is written for the ProjectEstimation API. It exists to keep 12+ feature specs' worth of already-decided architecture (multi-tenant RLS, stateless JWT, audit triggers, soft delete, money-as-integer) enforced consistently as multiple people/agents implement them, rather than re-derived — or accidentally violated — feature by feature. Where this document is silent, defer to the relevant feature's `spec.md`/`plan.md`/`research.md` under `specs/`; where it conflicts with one, this document is wrong and should be corrected, not the other way around.

---

## 1. Project & Module Structure

One NestJS module per bounded concern, matching the module boundaries already established across `specs/*/plan.md` — do not introduce a new top-level module without a spec backing it:

```
api/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── companies/        # 001
│   ├── roles/             # 001
│   ├── categories/        # 001
│   ├── departments/       # 001
│   ├── users/              # 001 — tenant/staff user management
│   ├── auth/                # 002, 003 — login/refresh/logout, forgot-password
│   ├── profile/              # 007
│   ├── products/              # 004
│   ├── staff-orders/           # 005
│   ├── student-orders/          # 006, 008, 010
│   ├── payments/                  # 006, 009, 010 — webhook + FCM send
│   ├── notifications/               # 009 — device registration
│   └── common/
│       ├── guards/                   # JwtAuthGuard, RolesGuard
│       ├── prisma/                    # TenantPrismaService (§5.2) — the ONLY way modules touch the DB
│       ├── filters/                    # global exception filter (§7)
│       ├── interceptors/                # request-context / logging
│       └── decorators/                   # @CurrentUser(), @Roles(...)
└── test/
```

Every module: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/*.dto.ts`. Business logic lives in services; controllers only translate HTTP ↔ service calls (parse DTO in, map result out) — no query logic, no branching on role, in a controller.

---

## 2. TypeScript Conventions

- `strict: true` in `tsconfig.json`, non-negotiable — `noImplicitAny`, `strictNullChecks`, everything on.
- No `any`. If a type is genuinely unknown at a boundary (e.g., a webhook payload before validation), type it `unknown` and narrow it, never `any`.
- Every exported function/method has an explicit return type — don't rely on inference across a module boundary.
- Prefer `interface` for object shapes that might be extended (DTOs, config); `type` for unions, mapped types, and anything that's structurally final.
- No `enum` for string-valued domain concepts that already exist in the database as a `text` column with a fixed set of values (order `status`, role `name`, audit `action`, etc.) — use a `const` object + derived union type instead, so the single source of truth for valid values is one place, not duplicated between a TS `enum` and the DB `CHECK`/application validation:

  ```ts
  export const OrderStatus = {
    PaymentPending: 'payment_pending',
    OrderPlaced: 'order_placed',
    PaymentFailed: 'payment_failed',
    Delivered: 'delivered',
  } as const;
  export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];
  ```

- Naming: `PascalCase` for classes/types/interfaces, `camelCase` for variables/functions/methods, `UPPER_SNAKE_CASE` only for true compile-time constants (not for the domain-value objects above, which use PascalCase keys per the pattern shown).

---

## 3. NestJS Conventions

- **DTOs validate everything**: every controller method's input is a class decorated with `class-validator` decorators (`@IsEmail()`, `@IsInt() @Min(1)` for money fields, etc.) and transformed via `class-transformer`. Enable `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` globally — an unrecognized field in a request body is a `400`, not silently ignored.
- **Guards, not `if` statements, gate access**: role/scope checks are `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('company_admin')`-style decorators, applied at the controller or route level — never an inline `if (user.role !== 'staff') throw ...` scattered in service logic. This keeps every route's authorization visible from its decorators alone.
- **`company_id`/`role`/`user id` come only from the verified JWT** (`req.user`, populated by `JwtAuthGuard`), exposed to handlers via a `@CurrentUser()` param decorator — never read from `req.body`, `req.query`, or a route param, even when a client-supplied value would coincidentally match. This is the single most important rule in this codebase (see §6).
- One `PrismaModule`, marked `@Global()`, exporting the tenant-aware wrapper from §5.2 — no module constructs its own `PrismaClient`.
- Async everywhere I/O happens; no `.then()` chains — `async`/`await` only.
- Config via `@nestjs/config`'s `ConfigService`, never `process.env.X` scattered through business code — one typed config schema, validated at boot (fail fast if a required var, per `012`, is missing).

---

## 4. Prisma & Database Conventions

### 4.1 Naming: snake_case in Postgres, camelCase in code

Every `schema.prisma` field maps explicitly, so the database stays snake_case (matching every `data-model.md` under `specs/`) while application code stays idiomatic camelCase:

```prisma
model Order {
  id                 String   @id @default(uuid())
  companyId          String   @map("company_id")
  paymentGatewayRef  String?  @map("payment_gateway_ref")
  createdAt          DateTime @default(now()) @map("created_at")

  @@map("orders")
}
```

Never hand-write a raw query using camelCase column names, and never let a model's Prisma name diverge from what a feature's `data-model.md` calls it.

### 4.2 Prisma's schema.prisma is NOT the full source of truth for this database

This is the single most important Prisma-specific rule in this codebase. Prisma's schema DSL cannot express several things nearly every feature's `data-model.md` requires:

| Not expressible in `schema.prisma` | Required by |
|---|---|
| Row Level Security policies | Every tenant-scoped table, starting `001` |
| Triggers (role-seeding on company insert, `audit_logs` capture) | `001` research.md §3, `011` |
| `CHECK` constraints (`price > 0`, exactly-one-actor-identity, etc.) | `004`, `010`, `011` |
| Partial unique indexes (`WHERE is_deleted = false`, `WHERE is_current = true`) | `001`, `004`, `010` |
| `REVOKE UPDATE, DELETE` privilege changes | `011` (audit immutability) |

**Workflow**: run `prisma migrate dev --create-only` to generate the schema-diff SQL, then **hand-edit that migration file** to append the RLS policy/trigger/check-constraint/grant statements the feature's `data-model.md` specifies, before applying it. Every migration that adds a tenant-scoped table must add its RLS policies in the *same* migration file — never ship a table for even one deploy without its policy attached. Add a comment block at the top of every hand-edited migration listing which parts are Prisma-generated vs. hand-added, so the next person doesn't "clean up" a migration by regenerating it and silently dropping the raw SQL.

### 4.3 Tenant/RLS session context — the required query pattern

RLS policies across this codebase (every `data-model.md` under `specs/`) are predicated on Postgres session variables: `app.current_user_id`, `app.current_role`, `app.current_company_id`, and (per `011`) `app.current_system_actor` for non-request writes. Prisma's default connection pooling means two separate `prisma.model.findMany()` calls are **not guaranteed to run on the same connection**, so a bare `SET LOCAL` before a query and the query itself can silently land on different connections — this would make the RLS policy see no session context at all, which (depending on the policy) either wrongly denies everything or, worse, is masked by the API-layer filter alone doing the work with no real second layer of defense.

**Every** database access in this codebase goes through a single `TenantPrismaService` (in `src/common/prisma/`) that wraps the request in a Prisma interactive transaction and sets the session variables as its first statement:

```ts
async runInTenantContext<T>(
  ctx: { userId?: string; role: string; companyId?: string | null; systemActor?: string },
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return this.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT
        set_config('app.current_user_id', ${ctx.userId ?? ''}, true),
        set_config('app.current_role', ${ctx.role}, true),
        set_config('app.current_company_id', ${ctx.companyId ?? ''}, true),
        set_config('app.current_system_actor', ${ctx.systemActor ?? ''}, true);
    `;
    return work(tx);
  });
}
```

- A request-scoped interceptor (`src/common/interceptors/`) populates `{ userId, role, companyId }` from the already-verified JWT (`req.user`) once per request; services never construct this context by hand from a controller argument.
- A non-request code path with no authenticated user (the payment webhook, `012`'s seed script) sets `systemActor` (e.g. `'payment_webhook'`) instead of `userId` — never leaves both empty (per `011` FR-005, this must never produce a blank audit actor).
- **No service is allowed to inject the raw `PrismaClient` directly** — only `TenantPrismaService`. A code-reviewer's first check on any new service touching a tenant-scoped table is "does this go through `runInTenantContext`."
- The System Admin's platform-wide bypass (full CRUD over Roles/Categories/Departments, per `001`) is a predicate *inside* the RLS policy (`current_setting('app.current_role') = 'system_admin'`), never a separate connection that skips RLS altogether — see CLAUDE.md's Multi-Tenancy section.

### 4.4 Query conventions

- Always `select` the fields a handler actually needs — no bare `findMany()` returning every column when a DTO only echoes three of them (keeps response shapes honest and avoids accidentally leaking a column like `password_hash`).
- Never construct SQL by string interpolation. Prisma's tagged-template `$queryRaw`/`$executeRaw` parameterize automatically when you use the tag correctly (as in §4.3) — never `$queryRawUnsafe` with a manually concatenated string.
- Soft delete is a `WHERE isDeleted: false` on every read query for a soft-deletable model — encode this as a reusable Prisma query extension or a repository-level default filter, not a `WHERE` clause copy-pasted into every service method (the exact "don't rely on someone remembering" reasoning that already governs the audit trigger design in `011`).
- Money columns are `Int` in Prisma (Postgres `integer`), smallest currency unit — never `Float`/`Decimal` for a value that will be summed or compared exactly (per every `data-model.md`'s money convention).
- Wrap a multi-step write in `$transaction` whenever a feature's `research.md` describes an atomicity requirement (e.g., `010`'s payment-attempt creation + marking the prior attempt non-current must commit together or not at all).

---

## 5. Multi-Tenancy & Security Rules (non-negotiable)

These restate CLAUDE.md's own rules as enforceable coding rules, since this is the platform's single biggest named risk (BRD §9):

1. `company_id`, `role`, and `user id` used for authorization or scoping **always** come from the verified JWT via `@CurrentUser()` — a value of the same name in a request body/query/path is untrusted input, full stop, even if a DTO happens to also declare a field with that name for an unrelated reason.
2. Every tenant-scoped table has RLS enabled with a policy present in the *same migration* that creates the table (§4.2) — a table without a policy attached is a bug, not a "TODO."
3. No `system_admin`-style bypass is ever added to a table's RLS policy unless a spec's Functional Requirements explicitly grant it (see `004`'s corrected FR-003 and `005`/`006`'s deliberate absence of one) — when in doubt, the answer is no bypass.
4. A payment/order webhook handler runs under a service-role connection with **no** application-role RLS bypass granted elsewhere as a side effect — its elevated access is scoped to that one code path (`006` research.md §4, `011` research.md §6), not a general escape hatch reused for convenience elsewhere.

---

## 6. API Design Conventions

- Route prefixes match the actor, matching every `contracts/openapi.yaml` under `specs/`: `/admin/*` (System Admin), `/tenant/*` (Company Admin/Staff), `/student/*`, `/me/*` (any authenticated user acting on their own account), `/auth/*` (unauthenticated or session-establishing).
- Resource-oriented REST: `GET/POST /tenant/products`, `PATCH/DELETE /tenant/products/:id`, a sub-resource action as `PATCH /tenant/products/:id/soldout` (matching `004`) rather than a verb-shaped endpoint like `/toggleProductSoldout`.
- List endpoints return a plain array unless a feature's spec calls for pagination; don't invent an envelope (`{data, meta}`) speculatively for an endpoint no spec says needs paging (per `008`'s own explicit deferral of pagination to "when actually needed").
- A `PATCH` accepts a partial body; only submitted fields change (per `004`/`007`'s "all-or-nothing, omitted fields untouched" rule) — never require the client to resend every field.

---

## 7. Error Handling & Response Shape

- One global `HttpExceptionFilter` producing a consistent `{ message: string }` (or a slightly richer shape only where a spec calls for one, e.g. `004`'s `unavailable_product_ids` on a 409) — never let a raw Prisma error or stack trace reach a response body.
- Use NestJS's built-in HTTP exceptions (`BadRequestException`, `ForbiddenException`, `ConflictException`, `NotFoundException`) rather than throwing a generic `Error` and mapping it later — the exception type *is* the status code decision, made at the point that actually knows why the request failed.
- The generic-error rule from `002` (FR-005: identical response for "wrong password" and "no such user") and `003` (identical response whether or not a username exists) apply literally — do not let a caught exception's message differ even slightly between those two cases; write a dedicated shared error constant for each, not two similar-but-not-identical strings.
- Never include a stack trace, a Prisma error code, or an internal field name in a 4xx/5xx body returned to a client.

---

## 8. Auditability & Logging

- Anything `011` covers (Product/Order/payment-attempt mutations) needs **no application code** to log it — the DB trigger does it. Don't add a duplicate `console.log`/audit call in a service method for something the trigger already captures; that's the exact double-source-of-truth risk the trigger design exists to avoid.
- Anything that is a *non-mutation event* (a failed login, a failed OTP verification, a notification send/failure — per `002`/`003`/`005`/`009`'s dedicated event-log tables) **does** need an explicit application-level write, since no row changed for a trigger to observe.
- **Load-bearing convention for `011`'s trigger**: any write to `products`, `orders`, or `payment_attempts` — existing or future — must go through `TenantPrismaService.runInTenantContext` with either `userId` or `systemActor` set on the `TenantContext`. `fn_audit_log()` requires exactly one of `app.current_user_id`/`app.current_system_actor` to be non-empty and will fail the write (via `audit_logs`' `CHECK` constraint) if neither is set — this is deliberate (`011`'s spec FR-005/FR-006: a blank-actor audit row must never be possible), not a bug to work around by adding a third session variable or bypassing `runInTenantContext`.
- Structured logging (`nestjs-pino` or equivalent) — never `console.log` in application code. Never log a password, a raw OTP, a refresh token, or a JWT in any form, at any log level, including `debug`.
- Log `company_id` and a request id on every log line touching tenant-scoped data, so a production incident can be filtered to one tenant (matches Architecture §10's observability NFR).

---

## 9. Testing Conventions

- Jest, `@nestjs/testing` for module-level tests. Contract tests live under `test/contract/<module>/`, matching each feature's `quickstart.md` scenarios — a `quickstart.md` scenario that isn't backed by an automated test is a gap, not "documentation only."
- Every RLS-dependent table gets at least one test that exercises the policy directly against the database (not just through the API), per the precedent set in `001`/`006`'s own `research.md` — an API-level test alone can pass while masking a broken policy underneath it.
- Webhook/idempotency logic (`006`, `010`) gets tests for the replay/race scenarios explicitly, not just the happy path — `010`'s `quickstart.md` Scenarios 3–4 (stale success honored, stale failure ignored) are the template for how seriously to treat this category of test.
- No test hits a real third-party service (Razorpay, Firebase) — mock the gateway/FCM client at the service boundary (`RazorpayService`, `FcmService`), per every relevant `research.md`'s own "mocked FCM client" testing note.

---

## 10. Configuration & Secrets

- All secrets (JWT signing key, Supabase service-role key, Razorpay keys, FCM credentials, MSG91 auth key (`014`, mobile-number verification only), `012`'s bootstrap-admin values) come from environment variables validated at boot via a typed config schema (`@nestjs/config` + `joi`/`zod`) — a missing required var fails startup immediately, never falls back to a default (per `012`'s explicit "fail loud, no silent fallback" rule).
- No secret, credential, or `.env` file is ever committed. `.env.example` documents every required key with a placeholder, never a real value.
- Environment-specific values (which Supabase project, which Firebase project, per Architecture §9) are injected at deploy time, never hardcoded per environment in source.

---

## 11. Git & Commit Hygiene

- Small, reviewable commits scoped to one module/feature at a time; a commit touching `products/` and `payments/` together should usually be two commits unless they're genuinely one atomic change (e.g., a shared migration).
- Commit messages describe *why*, not a restatement of the diff — consistent with this repo's existing commit style.
- Never commit a migration that hasn't been run locally against a real Postgres instance at least once — a Prisma migration that only "looks right" in the hand-edited SQL (§4.2) is exactly the kind of change that needs to actually be executed before it's trusted.

---

## 12. Before Opening a PR — Checklist

- [ ] Every new tenant-scoped table has an RLS policy in the same migration.
- [ ] Every DB access goes through `TenantPrismaService` — no raw `PrismaClient` injection.
- [ ] `company_id`/`role`/`user id` are read only from `@CurrentUser()`, never from the request body/query/path.
- [ ] DTOs validate every field; `ValidationPipe` rejects unknown fields.
- [ ] No secret, password, OTP, or token appears in a log line.
- [ ] New non-mutation security events (failed attempts, sent notifications) are explicitly logged; new row mutations on `products`/`orders`/`payment_attempts` are *not* manually logged (the trigger already does it).
- [ ] Money fields are integers; no `Float` introduced for a currency value.
- [ ] Tests cover the feature's `quickstart.md` scenarios, including any race/idempotency cases it calls out.
