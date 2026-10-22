# Phase 0 Research: The Company Admin's Visits

**Feature**: `011-admin-visits` | **Date**: 2026-10-22

Written against the merged implementation (commit `6039d11`) and the design boards. Every claim below that could be checked, was — the board comparisons in §2 are byte diffs of the decoded templates, not impressions.

---

## §1 — Every route already exists, and already says "Admin"

`03-ARCHITECTURE.md:829-833` lists the three routes this feature needs, with the roles they were always meant to carry:

| Method | Path | Roles in the architecture's own table |
|---|---|---|
| GET | `/visits` | **Manager, Admin** |
| GET | `/visits/:id` | **Manager, Admin** |
| POST | `/orders/:id/deliver` | **Manager, Admin** |

`010-manager-app` built all three and gated them `@Roles('MANAGER')`, saying so on the record in its own contract: *"The architecture marks several 'Manager, Admin'; the Company Admin's mirror screens (4.2–4.5) are a later feature and the role is added then."*

**So there is no API design work in this slice** — there is a role gate to widen and a reason to be sure widening it is safe. That reason is §3.

One route in the same table is deliberately **not** widened: `POST /visits/:id/review` is Manager-only in the architecture and stays that way (spec FR-028).

## §2 — The four boards, decoded and diffed

The design file is a compressed export; each board's real markup lives gzip+base64-encoded in the manifest, and the per-board content is the `__bundler/template` entry inside it. Decoding both sets and diffing them (uuids normalised, since every asset is re-keyed per board) gives the exact answer to "how different are the admin's boards from the manager's":

| Admin board | Manager twin | Difference in the decoded template |
|---|---|---|
| 4.2 Visits · list + filters | 3.3 Visits · list + filters | **Exactly two.** The subtitle — `Visit history · all executives` → `Company-wide visit history` — and the bottom bar: the manager's 3 items (Reports · Visits · Attendance) replaced by the admin's 4 (Home · Visits · Beats · Shops), each with its own icon path. |
| 4.3 Order visit · mark delivered | 3.4 Order visit · mark delivered | **One character run.** Sample data only: `Marked 29 Sep, 16:20 IST by Lavanya K` → `… by Ramesh N`. |
| 4.4 No-order visit · last 5 reasons | 3.5 No-order visit · last 5 reasons | **None. Byte-identical.** |
| 4.5 Out-of-range visit · distance | 3.6 Out-of-range visit · distance | **None. Byte-identical.** |

Board uuids, for anyone re-running this: 4.2 `20fa5087-251b-4027-95b3-f781a0f2ed84`, 4.3 `a35c2abd-9fe7-4fd4-9bd6-9959200c612b`, 4.4 `3b1928ca-f852-4bf7-9306-ee61a9f2b636`, 4.5 `c80ff493-8dd2-47bd-a0dc-d0d28119256e`; 3.3 `d71d2e67-7b3b-479c-b242-96da6f4965de`, 3.4 `ed0bcc77-19fe-47e8-9c6a-195998663d31`, 3.5 `eb30fec5-03ab-4e68-9c1d-0e0d3ee01126`, 3.6 `3a9dd747-c459-426e-b830-0060de3036f7`.

**A trap worth recording.** Each board's HTML also carries three `text/javascript` assets, and those are *identical across every board in the file* — they are React, ReactDOM and the design tool's runtime. Diffing them proves nothing. The per-board markup is in the `__bundler/template` entry, and it is the only thing worth comparing.

**This table is the whole design rationale of the feature.** Three of the four boards are not new screens; they are the same screens behind a different bottom bar. That is what makes §4's answer the obvious one.

## §3 — Widening the manager's gate does not widen the executive's

The product's standing rule is that the Marketing Executive is never shown `distanceMeters`, `isExceedRange` or a quality flag — structurally, not by hiding it in the UI. Board 4.2 shows all of them, so this feature has to add a role to the routes that carry them and leave that rule intact.

It does, for a reason that predates it: **the executive's history was never the same route.** `010` established `GET /visits` (manager's projection, carries the measurement) and `GET /visits/mine` (executive's projection, measurement absent) as two routes backed by two services, precisely so neither could acquire the other's fields by a refactor of one.

The capability matrix in `02-PRD.md:62-64` already grants the Company Admin what this feature shows:

| Capability | Company Admin | Manager | Marketing Exec |
|---|---|---|---|
| Visits | R | R | C (own) |
| Distance and range flags | **R** | R | **—** |
| Order delivery status | **U** | U | — |

So the role being added is one the product already placed on the correct side of the rule. Adding `COMPANY_ADMIN` to `@Roles` on the manager's three routes changes who may call them and changes nothing about what `/visits/mine` returns. The quickstart re-asserts the executive's exact key set anyway (Scenario 7) — the assertion is cheap and it is the one that would catch a future refactor that merged the two services.

## §4 — Share the screens, do not copy them

Given §2, there were two ways to build this:

1. Copy `ManagerVisitsScreen` and the three detail screens into `features/admin/`, change the subtitle and the bar.
2. Extract the parts that are the same and inject the parts that differ.

**(2), and the reason is the standing fidelity rule rather than tidiness.** CLAUDE.md requires every screen to match its board exactly, and a copy creates a second place for 4.2 to drift from 3.3 — the next fix to the shared list would land on one board and not the other, and nothing would fail. One implementation makes the drift unrepresentable.

What that cost, concretely:

- `features/manager/visitsListShared.tsx` holds the list — tabs, paging, rows, badges, chips, the distance column, the offline notice. `ManagerVisitsScreen` and `AdminVisitsScreen` are thin wrappers that pass the two differing props, `subtitle` and `bottomNav`.
- The three detail screens are **not** copied or moved. They are registered a second time in the admin stack, under the same route names.

**`AdminVisitsScreen` importing from `features/manager/` is deliberate.** A shared `features/visits/` folder would read better and was not done: the components are the Manager's boards, built in `010`, and moving them would have made this slice's diff a rename of `010`'s work rather than an addition to it. The import direction is the honest record of where the screens came from.

## §5 — Registering the same component twice in two stacks

The three detail screens are registered in `AdminStackParamList` under the **same route names and param shapes** as in `ManagerStackParamList`: `OrderVisit`, `NoOrderVisit`, `OutOfRangeVisit`, each `{ visitId: string }`.

That works because of a property worth checking rather than assuming: **each of the three screens' only navigation call is `goBack()`.** None of them navigates to a named route, so none needs to know which stack it was pushed onto. (Checked: `OrderVisitScreen.tsx:117`, `NoOrderVisitScreen.tsx:81`, `OutOfRangeVisitScreen.tsx:88`.)

**The fragility this introduces, stated plainly:** the three components type their navigation and route props against `ManagerStackParamList` even when mounted in the admin stack. It compiles because the route names and param shapes are identical in both. **Renaming one of these routes in one stack without renaming its twin would break the other**, and the type error would appear in a file that looks unrelated to the change. The route names are a shared contract between two stacks, and there is a comment at each registration site saying so.

The alternative — parameterising the screens over their stack type — was considered and rejected as more machinery than the risk justifies for three screens that only go back.

## §6 — The one thing the server had to change

`OrderDeliveryService.markDelivered(companyId, managerId, orderId)` was written when a manager was the only caller. The parameter is renamed to `actorId`.

That is not cosmetic. The value is written to `Order.deliveredBy` and read back as the attribution shown on boards 3.4 and 4.3, so the name was about to become a lie — an admin's delivery attributed through a parameter called `managerId`. The value's *source* is unchanged and is the point: it comes from the verified JWT, never from the request body, which is `z.object({}).strict()`.

**The concurrency case the widening creates is already handled.** Two roles can now reach the same order, so an admin and a manager can race. `010` made a second marking a `409 ORDER_ALREADY_DELIVERED` rather than a silent success, for the attribution reason; that refusal is exactly what makes the race safe, and no new code was needed for it. The service comment was updated to say so, because "why a 409 and not a no-op" now has a second answer.

## §7 — What else is in the commit, and why it is not in this spec

The merged commit also contains work that belongs to no slice:

- `apps/mobile/src/lib/permissions.ts` — the location and camera asks in one module, with `BLOCKED` ("never ask again") distinguished from a plain decline so the app can send the user to Settings instead of offering a retry that cannot work.
- A launch-time request for both, from `App.tsx`. Android has not granted dangerous permissions at install since API 23, so a launch-time ask is the nearest equivalent the platform offers.
- A **bug fix**: `react-native-image-picker` refuses to open the camera when `CAMERA` is declared in the manifest but not granted — it returns an error rather than launching the capture Intent. Neither the shop form nor the profile screen checked the permission or surfaced `errorCode`, so **Take photo did nothing at all**, silently. Both now check first and show the error.
- `location.ts` drops its own private copy of the permission request and calls the shared one, so the location rationale string — the app's only disclosure of what location is used for — has exactly one home.

**It is recorded here and excluded from the requirements.** It touches no board in 4.2–4.5 and would have been equally true had this slice never existed; folding it into the feature's FRs would misrepresent both.

## §8 — What this slice does not build

- **No migration, no schema change, no new enum, no new error code.** `ORDER_ALREADY_DELIVERED` already exists; everything else is a read of tables `010` already covered.
- **No new tenant table**, so no new RLS surface and no `TENANT_MODELS` entry. Constitution rule 2's CI check has nothing new to catch.
- **No new contract file in `packages/shared`.** `managerVisitsQuerySchema`, the detail response and `markDeliveredSchema` are reused unchanged.
- **No filter chips.** Board 4.2 shows a date, an "All executives" and an "All beats" chip; `GET /visits` accepts all three as query parameters; the screen implements none of them, exactly as `010` left board 3.3. Inherited, recorded in the spec as a divergence, and fixed in one place whenever it is fixed.
- **No previous/next order arrows.** Rendered disabled on 3.4 by `010` and inherited by 4.3.

## Summary of new surface

| Kind | Count | What |
|---|---|---|
| Migration | **0** | — |
| New API route | **0** | three existing routes gain `COMPANY_ADMIN` |
| New shared schema | **0** | — |
| New error code | **0** | — |
| New mobile screen component | **1** | `AdminVisitsScreen` (board 4.2) |
| New shared component | **1** | `visitsListShared.tsx`, extracted from `ManagerVisitsScreen` |
| New stack routes | **4** | `AdminVisits` + three detail routes re-registered |
| Changed server signature | **1** | `markDelivered`'s `managerId` → `actorId` |
