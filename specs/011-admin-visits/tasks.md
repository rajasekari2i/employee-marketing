---

description: "Task list for The Company Admin's Visits"
---

# Tasks: The Company Admin's Visits

**Input**: Design documents from `/specs/011-admin-visits/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/admin-visits.md, quickstart.md (all present)

**Tests**: Not included — CLAUDE.md's standing "no unit or integration tests for now" policy applies. `quickstart.md`'s 10 scenarios are the verification path (Polish, T353). Two of them — Scenario 7 (the executive's side) and Scenario 8 (the manager's side) — are **regression checks on work this slice did not intend to touch**, and are marked *do not skip* there.

**Organization**: Grouped by user story (spec.md: US1 and US2 are P1, US3 is P2). Task IDs continue the repo-wide sequence — 001 (T001–T074) … 010 (T299–T338) — so this feature starts at **T339**.

**⚠️ Written after the implementation.** Unlike every slice before it, this list was reconstructed from the merged commit (`6039d11`) rather than driving it. Every box is `[X]` because every task is done; the value of the list is the *order and the reasoning*, which is what a future slice doing the same kind of role-widening will want.

**⚠️ The smallest slice so far, and deliberately so.** Four boards, **one** new screen, **zero** new endpoints, **zero** migrations. Three of the four boards already existed as the Manager's; see research.md §2 for the byte-level diff that makes that claim rather than asserts it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US3
- File paths are exact and relative to the repo root.

## Path Conventions

- API: `apps/api/src/modules/visits/` — **no `prisma/`, no `packages/shared/`**
- Mobile: `apps/mobile/src/features/admin/`, `apps/mobile/src/features/manager/`, `apps/mobile/src/components/`, `apps/mobile/src/navigation/`

## Board uuids (for the CLAUDE.md decode recipe)

| Board | uuid | Manager twin |
|---|---|---|
| 4.2 Visits · list + filters | `20fa5087-251b-4027-95b3-f781a0f2ed84` | 3.3 `d71d2e67-7b3b-479c-b242-96da6f4965de` |
| 4.3 Order visit · mark delivered | `a35c2abd-9fe7-4fd4-9bd6-9959200c612b` | 3.4 `ed0bcc77-19fe-47e8-9c6a-195998663d31` |
| 4.4 No-order visit · last 5 reasons | `3b1928ca-f852-4bf7-9306-ee61a9f2b636` | 3.5 `eb30fec5-03ab-4e68-9c1d-0e0d3ee01126` |
| 4.5 Out-of-range visit · distance | `c80ff493-8dd2-47bd-a0dc-d0d28119256e` | 3.6 `3a9dd747-c459-426e-b830-0060de3036f7` |

**Decode both columns before writing anything.** The whole shape of this slice follows from what that diff shows, and the diff is not obvious: each board also carries three `text/javascript` assets that are identical across *every* board in the file (React, ReactDOM, the tool's runtime), so diffing those proves nothing. The per-board markup is the `__bundler/template` entry.

---

## Phase 1: Setup

**No tasks.** No error code, no shared schema, no dependency, no native module. `packages/shared/src/` is untouched by this slice, and that is a deliberate outcome rather than a deferral — the contracts the admin needs are the ones the manager already has.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ Nothing in Phase 3 onwards works until these land** — the screens would render and every request would `403`.

- [X] T339 Decode boards 4.2–4.5 and their Manager twins 3.3–3.6 with the CLAUDE.md recipe and **diff each pair** (normalise asset uuids first; compare the `__bundler/template` entries, not the JS assets). Record the result in `research.md §2`. This is a prerequisite rather than research for its own sake: it is what decides whether this slice writes four screens or one, and the answer — two differences on 4.2, one sample-data name on 4.3, byte-identical 4.4 and 4.5 — is what every task below assumes.
- [X] T340 In `apps/api/src/modules/visits/visits.controller.ts`, change `@Roles('MANAGER')` to `@Roles('MANAGER', 'COMPANY_ADMIN')` on **`GET /visits`**. Replace the route's doc comment, which currently says "the MANAGER's list": it is now one route serving boards 3.3 and 4.2. Record **why one route and not two** — `ManagerVisitsService.list` scopes by `companyId` alone and has never had a manager-level predicate, so both roles ask the identical question of identical rows, and a second route would be the same query twice. Also keep, and sharpen, the existing note that this is **still a separate route from `GET /visits/mine`**: that split is what keeps `distanceMeters` and `isExceedRange` out of an executive response structurally, and adding a role here does not weaken it because the executive is the role the rule is about and is not on this list.
- [X] T341 Same file, same change on **`GET /visits/:id`**. Extend the comment to say the one route now serves **six** boards — 3.4–3.6 and their admin twins 4.3–4.5 — and that the client still picks the screen because the server cannot know which (FR-017). **Leave the route declared after `GET /visits/mine`** and leave the ordering comment above it intact: Nest matches in declaration order, so moving this earlier swallows the executive's own history, which then fails the role gate and returns `403`. That happened once, in slice 010, and its quickstart caught it. Update the comment's quoted gate so it reads `@Roles('MANAGER', 'COMPANY_ADMIN')` rather than describing a gate that no longer exists.
- [X] T342 In `apps/api/src/modules/visits/order-delivery.service.ts`, rename `markDelivered`'s second parameter `managerId` → **`actorId`**, at the signature and at both uses (`deliveredBy` on the update, and the `user.findUnique` that resolves the marker's name). **Not cosmetic**: the value is written to `Order.deliveredBy` and read back as the attribution rendered on boards 3.4 and 4.3, so with a second role calling it the old name was about to describe something false. Add a doc comment saying so, and stating that the *source* is unchanged — the verified JWT, never the body. Update the `ORDER_ALREADY_DELIVERED` comment, which says "another manager": it is now "someone else", and the refusal has a **second** job — it is what stops an admin and a manager racing the same order. **No logic changes.**
- [X] T343 Same controller, same role change on **`POST /orders/:id/deliver`**. Record why the admin gets the *action* and not a read-only copy of board 4.3: the board is titled "Order visit · **mark delivered**" and carries the button in both states, and `02-PRD.md`'s capability matrix grants the Company Admin `U` on "Order delivery status" independently of the Manager. Keep `RequireIdempotencyKeyGuard` and `@Audited('order.delivered', 'Order')` unchanged. **The body stays `z.object({}).strict()`** — the widening changes who may call the route, never what it will believe.

**Checkpoint**: a Company Admin's token is now accepted by all three routes, and an executive's still is not. Nothing is visible in the app yet.

---

## Phase 3: User Story 1 - The Visits tab finally goes somewhere (Priority: P1) 🎯 MVP

**Goal**: the admin's Visits tab opens board 4.2.

**Independent test**: sign in as Company Admin, tap Visits, see the list; switch tabs; scroll past ten rows.

- [X] T344 [US1] Extract the body of `apps/mobile/src/features/manager/ManagerVisitsScreen.tsx` into a new `apps/mobile/src/features/manager/visitsListShared.tsx`, exporting `VisitsListView`, `tabFromParams`, `VisitsListParams` and `VisitDetailRoute`. Move **everything** — the four tabs and their counts, the keyset paging with its in-flight ref guard, the row with its badges, delivery chips and out-of-range distance, the empty state, the stale/offline notice. Take exactly two things as props: **`subtitle`** and **`bottomNav`**, which T339's diff proved are the only two differences between boards 3.3 and 4.2. **A copy in `features/admin/` is the thing this task exists to avoid**: CLAUDE.md's fidelity rule makes a second place for the two boards to drift the real risk, and nothing would fail when they did. Header comment must record the diff result, name both boards and their uuids, and state the tab-decides-the-screen rule with board 3.3's own script line as the evidence.
- [X] T345 [US1] Reduce `ManagerVisitsScreen.tsx` to a wrapper over `VisitsListView`, passing the manager's subtitle (`Visit history · all executives`) and `ManagerBottomNav`. **Behaviour must be unchanged** — this is a refactor of a shipped screen and the manager is the one at risk from it. Verify by quickstart Scenario 8, including the preset-tab path from the previous-day report's count tiles, which goes through `tabFromParams`.
- [X] T346 [US1] Add an optional `onVisitsPress?: () => void` to `apps/mobile/src/components/AdminBottomNav.tsx`, defaulting to the existing `comingSoon('Visits')` alert exactly as `onBeatsPress` and `onShopsPress` already do, so a screen not yet passing one keeps working. Update the file's header comment, which still says Home is "the only destination actually built" — as of this slice **all four items have one**.
- [X] T347 [US1] Create `apps/mobile/src/features/admin/AdminVisitsScreen.tsx` — board 4.2 — as a thin wrapper over `VisitsListView`, passing `subtitle="Company-wide visit history"` and an `AdminBottomNav` with `active="Visits"`. **Importing the list from `../manager/` is deliberate**; say so in the header, with the reason (research.md §4). Pass `onVisitsPress={() => undefined}` for the current tab so tapping Visits while on Visits does nothing rather than pushing a second copy.
- [X] T348 [US1] In `apps/mobile/src/navigation/RootNavigator.tsx`, add `AdminVisits: { outcome?: 'ORDER' | 'NO_ORDER'; outOfRange?: boolean }` to `AdminStackParamList` and register the screen with `headerShown: false`. The params preset the tab, exactly as the manager's `ManagerVisits` does, so a future admin report screen can drill through without a second mechanism.
- [X] T349 [US1] [P] Pass `onVisitsPress={() => navigation.navigate('AdminVisits', {})}` from every admin screen carrying the bar: `HomeScreen.tsx`, `ShopsListScreen.tsx`, `BeatPlansListScreen.tsx`, `UsersListScreen.tsx` and the admin branch of `features/profile/ProfileScreen.tsx`. **Miss one and that screen's Visits tab still raises the coming-soon alert** — the default is forgiving, which is exactly why the omission would be silent (SC-002).

**Checkpoint**: US1 is independently usable — the list works end to end, and rows are not yet tappable.

---

## Phase 4: User Story 2 - Open a visit and read what was recorded (Priority: P1)

**Goal**: boards 4.3, 4.4 and 4.5, reached from the list.

**Independent test**: open one visit of each kind from its tab; open an out-of-range order from both the Order and the Out of range tab and confirm the two different screens.

- [X] T350 [US2] Register the Manager's three detail components — `OrderVisitScreen`, `NoOrderVisitScreen`, `OutOfRangeVisitScreen` — a **second time** in `AdminNavigator`, under the **same route names and param shapes** as in `ManagerStackParamList`: `OrderVisit`, `NoOrderVisit`, `OutOfRangeVisit`, each `{ visitId: string }`. **Not copies** — T339's diff shows 4.4 and 4.5 are byte-identical to 3.5 and 3.6 and that 4.3 differs from 3.4 by one name in the sample data, so a copy would be three more places to drift. This works because each of the three screens' **only** navigation call is `goBack()` (checked, not assumed), so none needs to know which stack it was pushed onto. **Record the fragility at both registration sites**: the three components type themselves against `ManagerStackParamList` even here, which compiles only because the names and shapes match in both stacks — renaming one route without its twin breaks the other, and the type error surfaces in a file that looks unrelated.
- [X] T351 [US2] Wire `onOpenVisit` from `AdminVisitsScreen` to `navigation.navigate(target, { visitId })`, with `target` chosen by `VisitsListView`'s existing **tab-aware** rule: from the Out of range tab always the range screen, whatever the outcome; from Order or No order, that outcome's screen (FR-017). No new logic — the rule lives in the shared component and the wrapper only supplies the navigator. Verify both halves of quickstart Scenario 5 on the **same** out-of-range order.

**Checkpoint**: US1 and US2 together are the whole read path. Boards 4.2–4.5 are reachable and correct.

---

## Phase 5: User Story 3 - Mark an order delivered (Priority: P2)

**Goal**: board 4.3's action works for a Company Admin.

- [X] T352 [US3] **No client code.** Board 4.3 is `OrderVisitScreen`, already registered by T350 and already calling `POST /orders/:id/deliver` with a device-minted `Idempotency-Key`; T343 opened the route and T342 made the attribution read back correctly. This task is the **verification** that the three earlier changes compose: mark an order delivered as the admin, confirm it reads back attributed to the admin from a *manager's* session, and run the race (quickstart Scenario 6.5) to confirm the first marker stands and the second gets `409 ORDER_ALREADY_DELIVERED`. Listed as a task rather than folded into Polish because it is the only **write** in the feature and the only one that can corrupt something a manager already did.

---

## Phase 6: Polish & Cross-Cutting

- [X] T353 Run `quickstart.md` end to end. **Scenarios 7 and 8 are the point of this phase**, not Scenario 1–6: this slice widened a role gate on two routes carrying `distanceMeters`/`isExceedRange` (so check the executive's `GET /visits/mine` key set **by eye**, and that `GET /visits` with an executive token is `403`), and it refactored a shipped manager screen (so re-run the manager's list, tabs, paging and the report's count-tile drill-through).
- [X] T354 `tsc --noEmit` clean in `apps/api` and `apps/mobile`. Confirm `git diff` touches **no** file under `prisma/`, `packages/shared/` or `my-visits.service.ts` — if it does, this slice has grown into something its plan does not describe.
- [X] T355 Record the two **inherited divergences** from boards 4.2 and 4.3 — the missing date/executive/beat filter chips and the disabled previous/next order arrows — in `spec.md` under *Known divergences* and in `checklists/requirements.md`, and leave SC-003's checklist box **unticked**. Both came from slice 010 by sharing its implementation and neither was worked around locally; fixing either fixes the manager's board and the admin's at once, which is the dividend of the sharing and the reason a local workaround would have been the wrong repair.

---

## Not tasks of this slice

The merged commit also moved the app's Android runtime permissions into `apps/mobile/src/lib/permissions.ts`, added a launch-time ask for location and camera, and fixed the **Take photo** buttons on the shop form and the profile screen — which did nothing at all when the camera permission had not been granted, because `react-native-image-picker` returns an error instead of opening the camera and neither screen surfaced it.

None of that is a task here. It touches no board in 4.2–4.5 and would have been equally true had this slice never existed; it is recorded in research.md §7 and in the commit message so it is not mistaken for part of this feature.

## Dependencies

```text
T339 (decode + diff)  ──▶ everything; it decides the shape of the slice
T340, T341, T342, T343 (API)  ──▶ Phase 3 onwards (every request 403s without them)
T344 (extract)  ──▶ T345 (manager wrapper), T347 (admin wrapper)
T346 (bar prop) ──▶ T349 (the five callers)
T347 + T348    ──▶ T351
T350           ──▶ T351, T352
T342 + T343 + T350 ──▶ T352
all            ──▶ T353, T354, T355
```

**T349 is the one with a silent failure mode.** `onVisitsPress` is optional by design, so a screen left out keeps compiling and keeps showing the coming-soon alert. Only Scenario 1.6 — reaching the list from *every* admin screen — catches it.
