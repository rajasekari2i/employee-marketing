# Phase 1 Data Model: Beat Plans CRUD (Company Admin)

New Prisma models this feature adds to `apps/api/prisma/schema.prisma`, trimmed from Architecture §4's full `BeatPlan`/`BeatPlanShop` (lines 516–544) to exactly what this slice needs — the same "build only what's reachable now" posture `002-shops-crud`'s data-model.md used.

**Every multi-word column gets `@map("snake_case")`** — called out explicitly here because `002-shops-crud` shipped one column (`shopCode`) without it, found live during manual verification and fixed with a rename migration. This data model has been checked field-by-field against that rule.

## BeatPlan

Company-scoped master record for one executive's fixed route.

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | |
| `companyId` | `String @map("company_id")` | Tenant column — Layer 1 (Prisma extension) + Layer 2 (RLS), per CLAUDE.md rule 2. |
| `code` | `String` | Required. **Unique with `companyId`** (`@@unique([companyId, code])`) — FR-010. Single word, no `@map` needed. |
| `name` | `String` | Required. Single word, no `@map` needed. |
| `executiveId` | `String? @map("executive_id")` | Optional (FR-011) — a plan may have no assigned executive. When set, must resolve to an `ACTIVE` `MARKETING_EXECUTIVE` user in the same company (service-level validation, not a DB constraint — Prisma can't express a role-conditional FK). |
| `executive` | `User? @relation(fields: [executiveId], references: [id])` | |
| `workingDays` | `Int[] @map("working_days")` | 1 = Mon … 7 = Sun (Architecture's own convention). May be empty (spec Assumption: "no minimum"). |
| `isActive` | `Boolean @default(true) @map("is_active")` | Deactivate-not-delete — FR-013. |
| `shops` | `BeatPlanShop[]` | |
| `createdAt` | `DateTime @default(now()) @map("created_at")` | |
| `updatedAt` | `DateTime @updatedAt @map("updated_at")` | |

Indexes: `@@unique([companyId, code])`, `@@index([companyId, isActive])`, `@@index([companyId, executiveId])`.

*Deliberately omitted* (vs. the full architecture model): `assignments DailyAssignment[]` — `DailyAssignment` doesn't exist yet (that's `008-beat-day`); this relation is added additively whenever that slice is built, the same way this slice is now adding `Shop.beatPlanShops` and `User.assignedBeatPlans` onto models `002-shops-crud`/`001-company-user-auth` already shipped.

## BeatPlanShop

One shop's position within one beat plan's route. Not a history/audit entity — see "Why no append-only treatment" below.

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | |
| `companyId` | `String @map("company_id")` | Tenant column. |
| `beatPlanId` | `String @map("beat_plan_id")` | `@relation(fields: [beatPlanId], references: [id], onDelete: Cascade)` — deleting a plan's rows happens as part of this feature's own full-replace-on-save logic, not a user-facing "delete the plan" action (FR-013: plans are deactivated, never deleted; this cascade only ever fires from the service's own replace-the-list step). |
| `shop` | `Shop @relation(fields: [shopId], references: [id])` | |
| `shopId` | `String @map("shop_id")` | |
| `sequence` | `Int` | Server-assigned from the submitted array's position (research.md §1) — never accepted from the client as an explicit field. Single word, no `@map` needed. |

Indexes: `@@unique([beatPlanId, shopId])` (the same shop can't appear twice in one plan — spec edge case), `@@index([companyId, beatPlanId, sequence])`.

### Why no append-only treatment (Constitution rule 4)

`BeatPlanShop` rows are replaced wholesale on every save (research.md §1) — this looks like it could conflict with "History is append-only," but it doesn't: `BeatPlanShop` *is* the current route, not a historical record of past routes. The entity that actually needs append-only protection is `DailyAssignment` (a frozen-at-creation snapshot of "what this executive's route looked like on this specific day"), which doesn't exist yet. When `008-beat-day` is built, it reads today's `BeatPlan`/`BeatPlanShop` state *once*, at assignment time, and copies it into an immutable `DailyAssignment` row — at that point, editing a `BeatPlan` afterward correctly has zero effect on any `DailyAssignment` already created, exactly as FR-016's on-screen copy says. This feature doesn't implement that copy step; it only needs `BeatPlan`/`BeatPlanShop` to correctly reflect "the route as currently configured," which a full replace does correctly and simply.

## Additive relations on existing models

Both are schema-only additions — no `ALTER COLUMN`, no data migration, no change to any existing index or constraint (research.md §5).

```prisma
model Shop {
  // ...existing fields unchanged...
  beatPlanShops BeatPlanShop[]
}

model User {
  // ...existing fields unchanged...
  assignedBeatPlans BeatPlan[]
}
```

## Validation rules (enforced in `beat-plans.schema.ts` / `beat-plans.service.ts`)

- `code`: required, unique per company (case-sensitive, same posture as `Shop.shopCode`); a duplicate on create or edit is rejected with `AppError('DUPLICATE_BEAT_PLAN_CODE', ...)`, never a silent overwrite (FR-010).
- `name`: required, non-empty.
- `executiveId`: optional; when present, the service verifies it resolves to a `User` in the caller's own `companyId` whose `role.key === 'MARKETING_EXECUTIVE'` and `status === 'ACTIVE'` — an id that doesn't resolve (wrong company, wrong role, inactive, or unknown) is rejected with `VALIDATION_FAILED`, not silently cleared or silently accepted.
- `workingDays`: an array of distinct integers, each `1`–`7`; may be empty.
- `shopIds`: an array of shop ids, each resolving to a `Shop` in the caller's own `companyId` (an id from another company, or an unknown id, is rejected with `VALIDATION_FAILED`); duplicate ids within the same array collapse to the shop's first position rather than erroring, so a double-tap in the picker UI can't produce two rows for the same shop (the `@@unique([beatPlanId, shopId])` index is the DB-level backstop for this). May be empty (FR-011).
- `isActive`: optional boolean, default `true` on create.
- Server-only, never accepted from the client (CLAUDE.md rule 1): `id`, `companyId`, every `BeatPlanShop.sequence` value (always derived from `shopIds` array position), `createdAt`, `updatedAt`.

## State transitions

**`BeatPlan.isActive`**: `true ⇄ false` via `PATCH /beat-plans/:id`. No delete path exists at any point (research.md's parity with `002-shops-crud`'s FR-ADM-09 posture).

**`BeatPlan.shops` (via `BeatPlanShop`)**: fully replaced on every `POST`/`PATCH` that includes a `shopIds` field — there is no partial-update/diff state to model; omitting `shopIds` entirely from a `PATCH` body leaves the existing list untouched (same "only provided fields change" convention `UpdateShopInput` already established).
