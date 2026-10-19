# Phase 1 Data Model: Brands & Reasons CRUD (Company Admin)

Two new Prisma models in `apps/api/prisma/schema.prisma`, taken from Architecture §4 (lines 419–441) and trimmed to what this slice can actually reach — the same "build only what's reachable now" posture `002-shops-crud` and `003-beat-plans-crud` used.

**Every multi-word column gets `@map("snake_case")`** — carried forward from `003-beat-plans-crud`'s data model, which called this out because `002-shops-crud` shipped `shopCode` without it and needed a rename migration to fix it. Checked field-by-field below.

## Brand

Company-scoped master; later becomes the subject of an order line (`009-visits-and-orders`).

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | |
| `companyId` | `String @map("company_id")` | Tenant column — Layer 1 (Prisma extension) + Layer 2 (RLS), per CLAUDE.md rule 2. |
| `label` | `String` | Required, trimmed, 2–60 chars. Unique per company **case-insensitively** — see "Case-insensitive uniqueness" below. Single word, no `@map`. |
| `displayOrder` | `Int @map("display_order")` | Server-derived from array position, never client-sent (research.md §1). |
| `isActive` | `Boolean @default(true) @map("is_active")` | Deactivate-not-delete — FR-015. |
| `createdAt` | `DateTime @default(now()) @map("created_at")` | |
| `updatedAt` | `DateTime @updatedAt @map("updated_at")` | |

Indexes: `@@unique([companyId, label])`, `@@index([companyId, isActive, displayOrder])` (both exactly as Architecture §4 specifies), plus the hand-written functional unique index below.

*Deliberately omitted* vs. Architecture's model: `orderLines OrderLine[]` — `OrderLine` doesn't exist yet (that's `009-visits-and-orders`). Added additively by that slice, the same way `003-beat-plans-crud` deferred `assignments DailyAssignment[]`.

*Deliberately added* vs. Architecture's model: `createdAt`/`updatedAt`. Architecture's sketch omits them, but every other model in this schema carries the pair and it costs nothing; ordering never depends on them (that's `displayOrder`'s job), so they are purely for audit and debugging.

## ReasonMessage

Company-scoped master; later becomes the single-select reason on a no-order visit (`009-visits-and-orders`).

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | |
| `companyId` | `String @map("company_id")` | Tenant column. |
| `label` | `String` | As `Brand.label`. The system row's label is exactly `Other`. |
| `displayOrder` | `Int @map("display_order")` | As `Brand.displayOrder`. The system row keeps a `displayOrder` value but never sorts by it — see "Ordering" below. |
| `isActive` | `Boolean @default(true) @map("is_active")` | The system row is always `true` and cannot be toggled (FR-011). |
| `requiresText` | `Boolean @default(false) @map("requires_text")` | `true` only for the system "Other" row. Server-set, never client-sent. |
| `isSystem` | `Boolean @default(false) @map("is_system")` | `true` only for the "Other" row. Server-set, never client-sent. Drives every guard in FR-011. |
| `createdAt` | `DateTime @default(now()) @map("created_at")` | |
| `updatedAt` | `DateTime @updatedAt @map("updated_at")` | |

Indexes: `@@unique([companyId, label])`, `@@index([companyId, isActive, displayOrder])`, plus the functional unique index below.

*Deliberately omitted*: `visits Visit[]` — `Visit` doesn't exist yet (`009-visits-and-orders`).

### Why `requiresText` is a column and not a hard-coded check on the label

Architecture §4 models it as a column, and the field app's later behaviour ("choosing Other makes a free-text field required", PRD FR-VISIT-08) should key off data, not a magic string. Keeping it a column means the one place that decides "this reason needs a note" is a boolean the visit feature reads, rather than a label comparison that breaks the moment a company's "Other" is presented in another language. This slice never lets a client set it.

## Case-insensitive uniqueness

`@@unique([companyId, label])` is a plain Postgres unique index and is therefore **case-sensitive** — it would happily store `Parle` and `parle` side by side, which FR-007 forbids. Prisma's schema language cannot express a functional index, so each table gets one hand-written statement appended to its migration (the coding standard already sanctions hand-edited migrations for exactly this kind of thing):

```sql
CREATE UNIQUE INDEX brands_company_lower_label_key
  ON "brands" ("company_id", lower("label"));
CREATE UNIQUE INDEX reason_messages_company_lower_label_key
  ON "reason_messages" ("company_id", lower("label"));
```

The service still pre-checks with a case-insensitive lookup so the admin gets `DUPLICATE_BRAND_LABEL` / `DUPLICATE_REASON_LABEL` (409) rather than a raw constraint violation; the index is the backstop that makes a race structurally impossible. The label is **stored with the capitalisation the admin typed** — only the comparison is case-folded.

## Ordering

Both lists are returned ordered by `[{ isSystem: 'asc' }, { displayOrder: 'asc' }]`.

`isSystem` sorts `false` before `true`, so the "Other" row lands last **by construction** rather than by being given an artificially large `displayOrder` that a later insert could overtake (FR-010, FR-013). `Brand` has no `isSystem` column, so its ordering is simply `displayOrder` ascending.

`displayOrder` is **0-based**, assigned from the submitted array's position — the same convention `BeatPlanShop.sequence` already established (`003-beat-plans-crud` data-model.md). The row number the design prints (`1`, `2`, `3`…) is the list position plus one, computed at render time; the stored value is never shown directly. This keeps "what's stored" and "what's displayed" from drifting, and makes a gap or duplicate structurally impossible rather than something to validate.

## Validation rules

Enforced in `packages/shared/src/masters.schema.ts` and the two services.

- `label`: required; trimmed before validation and before storage; 2–60 characters after trimming (research.md §4); rejected as `VALIDATION_FAILED` when empty/whitespace-only or out of range, never silently truncated (FR-007, FR-009).
- `label` uniqueness: case-insensitive and whitespace-trimmed, scoped to `(companyId, <that one table>)`. Brands and reasons are separate tables, so the same text may exist once in each (FR-008) without any special handling.
- A client attempt to create a reason labelled `Other` collides with the system row through the ordinary duplicate path — no special-casing needed (spec US2 scenario 4).
- `isActive`: boolean, optional on update.
- `label` on update: same rules as on create, plus the row is excluded from its own duplicate check — so re-saving an unchanged label, or changing only its capitalisation, succeeds. A rename leaves `displayOrder` untouched. (Rename was scoped out originally and added on 2026-10-19 at the user's request.)
- An update body with neither field is rejected as `VALIDATION_FAILED` rather than succeeding as a no-op.
- **Server-only, never accepted from a client** (CLAUDE.md rule 1): `id`, `companyId`, `displayOrder`, `requiresText`, `isSystem`, `createdAt`, `updatedAt`. The Zod schemas simply do not contain these keys, so a client that sends one fails validation rather than having it silently dropped.

### Guards on the system reason (FR-011)

Every one of these is a server-side rejection, not merely a hidden control in the UI:

| Attempt | Result |
|---|---|
| `PATCH /reasons/:id` on the system row (rename or deactivate) | `409 SYSTEM_REASON_IMMUTABLE` |
| Renaming another reason **to** `Other` | `409 DUPLICATE_REASON_LABEL` |
| `PATCH /reasons/order` with the system row's id in `ids` | `409 SYSTEM_REASON_IMMUTABLE` |
| `POST /reasons` with label `Other` | `409 DUPLICATE_REASON_LABEL` |
| Any delete | No delete route exists on either resource |

## State transitions

**`isActive`**: `true ⇄ false` via `PATCH /brands/:id` or `PATCH /reasons/:id`. No delete path exists at any point — the same posture `002-shops-crud` and `003-beat-plans-crud` already take for FR-ADM-09.

**`displayOrder`**: rewritten wholesale by `PATCH /brands/order` / `PATCH /reasons/order`, which take the complete ordered id list and renumber every row from its array position inside one transaction (research.md §1). There is no partial-move state to model.

**`isSystem` / `requiresText`**: set once, at creation of the "Other" row, by the bootstrap path (research.md §3). Never transition afterwards.

## Company bootstrap invariant

Every company has **exactly one** `ReasonMessage` with `isSystem: true` (FR-011, SC-005). That invariant is established in two places and guarded in a third:

1. **New companies** — the company-creation path creates the row in the same transaction as the company itself (research.md §3).
2. **Existing companies** — a one-time data backfill in this slice's migration inserts the missing row for every company already in the table (research.md §3).
3. **Guard** — a partial unique index makes a second system row impossible, so the invariant cannot be broken by a future code path:

```sql
CREATE UNIQUE INDEX reason_messages_one_system_per_company
  ON "reason_messages" ("company_id") WHERE "is_system";
```
