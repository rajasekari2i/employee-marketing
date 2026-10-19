# Contract: Masters (Brands & Reasons)

Base paths `/api/v1/brands` and `/api/v1/reasons`, exactly as Architecture §7's API surface table specifies ("`GET/POST/PATCH | /brands`, `/reasons` | Company Admin | reorder via `PATCH …/order`"). Both are Company Admin only and tenant-scoped — the Prisma extension injects `companyId` from the request's CLS context on every operation, so an admin can never read or write another company's masters.

The two resources are deliberately **symmetric**: same verbs, same request shapes, same error semantics. Reasons add three read-only response fields and one extra guard. Everything below that says "brand" applies identically to a reason unless stated.

Every mutating route requires an `Idempotency-Key` header (`RequireIdempotencyKeyGuard`, as on every other command in this codebase).

> **Implementation note — route declaration order.** `PATCH /brands/order` must be declared **before** `PATCH /brands/:id` in the controller. NestJS matches routes in declaration order, so a `:id` route declared first would swallow `/order` and treat `"order"` as an id. Same for `/reasons`.

## `GET /brands` — Company Admin

**Query**: none.

Unlike `/shops` and `/beat-plans`, this list is **not paginated and not searchable** — research.md §2 explains why (the whole list must be in hand to reorder it, and these lists are tens of rows, not thousands; the design board offers neither a search field nor an infinite scroll).

**Response `200`**
```ts
{
  items: Array<{
    id: string;
    label: string;
    displayOrder: number;   // 0-based; the design's printed row number is index + 1
    isActive: boolean;
  }>;
}
```

Ordered by `displayOrder` ascending. Both active and inactive rows are returned in one list — the design shows them interleaved in a single ordering, distinguished by row styling, not segregated (spec US4 scenario 4).

## `GET /reasons` — Company Admin

Same shape, three extra read-only fields:

```ts
{
  items: Array<{
    id: string;
    label: string;
    displayOrder: number;
    isActive: boolean;
    requiresText: boolean;  // true only for the system "Other" row
    isSystem: boolean;      // true only for the system "Other" row
  }>;
}
```

Ordered by `isSystem` ascending, then `displayOrder` ascending — so the system "Other" row is **always last**, by construction rather than by holding a large `displayOrder` (data-model.md, "Ordering"). The client renders it in the design's locked style and never has to sort or special-case it itself.

Every company always returns at least one item: its own "Other" row (data-model.md, "Company bootstrap invariant").

## `POST /brands` — Company Admin

Requires `Idempotency-Key`.

**Request**
```ts
{ label: string }   // trimmed, 2-60 chars after trimming
```

That is the entire body. `displayOrder` is server-assigned as "last position in this company's list"; `isActive` is always `true` on create. Neither is accepted from the client (CLAUDE.md rule 1 — the schema has no such key, so sending one fails validation rather than being silently ignored).

`POST /reasons` is identical. `isSystem` and `requiresText` are likewise absent from the schema and always `false` for an admin-created reason — only the bootstrap path (research.md §3) ever sets them.

**Response `201`**: the created row, same shape as one `GET` item.

**Errors**:
- `VALIDATION_FAILED` (400) — missing `label`, empty/whitespace-only after trimming, or outside 2–60 characters.
- `DUPLICATE_BRAND_LABEL` / `DUPLICATE_REASON_LABEL` (409) — a row with this label already exists in this company's corresponding list, compared **case-insensitively and whitespace-trimmed** (FR-007). `POST /reasons` with label `Other` lands here, against the system row, with no special-casing.
- `IDEMPOTENCY_KEY_REUSED` (409).

## `PATCH /brands/:id` — Company Admin

Requires `Idempotency-Key`.

**Request**
```ts
{ label?: string; isActive?: boolean }   // at least one; only the given fields change
```

Both fields are optional and only the ones present change — the same partial-patch convention `PATCH /shops/:id` and `PATCH /beat-plans/:id` already use. An empty body is rejected rather than silently succeeding as a no-op.

`label` follows exactly the same rules as on create: trimmed, 2–60 characters, and rejected when it duplicates another row in the same list case-insensitively. The one difference is that the row **never conflicts with itself** — re-saving its own label, or changing only its capitalisation, succeeds. A rename does not touch `displayOrder`: renaming a row never moves it.

> Rename was originally out of scope and was added on 2026-10-19 at the user's request (see spec.md Assumptions). Board 4.12 draws no rename control, so the screen edits the label in place in the row rather than adding one.

**Response `200`**: the updated row, same shape as one `GET` item.

**Errors**:
- `VALIDATION_FAILED` (400) — empty body, or a `label` that is blank or outside 2–60 characters after trimming.
- `DUPLICATE_BRAND_LABEL` / `DUPLICATE_REASON_LABEL` (409) — the new label is already used by **another** row in the same list.
- `NOT_FOUND` (404) — unknown id, or an id belonging to another company.
- `IDEMPOTENCY_KEY_REUSED` (409).

## `PATCH /reasons/:id` — Company Admin

Identical, plus one guard:

- `SYSTEM_REASON_IMMUTABLE` (409) — the id is the company's system "Other" row. It can be neither renamed nor deactivated (FR-011, FR-014b). This is a server-side rejection, not merely controls the UI hides, and it is checked **before** the duplicate-label check so the message names the real reason.

Renaming a *non-system* reason **to** `Other` is a different case and comes back as `DUPLICATE_REASON_LABEL` (409), since it collides with the system row through the ordinary duplicate path.

## `PATCH /brands/order` — Company Admin

Requires `Idempotency-Key`. This is the "reorder via `PATCH …/order`" route Architecture §7 names.

**Request**
```ts
{ ids: string[] }   // the complete ordered list, first to last
```

The server renumbers every row's `displayOrder` from its position in `ids`, inside one transaction. No `displayOrder` integer is ever accepted from the client — deriving it from array position makes a gap, a duplicate or a collision structurally impossible instead of something to validate, the same reasoning `003-beat-plans-crud` applied to `BeatPlanShop.sequence`.

`ids` must be **exactly** the set of that company's reorderable rows — every one of them, each once, and nothing else. A list that is missing a row, repeats one, or contains an unknown or another company's id is rejected as `VALIDATION_FAILED` rather than partially applied.

> This means a reorder submitted against a stale list — because another admin added a row in the meantime — fails rather than silently dropping the row the client never saw. That is the intended behaviour: a visible failure the admin can retry after a refresh is better than a silent reordering that loses someone else's entry.

**Response `200`**: `{ items: [...] }` — the full list in its new order, same shape as `GET /brands`, so the client can render the authoritative result rather than trusting its own optimistic order.

**Errors**:
- `VALIDATION_FAILED` (400) — `ids` is not exactly the company's reorderable set (missing, extra, duplicated, unknown, or foreign id).
- `IDEMPOTENCY_KEY_REUSED` (409).

## `PATCH /reasons/order` — Company Admin

Identical, with the system row excluded throughout: the "Other" row is **not** part of the reorderable set, so `ids` must contain every non-system reason and must **not** contain the system row's id.

**Errors**: as above, plus
- `SYSTEM_REASON_IMMUTABLE` (409) — `ids` contains the system row's id (FR-013). An empty `ids` for a company whose only reason is "Other" is valid and is a no-op.

## No delete

There is no `DELETE` route on either resource, at any path. Retirement is `PATCH …/:id { isActive: false }` and nothing else (FR-015, PRD FR-ADM-09). This mirrors `/shops`, `/users` and `/beat-plans`, none of which expose a delete either.

## New error codes

Three additions to `packages/shared/src/errors.ts`, following the existing registry shape (`DUPLICATE_BEAT_PLAN_CODE` is the closest precedent):

| Code | HTTP | Meaning |
|---|---|---|
| `DUPLICATE_BRAND_LABEL` | 409 | Brand label already used in this company (case-insensitive). |
| `DUPLICATE_REASON_LABEL` | 409 | Reason label already used in this company (case-insensitive). |
| `SYSTEM_REASON_IMMUTABLE` | 409 | An attempt to deactivate, reorder or otherwise change the system "Other" reason. |
