# Technical Architecture — Field Sales & Beat Execution

| Field | Value |
|---|---|
| Version | 2.0 (implementation baseline) |
| Date | 2026-10-01 |
| Companions | `01-BRD.md`, `02-PRD.md` |
| Build toolchain | Claude Code + GitHub Spec Kit + Metaswarm |
| Hosting | Railway (API, PostgreSQL, volume, cron) |

---

## 1. Decisions at a glance

| # | Decision | Choice | Why |
|---|---|---|---|
| D-01 | Repo layout | **Single monorepo**, pnpm workspaces + Turborepo | One PR changes API, mobile and the shared contract together; Spec Kit works on one spec tree |
| D-02 | Backend | **NestJS 11** on Node 22 LTS, TypeScript strict | Module boundaries and DI map cleanly onto Spec Kit feature slices |
| D-03 | ORM | **Prisma 6** | Typed client shared with the mobile contract, first-class migrations |
| D-04 | Database | **PostgreSQL 16** (Railway) | Relational integrity for assignments, orders, attendance and salary |
| D-05 | Tenancy | **Shared schema + `companyId` + Prisma extension + Postgres RLS** | One migration path, two independent layers of isolation |
| D-06 | Auth | **Stateless JWT**: access 15 min, rotating refresh 60 days, argon2id passwords | No session store on the API; refresh rotation gives revocation |
| D-07 | Login identity | Username + password; **company from the build**, username unique per company | One APK per company, so no company code to type |
| D-08 | Mobile | **React Native via Expo (prebuild / EAS)**, NativeWind (Tailwind), React Navigation | Expo config plugins + EAS build profiles give one build per company cheaply |
| D-09 | Mobile data layer | TanStack Query + Zustand + MMKV, SQLite for the offline queue | Cache and retry semantics for a field app on bad networks |
| D-10 | Shared contract | `packages/shared` with **Zod** schemas and inferred types, used by API DTOs and mobile forms | One definition of every payload |
| D-11 | Photos | **Railway volume** behind a `StorageAdapter`, signed short-lived URLs | Matches the chosen deployment; swappable to S3/MinIO without touching business code |
| D-12 | Notifications | **Firebase Cloud Messaging** via `firebase-admin` | Firebase is used for messaging only, not auth or data |
| D-13 | Geo distance | Haversine in SQL/Node + a bounding-box pre-filter, lat/lng as `Decimal` | Avoids a PostGIS dependency on Railway's Postgres image; PostGIS is a later upgrade |
| D-14 | Scheduling | `@nestjs/schedule` in a single API replica for v1, with a Postgres advisory lock | No Redis needed yet; BullMQ + Railway Redis when the API scales out |
| D-15 | API style | REST, `/api/v1`, cursor pagination, `Idempotency-Key` on every command | Simple for a mobile client and easy to cache |
| D-16 | Error format | RFC 9457 `application/problem+json` with a stable `code` | NFR-08 needs machine-distinguishable error classes |

---

## 2. System context

```
┌──────────────────────────────┐        ┌───────────────────────────────┐
│  Mobile app (React Native)   │        │  Google Maps Platform         │
│  one build per company       │──────▶ │  Maps SDK, Places, Geocoding  │
│  Expo · NativeWind · TanStack│        └───────────────────────────────┘
└──────────────┬───────────────┘
               │ HTTPS  JSON  Bearer JWT
               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  API service on Railway — NestJS                                     │
│  Guards → CLS tenant context → Prisma (+RLS) → Postgres              │
│  Jobs: assignment materialisation, reminders, auto-close, salary      │
│  Storage adapter → /data volume · firebase-admin → FCM                │
└───────┬──────────────────────┬───────────────────────┬───────────────┘
        │                      │                       │
        ▼                      ▼                       ▼
┌────────────────┐   ┌───────────────────┐   ┌────────────────────────┐
│ PostgreSQL 16  │   │ Railway volume    │   │ Firebase Cloud         │
│ (Railway)      │   │ /data/photos      │   │ Messaging              │
└────────────────┘   └───────────────────┘   └────────────────────────┘
                                                      │
                                                      ▼  SMS gateway → OTP
```

---

## 3. Monorepo layout

```
field-sales/
├─ .specify/                     # Spec Kit: constitution, specs, plans, tasks
│  ├─ memory/constitution.md
│  └─ specs/<nnn>-<slug>/{spec.md,plan.md,tasks.md}
├─ docs/
│  ├─ 01-BRD.md  02-PRD.md  03-ARCHITECTURE.md
│  └─ adr/0001-....md
├─ apps/
│  ├─ api/                       # NestJS
│  │  ├─ prisma/{schema.prisma,migrations/,seed.ts}
│  │  ├─ src/
│  │  │  ├─ main.ts  app.module.ts
│  │  │  ├─ common/               # guards, filters, interceptors, decorators
│  │  │  ├─ infra/                # prisma, storage, fcm, sms, clock, cls
│  │  │  └─ modules/
│  │  │     ├─ auth/  users/  companies/  roles/
│  │  │     ├─ masters/           # brands, reasons
│  │  │     ├─ shops/  beat-plans/  assignments/  beat-days/
│  │  │     ├─ visits/  orders/
│  │  │     ├─ attendance/  salary/
│  │  │     ├─ reports/  files/  notifications/  audit/
│  │  │     └─ jobs/
│  │  └─ test/{unit,integration,e2e}
│  └─ mobile/                    # Expo React Native
│     ├─ app.config.ts           # per-company build config
│     ├─ src/
│     │  ├─ api/                 # generated client + query hooks
│     │  ├─ features/            # auth, today, visit, order, attendance, admin…
│     │  ├─ components/  theme/  navigation/
│     │  ├─ offline/             # queue, sync engine
│     │  └─ lib/                 # location, permissions, storage, logger
│     └─ e2e/                    # Maestro flows
├─ packages/
│  ├─ shared/                    # Zod schemas, enums, error codes, geo helpers
│  └─ config/                    # eslint, tsconfig, tailwind preset
├─ turbo.json  pnpm-workspace.yaml  package.json
└─ .github/workflows/{ci.yml,deploy.yml}
```

**Rule:** `packages/shared` is the only place a request or response shape is defined. The API derives DTOs from it with `nestjs-zod`; the mobile app derives form validation and types from the same file. A change that breaks the contract breaks both builds in CI, which is the point.

---

## 4. Backend request pipeline

Order matters; each stage can reject.

```
Request
 → Helmet, CORS, body limit (10 MB for multipart, 1 MB JSON)
 → RequestIdMiddleware            (x-request-id, correlation id into CLS)
 → ThrottlerGuard                 (per IP, and per username on auth routes)
 → JwtAuthGuard                   (verify access token, load claims)
 → ActiveAccountGuard             (user ACTIVE, company ACTIVE)
 → TenantContextInterceptor       (put companyId + userId + role into CLS)
 → RolesGuard / PermissionsGuard  (@Roles, @Permissions on the handler)
 → ZodValidationPipe              (shared schema)
 → IdempotencyInterceptor         (commands only)
 → TransactionInterceptor         (opens tx, SET LOCAL app.company_id)
 → Handler → Service → Prisma
 → AuditInterceptor               (writes AuditEvent for @Audited handlers)
 → ProblemDetailsFilter           (RFC 9457 errors)
```

### Error envelope

```json
{
  "type": "https://api.fieldsales.app/errors/beat-not-started",
  "title": "Beat not started",
  "status": 409,
  "code": "BEAT_NOT_STARTED",
  "detail": "Start the beat before recording a visit.",
  "instance": "/api/v1/visits",
  "requestId": "01JB2K…",
  "errors": [{ "path": "reasonText", "message": "Required when reason is Other" }]
}
```

`code` values live in `packages/shared/src/errors.ts` so the mobile app maps them to the exact copy in PRD §5. Minimum set: `INVALID_CREDENTIALS`, `ACCOUNT_INACTIVE`, `TOKEN_EXPIRED`, `TOKEN_REUSED`, `FORBIDDEN_ROLE`, `CROSS_TENANT`, `VALIDATION_FAILED`, `BEAT_NOT_STARTED`, `BEAT_ALREADY_ENDED`, `SHOP_PIN_MISSING`, `LOW_ACCURACY`, `DUPLICATE_SUBMISSION`, `STOP_ALREADY_COMPLETED`, `SALARY_PERIOD_LOCKED`, `RATE_LIMITED`, `INTERNAL`.

---

## 5. Multi-tenancy — two layers

### Layer 1 — Prisma client extension (primary)

`companyId` is never accepted from the client. A CLS store holds the tenant for the request; a Prisma extension injects it.

```ts
// infra/prisma/tenant.extension.ts
export const tenantExtension = (cls: ClsService) =>
  Prisma.defineExtension((base) =>
    base.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            if (!TENANT_MODELS.has(model!)) return query(args);        // Company, Role, AuditEvent…
            const companyId = cls.get('companyId');
            if (!companyId) throw new InternalServerErrorException('Tenant context missing');

            if (READ_OPS.has(operation)) {
              args.where = { AND: [args.where ?? {}, { companyId }] };
            }
            if (operation === 'create')     args.data = { ...args.data, companyId };
            if (operation === 'createMany') args.data = toArray(args.data).map(d => ({ ...d, companyId }));
            if (WRITE_SCOPED_OPS.has(operation)) {
              args.where = { AND: [args.where ?? {}, { companyId }] };
            }
            return query(args);
          },
        },
      },
    }),
  );
```

A unit test asserts that every model carrying `companyId` is listed in `TENANT_MODELS`, by reading the Prisma DMMF. A new table cannot slip through unscoped.

### Layer 2 — Postgres row-level security (defence in depth)

The API connects as a non-superuser role with RLS enforced. Every request's database work runs inside a transaction that sets the tenant:

```sql
-- migration
CREATE ROLE app_user NOLOGIN;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;

ALTER TABLE "Shop" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Shop" FORCE ROW LEVEL SECURITY;
CREATE POLICY shop_tenant ON "Shop"
  USING      ("companyId" = current_setting('app.company_id', true)::uuid)
  WITH CHECK ("companyId" = current_setting('app.company_id', true)::uuid);
-- repeated for every tenant table by a generator script
```

```ts
// TransactionInterceptor
return this.prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
  return this.cls.runWith({ ...store, tx }, () => next.handle());
});
```

**Caveats stated plainly.** `SET LOCAL` is transaction-scoped, so every tenant query must run inside the interceptor's transaction; a service that grabs the raw client outside it will fail the RLS check rather than leak — which is the behaviour we want. If a connection pooler in transaction mode is introduced later, this still holds; in *statement* mode it would not, so Railway's Postgres is used with a direct connection and Prisma's own pool (`connection_limit` tuned to the plan).

Row-level security is **not** enabled for `Company`, `Role`, `AuditEvent` and `IdempotencyKey`; those are guarded in code, and System Admin routes bypass the tenant interceptor explicitly with `@SkipTenant()`.

---

## 6. Authentication and authorisation

### Tokens

| Token | Lifetime | Contents | Storage |
|---|---|---|---|
| Access | 15 min | `sub`, `companyId`, `role`, `permissions[]`, `jti`, `ver` | Memory + MMKV on device |
| Refresh | 60 days, rotating | `sub`, `familyId`, `jti` | Device secure store; **hash** stored server-side |

- Signing: HS512 with a 64-byte secret per environment. `ver` is the user's `tokenVersion`; bumping it (password change, role change, deactivation) invalidates every outstanding access token without a database lookup per request.
- `POST /auth/refresh` verifies the presented refresh token against the stored argon2id hash, marks it used, and issues a new pair in the same family. A **used** token presented again revokes the entire family and returns `TOKEN_REUSED` — the standard reuse-detection rule.
- Login body: `{ companyCode, username, password }`. `companyCode` comes from the build config, not from a user input field.
- Passwords: argon2id, `memoryCost 19456 KiB, timeCost 2, parallelism 1`. OTPs: 6 digits, stored as a hash, 10-minute expiry, 5 attempts, 30-second resend window.

### Roles and permissions

Roles are a seeded table, not a hardcoded enum alone, so a company can get a custom role later without a migration:

```ts
@Roles('COMPANY_ADMIN', 'MANAGER')
@Permissions('visit:read:company')
@Get('visits')
```

Permission strings follow `resource:action:scope` with scopes `own | team | company | platform`. The seeded matrix mirrors PRD §3 exactly and lives in `prisma/seed/permissions.ts`, with a test that compares it to a fixture so a drift from the PRD fails CI.

**Field-level rule:** `distanceMeters`, `isExceedRange`, `flags` and `reviewStatus` are stripped from every response for `MARKETING_EXECUTIVE` by a serialisation interceptor keyed on the permission `visit:read:range`. This is enforced in one place and covered by a test per endpoint that returns a visit.

---

## 7. Data model

Complete Prisma schema. `companyId` is on every tenant table, and `@@index` covers the real query paths.

```prisma
generator client { provider = "prisma-client-js" }
datasource db    { provider = "postgresql"; url = env("DATABASE_URL") }

enum CompanyStatus     { ACTIVE SUSPENDED }
enum UserStatus        { ACTIVE INACTIVE }
enum RoleKey           { SYSTEM_ADMIN COMPANY_ADMIN MANAGER MARKETING_EXECUTIVE EMPLOYEE }
enum LocationSource    { GPS MAP_SEARCH MANUAL_DRAG }
enum LocationStatus    { NONE PENDING_VERIFICATION APPROVED }
enum StopSource        { PLAN EXEC_EXTRA MANAGER_EXTRA }
enum StopStatus        { PENDING COMPLETED SKIPPED REVISIT }
enum BeatDayStatus     { RUNNING ENDED AUTO_CLOSED }
enum VisitOutcome      { ORDER NO_ORDER }
enum VisitFlag         { LOW_ACCURACY STALE_LOCATION MOCK_LOCATION_SUSPECTED OFFLINE_SUBMISSION EXCEED_RANGE }
enum ReviewStatus      { NOT_REQUIRED PENDING_REVIEW ACCEPTED REVISIT_REQUESTED }
enum DeliveryStatus    { PENDING DELIVERED }
enum AttendanceSession { MORNING EVENING }
enum AttendanceStatus  { PRESENT ABSENT LEAVE HOLIDAY WEEKLY_OFF }
enum LatenessFlag      { ON_TIME DELAY_1H DELAY_2H }
enum SalaryRunStatus   { DRAFT FINALISED }
enum PhotoKind         { SHOP USER_AVATAR }
enum PinChangeStatus   { REQUESTED APPROVED REJECTED }

model Company {
  id            String        @id @default(uuid())
  code          String        @unique            // baked into the mobile build
  name          String
  place         String?
  contactEmail  String?
  contactPhone  String?
  timezone      String        @default("Asia/Kolkata")
  status        CompanyStatus @default(ACTIVE)
  settings      CompanySettings?
  users         User[]
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
}

model CompanySettings {
  companyId               String   @id
  company                 Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  defaultRadiusMeters     Int      @default(5)
  maxAccuracyMeters       Int      @default(20)
  maxLocationAgeSeconds   Int      @default(120)
  morningSessionStart     String   @default("09:00")   // HH:mm company-local
  eveningSessionStart     String   @default("14:00")
  delay1hMinutes          Int      @default(60)
  delay2hMinutes          Int      @default(120)
  autoApproveExecPins     Boolean  @default(false)
  beatNotStartedAt        String   @default("10:30")
  beatNotEndedAt          String   @default("20:00")
  beatAutoCloseAt         String   @default("23:00")
  offlineMaxAgeHours      Int      @default(24)
  payableUnitByStatus     Json     @default("{\"PRESENT\":1,\"HOLIDAY\":1,\"WEEKLY_OFF\":1,\"LEAVE\":0,\"ABSENT\":0}")
  notificationsEnabled    Json     @default("{}")
  updatedAt               DateTime @updatedAt
}

model Role {
  id          String   @id @default(uuid())
  key         RoleKey
  companyId   String?                            // null = platform-wide seeded role
  label       String
  permissions String[]
  isSystem    Boolean  @default(true)
  users       User[]
  @@unique([companyId, key])
}

model User {
  id             String     @id @default(uuid())
  companyId      String?                          // null only for SYSTEM_ADMIN
  company        Company?   @relation(fields: [companyId], references: [id])
  roleId         String
  role           Role       @relation(fields: [roleId], references: [id])
  name           String
  email          String?
  username       String
  passwordHash   String
  mobile         String?                          // for OTP
  photoId        String?    @unique
  photo          FileObject? @relation(fields: [photoId], references: [id])
  status         UserStatus @default(ACTIVE)
  monthlySalary  Decimal?   @db.Decimal(12, 2)
  tokenVersion   Int        @default(0)
  lastLoginAt    DateTime?
  managerId      String?                          // reporting line, for team scope
  manager        User?      @relation("Team", fields: [managerId], references: [id])
  reports        User[]     @relation("Team")
  salaryRates    UserSalaryRate[]
  beatPlans      BeatPlan[]
  assignments    DailyAssignment[]
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt
  @@unique([companyId, username])
  @@index([companyId, status])
  @@index([companyId, managerId])
}

model UserSalaryRate {
  id              String   @id @default(uuid())
  companyId       String
  userId          String
  user            User     @relation(fields: [userId], references: [id])
  halfDayRate     Decimal  @db.Decimal(12, 2)
  effectiveFrom   DateTime @db.Date
  effectiveTo     DateTime? @db.Date             // null = open ended
  createdByUserId String
  createdAt       DateTime @default(now())
  @@index([companyId, userId, effectiveFrom])
}

model RefreshToken {
  id          String   @id @default(uuid())
  userId      String
  familyId    String
  tokenHash   String   @unique
  deviceId    String?
  userAgent   String?
  usedAt      DateTime?
  revokedAt   DateTime?
  expiresAt   DateTime
  createdAt   DateTime @default(now())
  @@index([userId, familyId])
  @@index([expiresAt])
}

model OtpChallenge {
  id         String   @id @default(uuid())
  userId     String
  codeHash   String
  purpose    String   @default("PASSWORD_RESET")
  attempts   Int      @default(0)
  consumedAt DateTime?
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  @@index([userId, createdAt])
}

model DeviceToken {
  id         String   @id @default(uuid())
  companyId  String
  userId     String
  fcmToken   String   @unique
  platform   String
  appVersion String?
  lastSeenAt DateTime @default(now())
  @@index([companyId, userId])
}

model FileObject {
  id          String    @id @default(uuid())
  companyId   String?
  kind        PhotoKind
  storageKey  String    @unique                   // photos/<companyId>/<uuid>.webp
  mimeType    String
  byteSize    Int
  width       Int?
  height      Int?
  sha256      String
  thumbKey    String?
  uploadedBy  String
  createdAt   DateTime  @default(now())
  @@index([companyId, kind])
}

model Brand {
  id           String   @id @default(uuid())
  companyId    String
  label        String
  displayOrder Int
  isActive     Boolean  @default(true)
  orderLines   OrderLine[]
  @@unique([companyId, label])
  @@index([companyId, isActive, displayOrder])
}

model ReasonMessage {
  id           String   @id @default(uuid())
  companyId    String
  label        String
  displayOrder Int
  isActive     Boolean  @default(true)
  requiresText Boolean  @default(false)           // true only for "Other"
  isSystem     Boolean  @default(false)           // "Other" cannot be deleted
  visits       Visit[]
  @@unique([companyId, label])
  @@index([companyId, isActive, displayOrder])
}

model Shop {
  id                     String         @id @default(uuid())
  companyId              String
  shopCode               String
  name                   String
  ownerName              String?
  phone                  String?
  addressLine1           String?
  addressLine2           String?
  city                   String?
  state                  String?
  postalCode             String?
  formattedAddress       String?
  placeId                String?
  latitude               Decimal?       @db.Decimal(9, 6)
  longitude              Decimal?       @db.Decimal(9, 6)
  geohash                String?
  locationAccuracyMeters Int?
  locationSource         LocationSource?
  locationStatus         LocationStatus @default(NONE)
  locationCapturedAt     DateTime?
  locationCapturedBy     String?
  locationVerifiedAt     DateTime?
  locationVerifiedBy     String?
  verificationRadiusMeters Int?                   // null = company default
  isActive               Boolean        @default(true)
  createdByRole          RoleKey?                 // EXEC-created shops need review
  needsReview            Boolean        @default(false)
  photos                 ShopPhoto[]
  beatPlanShops          BeatPlanShop[]
  stops                  AssignmentStop[]
  pinChanges             ShopPinChange[]
  createdAt              DateTime       @default(now())
  updatedAt              DateTime       @updatedAt
  @@unique([companyId, shopCode])
  @@index([companyId, isActive])
  @@index([companyId, locationStatus])
  @@index([companyId, latitude, longitude])        // bounding-box pre-filter
  @@index([companyId, geohash])
}

model ShopPhoto {
  id        String     @id @default(uuid())
  companyId String
  shopId    String
  shop      Shop       @relation(fields: [shopId], references: [id], onDelete: Cascade)
  fileId    String
  file      FileObject @relation(fields: [fileId], references: [id])
  sortOrder Int        @default(0)
  createdAt DateTime   @default(now())
  @@index([companyId, shopId, sortOrder])
}

model ShopPinChange {
  id             String          @id @default(uuid())
  companyId      String
  shopId         String
  shop           Shop            @relation(fields: [shopId], references: [id])
  status         PinChangeStatus @default(REQUESTED)
  fromLatitude   Decimal?        @db.Decimal(9, 6)
  fromLongitude  Decimal?        @db.Decimal(9, 6)
  toLatitude     Decimal         @db.Decimal(9, 6)
  toLongitude    Decimal         @db.Decimal(9, 6)
  accuracyMeters Int?
  source         LocationSource
  reason         String?
  requestedBy    String
  requestedAt    DateTime        @default(now())
  decidedBy      String?
  decidedAt      DateTime?
  @@index([companyId, shopId, status])
}

model BeatPlan {
  id            String         @id @default(uuid())
  companyId     String
  code          String
  name          String
  executiveId   String?
  executive     User?          @relation(fields: [executiveId], references: [id])
  workingDays   Int[]                              // 1 = Mon … 7 = Sun
  isActive      Boolean        @default(true)
  shops         BeatPlanShop[]
  assignments   DailyAssignment[]
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
  @@unique([companyId, code])
  @@index([companyId, isActive])
  @@index([companyId, executiveId])
}

model BeatPlanShop {
  id         String   @id @default(uuid())
  companyId  String
  beatPlanId String
  beatPlan   BeatPlan @relation(fields: [beatPlanId], references: [id], onDelete: Cascade)
  shopId     String
  shop       Shop     @relation(fields: [shopId], references: [id])
  sequence   Int
  @@unique([beatPlanId, shopId])
  @@index([companyId, beatPlanId, sequence])
}

model DailyAssignment {
  id             String           @id @default(uuid())
  companyId      String
  businessDate   DateTime         @db.Date         // company-local date
  executiveId    String
  executive      User             @relation(fields: [executiveId], references: [id])
  beatPlanId     String?
  beatPlan       BeatPlan?        @relation(fields: [beatPlanId], references: [id])
  beatPlanName   String?                           // snapshot label
  // beat day lifecycle
  status         BeatDayStatus?
  startedAt      DateTime?
  startLatitude  Decimal?         @db.Decimal(9, 6)
  startLongitude Decimal?         @db.Decimal(9, 6)
  startAccuracyMeters Int?
  endedAt        DateTime?
  endLatitude    Decimal?         @db.Decimal(9, 6)
  endLongitude   Decimal?         @db.Decimal(9, 6)
  endAccuracyMeters Int?
  autoClosed     Boolean          @default(false)
  endNote        String?
  stops          AssignmentStop[]
  createdAt      DateTime         @default(now())
  @@unique([companyId, businessDate, executiveId])
  @@index([companyId, businessDate])
  @@index([companyId, executiveId, businessDate])
}

model AssignmentStop {
  id               String          @id @default(uuid())
  companyId        String
  assignmentId     String
  assignment       DailyAssignment @relation(fields: [assignmentId], references: [id], onDelete: Cascade)
  shopId           String
  shop             Shop            @relation(fields: [shopId], references: [id])
  sequence         Int
  source           StopSource      @default(PLAN)
  addedByUserId    String?
  addedAt          DateTime?
  addReason        String?                         // manager extra shops
  status           StopStatus      @default(PENDING)
  effectiveRadiusMeters Int                        // snapshot at creation
  visits           Visit[]
  @@unique([assignmentId, shopId, sequence])
  @@index([companyId, assignmentId, status])
  @@index([companyId, shopId])
}

model Visit {
  id                  String        @id @default(uuid())
  companyId           String
  assignmentId        String
  stopId              String
  stop                AssignmentStop @relation(fields: [stopId], references: [id])
  shopId              String
  executiveId         String
  businessDate        DateTime      @db.Date
  outcome             VisitOutcome
  sampleShown         Boolean
  reasonId            String?
  reason              ReasonMessage? @relation(fields: [reasonId], references: [id])
  reasonText          String?
  // client-reported facts
  latitude            Decimal       @db.Decimal(9, 6)
  longitude           Decimal       @db.Decimal(9, 6)
  accuracyMeters      Int
  capturedAt          DateTime
  clientSubmittedAt   DateTime
  mockLocationReported Boolean      @default(false)
  // server-derived, never client-writable
  serverReceivedAt    DateTime      @default(now())
  shopLatitude        Decimal       @db.Decimal(9, 6)   // snapshot of approved pin
  shopLongitude       Decimal       @db.Decimal(9, 6)
  effectiveRadiusMeters Int
  distanceMeters      Decimal       @db.Decimal(10, 2)
  isExceedRange       Boolean
  flags               VisitFlag[]
  reviewStatus        ReviewStatus  @default(NOT_REQUIRED)
  reviewedBy          String?
  reviewedAt          DateTime?
  reviewNote          String?
  idempotencyKey      String
  order               Order?
  createdAt           DateTime      @default(now())
  @@unique([companyId, idempotencyKey])
  @@index([companyId, businessDate, outcome])
  @@index([companyId, businessDate, isExceedRange])
  @@index([companyId, executiveId, businessDate])
  @@index([companyId, shopId, createdAt])
}

model Order {
  id             String         @id @default(uuid())
  companyId      String
  visitId        String         @unique
  visit          Visit          @relation(fields: [visitId], references: [id], onDelete: Cascade)
  shopId         String
  executiveId    String
  businessDate   DateTime       @db.Date
  totalQuantity  Int
  lineCount      Int
  deliveryStatus DeliveryStatus @default(PENDING)
  deliveredAt    DateTime?
  deliveredBy    String?
  lines          OrderLine[]
  createdAt      DateTime       @default(now())
  @@index([companyId, businessDate, deliveryStatus])
  @@index([companyId, shopId, createdAt])
}

model OrderLine {
  id        String  @id @default(uuid())
  companyId String
  orderId   String
  order     Order   @relation(fields: [orderId], references: [id], onDelete: Cascade)
  brandId   String
  brand     Brand   @relation(fields: [brandId], references: [id])
  brandLabel String                               // snapshot
  quantity  Int
  @@unique([orderId, brandId])
  @@index([companyId, brandId])
}

model Attendance {
  id            String            @id @default(uuid())
  companyId     String
  userId        String
  businessDate  DateTime          @db.Date
  session       AttendanceSession
  status        AttendanceStatus
  actualTime    DateTime?                          // when PRESENT
  latenessFlag  LatenessFlag?
  payableUnits  Decimal           @db.Decimal(4, 2)
  version       Int               @default(1)
  isActive      Boolean           @default(true)
  supersededById String?
  changeReason  String?
  recordedBy    String
  recordedAt    DateTime          @default(now())
  @@unique([companyId, userId, businessDate, session, version])
  @@index([companyId, businessDate, session, isActive])
  @@index([companyId, userId, businessDate])
}

model SalaryRun {
  id           String          @id @default(uuid())
  companyId    String
  periodYear   Int
  periodMonth  Int
  version      Int             @default(1)
  status       SalaryRunStatus @default(DRAFT)
  grossTotal   Decimal         @db.Decimal(14, 2)
  generatedBy  String
  generatedAt  DateTime        @default(now())
  finalisedBy  String?
  finalisedAt  DateTime?
  lines        SalaryRunLine[]
  @@unique([companyId, periodYear, periodMonth, version])
  @@index([companyId, periodYear, periodMonth])
}

model SalaryRunLine {
  id            String    @id @default(uuid())
  companyId     String
  salaryRunId   String
  salaryRun     SalaryRun @relation(fields: [salaryRunId], references: [id], onDelete: Cascade)
  userId        String
  payableUnits  Decimal   @db.Decimal(6, 2)
  amount        Decimal   @db.Decimal(12, 2)
  breakdown     Json                              // [{from,to,units,rate,amount}]
  @@unique([salaryRunId, userId])
  @@index([companyId, userId])
}

model AuditEvent {
  id            String   @id @default(uuid())
  companyId     String?
  actorUserId   String?
  actorRole     RoleKey?
  action        String                            // "shop.pin.approved"
  entityType    String
  entityId      String
  before        Json?
  after         Json?
  reason        String?
  correlationId String?
  ip            String?
  serverTime    DateTime @default(now())
  @@index([companyId, entityType, entityId])
  @@index([companyId, serverTime])
  @@index([actorUserId, serverTime])
}

model IdempotencyKey {
  key        String   @id
  companyId  String?
  userId     String?
  endpoint   String
  requestHash String
  statusCode Int?
  response   Json?
  createdAt  DateTime @default(now())
  @@index([createdAt])
}
```

### Notes on the model

- **Beat day lives on `DailyAssignment`.** One row per executive per business day holds the plan snapshot *and* the start/end lifecycle, so "is the beat running?" is a single lookup on the row the app already loaded. `status` is null until the beat starts.
- **Order vs OrderLine:** `totalQuantity` and `lineCount` are maintained by the server in the same transaction as the lines, so lists do not need an aggregate.
- **Attendance versioning:** amendments insert a new row with `version + 1` and flip the old row's `isActive`. The unique key includes `version`, so history is append-only.
- **Snapshots everywhere:** `beatPlanName`, `effectiveRadiusMeters`, `shopLatitude/Longitude`, `brandLabel`. A later master-data edit can never rewrite what a visit measured, which is BUS-05 and BUS-11 made structural.

---

## 8. Distance and nearby-shop queries

```ts
// packages/shared/src/geo.ts
export const EARTH_RADIUS_M = 6_371_008.8;
export function haversineMeters(a: LatLng, b: LatLng): number {
  const φ1 = rad(a.lat), φ2 = rad(b.lat);
  const dφ = φ2 - φ1, dλ = rad(b.lng - a.lng);
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
```

Visit distance is computed in Node from the stored shop snapshot — no database round trip, and the identical function is used in tests.

"Nearby shops not in today's list" (PRD FR-EXTRA-02) uses a bounding box in SQL, then exact Haversine ordering in Node:

```sql
SELECT id, name, "addressLine1", latitude, longitude, "locationStatus"
FROM "Shop"
WHERE "companyId" = $1
  AND "isActive"
  AND latitude  BETWEEN $2 AND $3          -- lat ± (radiusKm / 111.32)
  AND longitude BETWEEN $4 AND $5          -- lng ± (radiusKm / (111.32 * cos(lat)))
  AND id <> ALL($6)                        -- shops already in today's list
LIMIT 200;
```

If a company ever exceeds this comfortably, the upgrade is PostGIS with a `GIST` index on `geography(Point)` — a migration and a repository change, with no effect on the API contract. That is recorded as ADR-0007.

---

## 9. API surface

All routes under `/api/v1`. Commands take `Idempotency-Key`. Lists take `?cursor=&limit=&…filters`.

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/auth/login` | public | `{companyCode, username, password}` |
| POST | `/auth/refresh` | public | rotation + reuse detection |
| POST | `/auth/logout` | any | revokes the presented refresh token |
| POST | `/auth/forgot-password` | public | sends OTP to the registered mobile |
| POST | `/auth/verify-otp` | public | returns a short-lived reset token |
| POST | `/auth/reset-password` | reset token | |
| POST | `/auth/change-password` | any | revokes other sessions |
| GET | `/me` | any | profile, role, permissions, company settings |
| PATCH | `/me/photo` | any | multipart, replaces the avatar |
| POST | `/me/devices` | any | register or refresh the FCM token |
| POST | `/companies` · GET `/companies` · PATCH `/companies/:id` | System Admin | onboarding and suspension |
| GET/PATCH | `/companies/me/settings` | Company Admin | radius, accuracy, session times, payable mapping |
| GET/POST/PATCH | `/users`, `/users/:id` | Company Admin | create, update, deactivate |
| POST | `/users/:id/salary-rates` | Company Admin | new effective-dated rate |
| GET/POST/PATCH | `/brands`, `/reasons` | Company Admin | reorder via `PATCH …/order` |
| GET/POST/PATCH | `/shops`, `/shops/:id` | Company Admin | filters: beat, pin status, active |
| POST | `/shops/:id/photos` · DELETE `/shops/:id/photos/:photoId` | Admin, Exec (own capture) | multipart |
| POST | `/shops/:id/pin` | Exec (first capture), Admin | accuracy-gated |
| POST | `/shops/:id/pin-changes` | Exec | correction request |
| POST | `/shops/:id/pin-changes/:cid/decide` | Manager, Admin | approve or reject |
| GET/POST/PATCH | `/beat-plans`, `/beat-plans/:id` | Company Admin | shops and order in the body |
| GET | `/assignments/today` | Exec | own assignment with stops and beat-day status |
| GET | `/assignments?date=&executiveId=` | Manager, Admin | |
| POST | `/assignments/:id/start` | Exec | `{lat,lng,accuracyMeters,capturedAt}` |
| POST | `/assignments/:id/end` | Exec | same + optional `note` |
| POST | `/assignments/:id/stops` | Exec | extra shop, own day |
| POST | `/assignments/:id/stops/manager` | Manager | extra shop with `reason` |
| GET | `/shops/nearby?lat=&lng=&excludeAssignment=` | Exec | picker source |
| GET | `/stops/:id` | Exec, Manager, Admin | includes last five interactions |
| POST | `/visits` | Exec | the main command; see §10 |
| GET | `/visits` | Manager, Admin | filters: date, outcome, range, executive, beat, source |
| GET | `/visits/mine` | Exec | range fields stripped |
| GET | `/visits/:id` | Manager, Admin | |
| POST | `/visits/:id/review` | Manager | accept or request revisit |
| POST | `/orders/:id/deliver` | Manager, Admin | marks delivered |
| GET | `/attendance?date=` · POST `/attendance` | Manager, Admin | upsert creates an amendment |
| GET | `/salary-runs` · POST `/salary-runs` · POST `/salary-runs/:id/finalise` | Company Admin | |
| GET | `/reports/previous-day?date=` | Manager, Admin | |
| GET | `/reports/executive-totals?from=&to=` | all, scoped | |
| GET | `/reports/shop-history/:shopId` | Manager, Admin | |
| GET | `/reports/*/export.csv` | Manager, Admin | streamed, audited |
| GET | `/files/:id?token=` | any with the signed token | serves the photo |
| GET | `/healthz` · `/readyz` | public | Railway healthcheck |

OpenAPI is generated from the Zod schemas (`nestjs-zod` + `@nestjs/swagger`) and committed to `docs/openapi.json`, so Claude Code and Metaswarm agents can read the contract without running the server.

---

## 10. Visit submission — the critical path

```
Exec taps "Submit visit"
  │ client: read fresh position (expo-location, highest accuracy, 10 s timeout)
  │ client: build payload + ULID idempotency key, persist to SQLite queue first
  ▼
POST /api/v1/visits   Idempotency-Key: 01JB…
  │
  ├─ IdempotencyInterceptor: key seen? → replay the stored response, stop here
  ├─ Validate payload (Zod)
  ├─ Load stop → assignment → shop  (tenant-scoped, inside the transaction)
  ├─ Reject: stop not mine · assignment not today · beat not RUNNING
  │          · stop already COMPLETED · shop pin not APPROVED
  ├─ flags = []
  │    accuracyMeters > maxAccuracyMeters        → LOW_ACCURACY
  │    receivedAt − capturedAt > maxAgeSeconds   → STALE_LOCATION
  │    mockLocationReported                      → MOCK_LOCATION_SUSPECTED
  │    payload.offlineQueued                     → OFFLINE_SUBMISSION
  ├─ distanceMeters   = haversine(shop snapshot, captured point)
  ├─ effectiveRadius  = shop.verificationRadiusMeters ?? settings.defaultRadiusMeters
  ├─ isExceedRange    = distance > effectiveRadius → push EXCEED_RANGE,
  │                     reviewStatus = PENDING_REVIEW
  ├─ Create Visit (+ Order and OrderLines when outcome = ORDER)
  ├─ Update stop.status = COMPLETED
  ├─ Write AuditEvent, store the idempotent response
  └─ Commit
  │
  ├─ after commit: FCM VISIT_FLAGGED to the manager when flagged
  ▼
201 { visitId, stopId, status: "COMPLETED" }     ← no distance, no flags for the exec
```

Everything from loading the stop to committing happens in **one transaction**, which is what makes "an order and its visit are created atomically" (BR/FR-ORD-05) true rather than aspirational. Notifications fire after commit so a push failure cannot roll back a saved visit.

### Beat-day state machine

```
        (no row)
           │ POST /assignments/:id/start
           ▼
        RUNNING ──────── POST /assignments/:id/end ───────▶ ENDED
           │                                                 │
           │ nightly job at settings.beatAutoCloseAt          │
           └──────────────────────────────────────▶ AUTO_CLOSED
```

Allowed only in `RUNNING`: create a visit, add an extra stop, capture a shop pin. `start` on a running day and `end` on an ended day both return the current row with `200`, never an error — so a double tap or a retry is harmless.

---

## 11. Idempotency

```ts
// commands only
const existing = await tx.idempotencyKey.findUnique({ where: { key } });
if (existing) {
  if (existing.requestHash !== hash(body)) throw new ConflictException('IDEMPOTENCY_KEY_REUSED');
  return reply(existing.statusCode!, existing.response);
}
// … handler …
await tx.idempotencyKey.create({ data: { key, companyId, userId, endpoint, requestHash: hash(body), statusCode: 201, response } });
```

Keys are ULIDs minted on the device and kept with the queued mutation, so a retry after a timeout carries the same key. A nightly job deletes keys older than 7 days.

---

## 12. Photo storage on Railway

### Adapter

```ts
export interface StorageAdapter {
  put(key: string, body: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
```

`LocalVolumeAdapter` writes under `process.env.RAILWAY_VOLUME_MOUNT_PATH` (`/data`), sharded as `photos/<companyId>/<yyyy>/<mm>/<uuid>.webp`. `S3Adapter` is written at the same time and covered by the same contract test suite, so the switch is a configuration change.

### Pipeline

1. The app sends multipart, max 10 MB, `image/jpeg|png|webp|heic`.
2. The API verifies the magic bytes, not just the declared type.
3. `sharp` auto-rotates from EXIF, strips all other metadata, resizes to a 1600 px long edge, encodes WebP quality 80, and also writes a 320 px thumbnail.
4. A `FileObject` row records key, mime, bytes, dimensions and sha256. An identical sha256 within the company reuses the existing object.
5. Reads go through `GET /files/:id?token=…`, where the token is a 10-minute HMAC of `fileId|userId|exp`. React Native's `<Image>` can load that URL directly, and the link cannot be shared beyond its expiry.

### Honest trade-offs

- A Railway volume attaches to **one** service instance. While photos live on the volume, the API runs a **single replica**. Scaling out requires moving to S3-compatible storage first — hence D-11.
- There is no CDN in front of the volume. Thumbnails keep list screens cheap; full images are fetched only on a detail screen.
- Volume contents are **not** covered by Postgres backups. A nightly job tars new objects and ships them off-site (or an S3 bucket), and the restore drill in P5 covers both database and volume.
- `FileObject` rows are the source of truth. An orphan sweeper reconciles volume to table weekly and reports, rather than deleting silently.

---

## 13. Notifications

`firebase-admin` with a service account in an environment variable. Tokens are stored per user and device; `sendEachForMulticast` results are inspected and `UNREGISTERED` tokens are deleted. Sends happen after commit, through an outbox table so a crash between commit and send retries rather than losing the message. Payload carries `{type, entityId, title, body}` only — never coordinates or free text (NFR-10).

---

## 14. Scheduled jobs

| Job | Schedule (company-local, resolved per company) | Work |
|---|---|---|
| `materialise-assignments` | 00:05 | Create tomorrow's `DailyAssignment` + `AssignmentStop` rows for active executives whose plan covers that weekday |
| `beat-not-started-reminder` | `settings.beatNotStartedAt` | Push to executives with no `startedAt`, then to their manager |
| `beat-not-ended-reminder` | `settings.beatNotEndedAt` | Push to executives still `RUNNING` |
| `auto-close-beat-days` | `settings.beatAutoCloseAt` | Set `ENDED` + `autoClosed = true` |
| `salary-draft` | 1st of the month, 02:00 | Generate the previous month's draft run |
| `cleanup` | 03:00 | Expired refresh tokens, OTPs, idempotency keys older than 7 days |
| `photo-backup` | 03:30 | Ship new volume objects off-site |

Implemented with `@nestjs/schedule` on a single replica. Every job wraps its body in `pg_try_advisory_lock(hashtext($jobName))`, so a second instance during a deploy cannot double-run it. When the API scales out, these move to BullMQ with Railway Redis — the job bodies are plain services and do not change.

---

## 15. Time and timezone handling

- All timestamps are `timestamptz`, stored UTC. The API never trusts a client clock for anything except the `capturedAt` fact, which is recorded *and* compared against `serverReceivedAt`.
- `businessDate` is a `DATE` computed from the company timezone with Luxon: `DateTime.fromJSDate(serverNow, { zone: company.timezone }).toISODate()`.
- A `CompanyClock` service is the only place that converts. Tests cover the IST boundary (18:30 UTC), DST-free IST, and a company configured in a DST zone, because a future customer may not be in India.
- `HH:mm` settings (session starts, reminder times) are stored as strings and resolved against the business date in the company zone.

---

## 16. Mobile architecture

```
src/
├─ api/            generated types from docs/openapi.json + typed fetch client
├─ features/
│  ├─ auth/        login, forgot password, change password
│  ├─ today/       beat card state machine, shop list, extra shop
│  ├─ visit/       shop visit, order entry, no order, confirm sheet
│  ├─ pin/         capture + accuracy gate
│  ├─ history/     my visits, my totals
│  ├─ manager/     report, visits, details, attendance
│  └─ admin/       masters, beat plans, shops, users, salary
├─ offline/        queue (SQLite), sync engine, conflict surface
├─ lib/            location, permissions, secure store, logger, analytics
├─ theme/          tailwind preset, tokens, typography
└─ navigation/     role-based navigators
```

- **Routing by role.** `useSession().role` selects one of four navigators, so an executive's bundle never renders an admin screen. Deep links are validated against the role before navigating.
- **Server state** is TanStack Query; **session and UI state** is Zustand persisted to MMKV. Queries that back the Today screen use `staleTime: 30s` and refetch on app foreground.
- **Location** is `expo-location`, foreground only, with `Accuracy.Highest` and a 10-second timeout; the permission rationale screen appears before the OS prompt. Mock-location detection reads `mocked` on Android positions.
- **Maps** use `react-native-maps` with the Google provider; the pin-capture screen keeps the map uncontrolled and reads the marker position on save, which avoids the laggy drag you get from re-rendering on every gesture.
- **Forms** use `react-hook-form` with the Zod resolvers from `packages/shared`, so the client and the API reject exactly the same payloads.
- **Styling** is NativeWind with a shared Tailwind preset: `brand` blue `#1D4ED8`, amber for warnings and out-of-range, red for errors, violet for extra and revisit. Tokens, not raw hexes, in feature code.

### Offline queue

```
mutate() → write to SQLite `outbox` (id = ULID, endpoint, body, attempts, createdAt)
        → optimistic cache update, row shown as "Waiting to sync"
        → NetInfo online? drain FIFO, one in flight at a time
        → 2xx: delete row, invalidate queries
        → 4xx (not 408/429): move to `failed`, surface a card the user can inspect
        → 5xx/timeout: exponential backoff 2s→5m, keep the same Idempotency-Key
        → older than settings.offlineMaxAgeHours: mark expired, prompt the user
```

Only visit submission, extra-shop addition, pin capture and beat start/end are queueable. Reads are never queued; they fall back to the last cached payload with a visible "showing saved data" banner.

### One build per company

`app.config.ts` reads `COMPANY_CODE`, `COMPANY_NAME`, `API_URL` and the Google Maps key from the EAS profile:

```ts
export default ({ config }) => ({
  ...config,
  name: process.env.COMPANY_NAME,
  slug: `fieldsales-${process.env.COMPANY_CODE?.toLowerCase()}`,
  android: { package: `app.fieldsales.${process.env.COMPANY_CODE?.toLowerCase()}` },
  extra: { companyCode: process.env.COMPANY_CODE, apiUrl: process.env.API_URL },
});
```

`eas.json` holds one build profile per company. Adding a customer is a profile plus a Firebase app registration, not a code change. The login screen reads `companyCode` from `expo-constants` and sends it with every login.

---

## 17. Railway deployment

| Service | Source | Notes |
|---|---|---|
| `api` | `apps/api/Dockerfile`, root `/` | Healthcheck `/healthz`, single replica while photos live on the volume |
| `postgres` | Railway Postgres | `DATABASE_URL` injected; direct connection, no external pooler |
| `volume` | attached to `api` at `/data` | Photos and nightly tarballs |
| `cron` *(optional)* | same image, `node dist/jobs/run.js <job>` | Only if jobs are moved out of the API |

Three environments — `development`, `staging`, `production` — each with its own database, volume and Firebase project (NFR-11).

**Migrations.** The container start command is:

```
npx prisma migrate deploy && node dist/main.js
```

Prisma's migration advisory lock makes this safe if two containers start together. Destructive migrations are split into expand → backfill → contract across releases, because Railway replaces containers without a release phase.

**Required environment variables**

```
DATABASE_URL           JWT_ACCESS_SECRET      JWT_REFRESH_SECRET
JWT_ACCESS_TTL=15m     JWT_REFRESH_TTL=60d
FILE_URL_SECRET        RAILWAY_VOLUME_MOUNT_PATH=/data
FIREBASE_SERVICE_ACCOUNT_JSON                 FCM_PROJECT_ID
SMS_PROVIDER_KEY       SMS_SENDER_ID
GOOGLE_MAPS_SERVER_KEY SENTRY_DSN
NODE_ENV               LOG_LEVEL=info         APP_BASE_URL
```

Secrets live in Railway variables, never in the repo. `packages/shared/src/env.ts` validates them with Zod at boot and the process refuses to start if one is missing or malformed.

---

## 18. Observability

- **Logs**: `pino` JSON with `requestId`, `companyId`, `userId`, `route`, `durationMs`. A redaction list covers `password`, `token`, `authorization`, `latitude`, `longitude`, `reasonText`, `otp` (NFR-10).
- **Errors**: Sentry on both API and mobile, with release and company tags but no coordinates.
- **Health**: `/healthz` is liveness; `/readyz` checks Postgres and the volume mount.
- **Metrics that matter**: visit submission p95, offline queue depth and age, flagged-visit rate per executive, assignment materialisation success, FCM delivery failures, login failure rate.
- **Audit** is a product feature, not a log: `AuditEvent` rows are queried by the admin, so they are written in the same transaction as the change.

---

## 19. Testing strategy

| Level | Tool | Must cover |
|---|---|---|
| Unit | Vitest | Haversine, flag classification, lateness derivation, payable units, salary with a mid-month rate change, business-date conversion, beat-day transitions |
| Contract | Vitest + Zod | Every shared schema round-trips; OpenAPI matches the schemas |
| Integration | Jest + Testcontainers Postgres | Tenant isolation at both layers, RLS denial without context, idempotent retries, atomic visit + order, attendance amendment history, salary versioning |
| Security | custom suite | Executive responses never contain `distanceMeters`/`flags`; role matrix per route; token reuse revokes the family; expired and tampered JWTs |
| E2E API | Supertest | The full day: login → start → capture pin → order → extra shop → end → manager review |
| Mobile E2E | Maestro | Login, start beat, record order offline then sync, end beat with a pending stop |
| Load | k6 | 1,000 executives × 15 visits in a 3-hour window; list screens at 10,000 shops |

CI gate: typecheck, lint, unit, integration, and a tenant-isolation suite that must pass before any deploy.

---

## 20. Security checklist

- Argon2id passwords; no password ever logged or returned.
- JWT secrets at least 64 bytes, rotated per environment; `tokenVersion` for instant invalidation.
- Rate limits: 10/min per IP on auth, 6 failures per username per 15 min, 120/min per user elsewhere.
- Tenant isolation in the ORM extension **and** Postgres RLS, with tests for both.
- Derived fields server-only; a client-sent `distanceMeters` is rejected by the schema, not ignored.
- Signed, short-lived file URLs; no public bucket or directory listing.
- Upload validation by magic bytes, size cap, metadata stripped, re-encoded before storage.
- Helmet, strict CORS allowlist, HTTPS only, HSTS.
- Mobile: tokens in `expo-secure-store`, no secrets in the JS bundle, certificate pinning considered for a later release, Android `allowBackup=false`.
- Privacy: location is read only at pin capture, visit submission and beat start/end — never in the background. The permission rationale says exactly that, and the PRD's retention setting governs how long precise coordinates are kept.

---

## 21. Working with Claude Code, Spec Kit and Metaswarm

### Suggested slice order

Each slice is one Spec Kit feature with its own `spec.md`, `plan.md` and `tasks.md`, and each ends with a working vertical: migration, API, tests, mobile screen.

```
001-foundation            monorepo, CI, Prisma baseline, env validation, health
002-auth-and-session      login, refresh rotation, OTP reset, change password, /me
003-company-and-users     companies, settings, roles, users, salary rates, audit
004-masters               brands, reasons, reorder, activation
005-files-and-photos      storage adapter, upload pipeline, signed URLs, avatars
006-shops                 shop CRUD, photos, pin capture + accuracy gate, corrections
007-beat-plans            plans, ordered shops, working days, assignment job
008-beat-day              start/end, auto-close, reminders, locked states
009-visits-and-orders     the critical path, flags, idempotency, atomicity
010-extra-shops           exec picker, manager add with reason, nearby query
011-attendance            day sheet, sessions, lateness, amendments
012-manager-review        report, visits list, three detail screens, delivery
013-salary                runs, versioning, finalise, breakdown
014-reports-and-export    executive totals, shop history, CSV, audit of exports
015-notifications         FCM outbox, device tokens, all event types
016-hardening             offline limits, load tests, backup drill, a11y pass
```

### Constitution — paste into `.specify/memory/constitution.md`

```markdown
# Field Sales — Engineering Constitution

1. The server owns the truth. Distance, range flags, totals, payable units and
   audit records are computed server-side. A client value for any of them is
   rejected, never trusted.
2. Tenant isolation is non-negotiable. Every tenant table carries companyId,
   enforced by the Prisma extension and by Postgres RLS. A new table without
   both fails CI.
3. Commands are idempotent. Every POST that changes state accepts an
   Idempotency-Key and a retry must never duplicate.
4. History is append-only. Amendments and corrections create new rows with a
   reason and an actor. Nothing is silently overwritten, and snapshots keep
   master-data edits from rewriting the past.
5. One contract. Request and response shapes are defined once in
   packages/shared with Zod and used by both the API and the app.
6. Role visibility is explicit. A Marketing Executive never receives distance
   or quality flags in any response. Every endpoint has a role test.
7. The field app must work on a bad network. Field-critical mutations queue
   offline with the same idempotency key and sync in order.
8. Times are UTC in storage, company-local in meaning. Only CompanyClock
   converts between them.
9. No secret, token, password, precise coordinate or free-text reason is ever
   written to a log or an analytics payload.
10. Every slice ships a migration, an API, tests and the screen that uses it.
    "Backend done, UI later" is not a slice.
```

### Metaswarm split that matches these boundaries

| Agent | Owns | Must not touch |
|---|---|---|
| `schema` | `prisma/schema.prisma`, migrations, RLS generator, seeds | API handlers, mobile |
| `api` | `apps/api/src/modules/**`, guards, interceptors | schema file, mobile |
| `contract` | `packages/shared/**`, `docs/openapi.json` | implementations |
| `mobile` | `apps/mobile/src/**` | API internals |
| `qa` | `test/**`, `e2e/**`, CI workflows | production code |

Running `schema` and `contract` to completion before `api` and `mobile` start on the same slice avoids the merge thrash that comes from two agents editing a shared type.

---

## 22. Open technical decisions

| ID | Question | Recommendation | Needed by |
|---|---|---|---|
| T-01 | Does the executive's extra shop need manager approval? | No for release 1; flag it as an extra visit (BRD OD-08) | Slice 010 |
| T-02 | Do beat start/end times auto-fill attendance? | No for release 1; show them beside attendance for context (BRD OD-09) | Slice 011 |
| T-03 | Where does the System Admin work? | API + seed script now; a small Next.js console later | Slice 003 |
| T-04 | PostGIS now or later? | Later; bounding box + Haversine is enough at the stated volumes (ADR-0007) | Slice 006 |
| T-05 | Expo managed vs bare prebuild? | Prebuild, because `react-native-maps` with the Google provider and per-company native ids need native config | Slice 001 |
| T-06 | OTP channel | SMS now; email as a fallback where a mobile number is missing | Slice 002 |
| T-07 | Order value and prices | Keep the price-snapshot columns unused in release 1 (BRD OD-07) | Slice 009 |
| T-08 | Data retention for precise coordinates | Make it a company setting; default keep indefinitely, review before go-live | Slice 016 |
| T-09 | When to introduce Redis + BullMQ | At the first need for more than one API replica, which is also when photos must leave the volume | P5 |
