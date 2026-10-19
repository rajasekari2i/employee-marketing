# Phase 0 Research: Brands & Reasons CRUD (Company Admin)

## 1. Reorder: a dedicated `PATCH …/order` route taking the full ordered id list

**Decision**: Reordering is its own route per resource — `PATCH /brands/order` and `PATCH /reasons/order` — each taking `{ ids: string[] }`, the complete ordered list of that company's reorderable rows. The server renumbers every row's `displayOrder` from its position in `ids`, inside one transaction. No `displayOrder` integer is ever accepted from a client. `ids` must be exactly the reorderable set — missing, extra, duplicated, unknown or foreign ids are rejected rather than partially applied.

**Rationale**: Architecture §7's API surface table specifies this shape for these exact two resources — "`GET/POST/PATCH | /brands`, `/reasons` | Company Admin | **reorder via `PATCH …/order`**" — so this is confirming a documented decision, not inventing one. Deriving the stored order from array position (rather than trusting a client-sent integer) is the same reasoning `003-beat-plans-crud` applied to `BeatPlanShop.sequence`: it makes a gap, duplicate or collision structurally impossible instead of something to validate, which is what spec SC-004 demands.

Requiring the *complete* set is what separates this from beat plans. A beat plan's shop list is saved wholesale with the rest of the form, so staleness resolves itself. These lists have no Save button — a drag commits immediately — so a reorder submitted against a list another admin has since added to would silently drop the row this client never saw. Rejecting a mismatched set turns that into a visible, retryable failure.

**Alternatives considered**: Folding order into `PATCH /brands/:id` as a `displayOrder` field — rejected: it accepts a client-computed integer (CLAUDE.md rule 1) and needs N requests to express one drag, each able to fail independently and leave the list half-renumbered. A move-style `PATCH /brands/:id/position { to: number }` — rejected: the server would have to re-derive the whole ordering from a single relative move anyway, and a concurrent change makes "position 3" ambiguous in a way a full list is not. Folding reorder into the list-returning `GET` as a side effect — rejected outright; a read must not mutate.

## 2. No pagination, no search on either list

**Decision**: `GET /brands` and `GET /reasons` return the company's complete list — no `cursor`, no `limit`, no `search`, no filter — ordered by the server. This deliberately departs from the cursor-paginated shape `/shops`, `/users` and `/beat-plans` all use.

**Rationale**: Reordering requires the whole list in hand; a paginated reorder is incoherent (you cannot drag a row to a position on a page you haven't loaded). Board 4.12 corroborates this — it has no search field, no filter chips and no bottom navigation, unlike boards 4.6 and 4.8 which have all three. The data backs it too: spec SC-002's own target is "20+ brands and 8+ reasons," and the design's sample is 22 and 9. These are tens of rows per company, not the 10,000 shops NFR-08 sizes the shop list for.

**Alternatives considered**: Cursor pagination for consistency with the three sibling list endpoints — rejected: consistency with an unrelated access pattern at the cost of making the screen's primary interaction impossible. A high `limit=200` default that is "effectively unpaginated" — rejected as the worst of both: it still silently truncates at some point, and that truncation would corrupt a reorder rather than merely hide rows.

## 3. The system "Other" reason: created at company creation, backfilled by migration

**Decision**: Two write paths, one guard.

1. **New companies** — `CompaniesService.create()` creates the "Other" row (`isSystem: true`, `requiresText: true`, `isActive: true`) in the same transaction as the company, inserted after the existing `set_config('app.company_id', …)` / `cls.set('companyId', …)` pivot and before the method returns. `CompaniesTx`'s `Pick<PrismaClient, …>` is widened to include the new model.
2. **Existing companies** — a hand-written `INSERT … SELECT` backfill in this slice's DDL migration adds the missing row for every company already in the table, written to be a correct no-op on a fresh database.
3. **Guard** — a partial unique index (`ON "reason_messages" ("company_id") WHERE "is_system"`) makes a second system row impossible for any future code path.

**Rationale**: The pivot at `companies.service.ts:123-141` exists precisely because the rest of `create()` writes a tenant-scoped row (`User`) from a `@SkipTenant()` request, and it already switches **both** isolation layers to the brand-new company on the same transaction. Inserting the "Other" row after it needs no new mechanism, no RLS escape hatch, and is atomic with the company, its settings and its first admin — so a company can never exist without its "Other" reason. The repo already has a data-backfill migration to copy from (`20261015175722_roles_application_wide`), including its convention of guaranteeing a clean no-op on an empty database.

**Ordering constraint worth stating explicitly**: the backfill `INSERT` must land in the DDL migration, which is timestamped *before* the sibling `_rls_*` migration that turns on `FORCE ROW LEVEL SECURITY`. The repo's established two-migration-per-slice convention (`20261018170815_beat_plans_crud` then `20261018170833_rls_beat_plans`, 18 seconds apart) gives that ordering for free — but only if the backfill goes in the first file, not the second. Putting it in the RLS migration would make it fail or silently insert nothing unless the migration role holds `BYPASSRLS`.

**Alternatives considered**: Seeding "Other" in `prisma/seed.ts` — rejected: `seed.ts` is a deploy-time superuser script with no tenant context, it runs per-deployment rather than per-company, and it would not fire for a company created later through the API. Lazily creating the row on first `GET /reasons` — rejected: a read that writes, and it leaves the invariant broken for any company nobody has opened the screen for yet. Hard-coding "Other" as a virtual row in the API response rather than storing it — rejected: `009-visits-and-orders` needs a real `reasonId` foreign key to point a no-order visit at, and `requiresText` is modelled as a column precisely so the field app reads data rather than comparing against a magic string.

## 4. Case-insensitive label uniqueness via a functional index

**Decision**: Keep Architecture's `@@unique([companyId, label])` and add a hand-written functional unique index on `(company_id, lower(label))` per table. The service pre-checks case-insensitively so the admin sees `DUPLICATE_BRAND_LABEL` / `DUPLICATE_REASON_LABEL` (409); the index is the race backstop. Labels are stored with the capitalisation the admin typed — only the comparison is folded. Labels are trimmed before both comparison and storage, and bounded at 2–60 characters.

**Rationale**: Spec FR-007 requires duplicates to be caught "ignoring case and surrounding whitespace," and a plain Postgres unique index is case-sensitive — it would accept `Parle` and `parle` as two brands, which is exactly the near-twin the requirement forbids. Prisma's schema language cannot express a functional index, so it goes in a hand-edited migration; `docs/coding_standard.md` already sanctions hand-edited migrations for constraints Prisma can't model, and this repo already ships several. The 2–60 bound is a display-fit choice for the design's 54px row, deliberately distinct from the 3–280 bound PRD FR-VISIT-08 sets on the *executive's free-text note*, which is a different field in a different feature.

**Alternatives considered**: A Postgres `citext` column — rejected: it needs an extension enabled on every environment and changes the column's type semantics everywhere, for a narrower benefit than one index. A normalized `labelLower` shadow column kept in sync by the service — rejected: it duplicates state the database can derive, and drifts the moment any code path writes `label` without it. Service-level checking only, with no database constraint — rejected: it leaves a genuine race between two concurrent adds, and FR-007 is a data-integrity rule, not a UX nicety.

## 5. Drag-to-reorder with React Native's built-in `PanResponder` — no new dependency

**Decision**: Implement a real drag gesture using `PanResponder` and `Animated`, both core React Native, rendering the design's drag-handle glyph exactly. No package is added to `apps/mobile/package.json`; no native rebuild is required.

**Rationale**: Board 4.12's drag handle is the list's *only* reorder affordance — unlike board 4.7, where the ordered shop list sits inside a form with its own Save and where `003-beat-plans-crud` could reasonably substitute up/down controls (its research §6). Substituting here would mean either rendering a handle that doesn't drag, or adding up/down buttons the board doesn't have — the first is a lie, the second breaks the standing exact-fidelity rule.

The usual escape (`react-native-draggable-flatlist`) is genuinely expensive here: `react-native-gesture-handler` is absent entirely, and `react-native-reanimated@4.7.0` exists only as a transitive peer of `nativewind` that pnpm's strict layout does not surface to app code — so it would mean two or three new dependencies, a Babel plugin, an entry-file side-effect import, a `GestureHandlerRootView` wrapper and a full Android rebuild. `PanResponder` needs none of that, and the conditions that normally make hand-rolled drag painful do not apply: the rows are a **fixed 54px height** (board 4.12), so the drop index is `round(gestureY / 54)` rather than a measurement problem, and the list is tens of rows with no virtualization.

This is a deliberate, narrow divergence from `003-beat-plans-crud`'s research §6 — same constraint (no gesture library installed), different conclusion, because there the handle was absent from the implementation anyway and here it is the entire interaction.

**Alternatives considered**: `react-native-draggable-flatlist` + its two native peers — rejected for this slice's cost/benefit above; it remains a clean later upgrade, since the API contract is just an ordered id array either way. Up/down `Pressable` controls copying `BeatPlanFormScreen.moveShop()` — rejected: board 4.12 has no such buttons, so shipping them would be a visible deviation on the one screen the user singled out for exact fidelity. Long-press-then-tap-destination — rejected as a non-standard interaction nobody will discover.

## 6. One `masters` module, two sibling controllers

**Decision**: One NestJS module at `apps/api/src/modules/masters/`, containing `brands.controller.ts` + `brands.service.ts` and `reasons.controller.ts` + `reasons.service.ts`, registered as `MastersModule`.

**Rationale**: Architecture §3's own directory sketch names the folder (`modules/masters/ # brands, reasons`) while §7's API table keeps the two route bases separate (`/brands`, `/reasons`) — one module, two resources, which is exactly what this shape expresses. The two resources are near-identical but not identical (reasons carry `isSystem`/`requiresText` and four extra guards), so they stay as sibling pairs rather than one generic parameterised service: the shared surface is small and the divergence is where all the risk lives.

**Alternatives considered**: Two separate modules (`brands`, `reasons`) — rejected: it contradicts the architecture's own folder naming and splits one screen's backing code across two places. A single generic `MastersService` parameterised by list type — rejected: every guard that matters (`isSystem` immutability, the "Other"-last ordering, the bootstrap invariant) exists on exactly one of the two, so the generic version would be a thin wrapper around a branch on list type.

## 7. Admin-home tile counts reuse the established best-effort pattern

**Decision**: `HomeScreen` gains a fifth best-effort fetch — `GET /brands` and `GET /reasons` — and derives the tile subtitle `` `${brands} brands · ${reasons} reasons` ``, falling back to the existing neutral `'View all'` when either call fails. The tile's `onPress` changes from `comingSoon('Brands & reasons')` to navigating to the new route.

**Rationale**: This is exactly the convention the screen already documents for its other three count tiles ("Best-effort … there is no dedicated count endpoint and this slice's company scale doesn't warrant building one yet"). It is simpler here than for the siblings, because these endpoints return the complete list — the count is `items.length` with no `?limit=100` truncation caveat. `ICON_MASTERS` is already defined on the screen, so only the handler and the subtitle are new.

**Alternatives considered**: A dedicated counts endpoint — rejected for the reason the screen's own comment already gives. Leaving the subtitle static — rejected: spec FR-002 requires live counts, and every sibling tile already shows them.

## 8. No offline banner — the established posture, and a narrowing of spec FR-019

**Decision**: This slice does **not** build offline read-caching or a "showing saved data" banner. It follows the posture every existing admin screen uses: keep the previously loaded list visible on a transient read failure, and surface a clear, specific message when a *write* fails (including the client's existing `NETWORK_ERROR` code). Spec FR-019's first clause is narrowed accordingly; its second clause (a failed save must never appear to have succeeded) is implemented in full.

**Rationale**: There is no offline infrastructure anywhere in the mobile app — no NetInfo dependency, no connectivity state, no SQLite outbox, and no existing banner to follow. Constitution rule 7 scopes the offline requirement to the executive's *field* actions (visit submission, pin capture, beat start/end), not to Company Admin management screens; `003-beat-plans-crud`'s plan recorded the same rule as N/A for the same reason. Building a bespoke caching layer for this one admin screen would be the only one of its kind in the app and would prejudge the design of `016-hardening`'s offline policy.

This is a deliberate, recorded narrowing of a requirement rather than a silent omission — see plan.md's Complexity Tracking.

**Alternatives considered**: Adding `@react-native-community/netinfo` to drive a banner on this screen — rejected: a new dependency and a one-off pattern, for an admin screen used on a desk rather than on a beat. Implementing the full outbox from Constitution rule 7 here — rejected: that is `016-hardening`'s job, scoped to executive field actions, and it is far larger than this slice.
