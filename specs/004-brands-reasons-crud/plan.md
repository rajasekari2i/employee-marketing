# Implementation Plan: Brands & Reasons CRUD (Company Admin)

**Branch**: `004-brands-reasons-crud` | **Date**: 2026-10-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-brands-reasons-crud/spec.md`

## Summary

Turn the Admin home's inert "Brands & reasons" tile into a real destination: one new screen (board 4.12) with two tabs — no-order reasons and brands — each a single ordered list with an add field, a drag handle and an active switch. This is Architecture's slice `004-masters`, and it introduces the `Brand` and `ReasonMessage` tables, which do not exist yet.

Three things make it more than a fourth copy of the shops/beat-plans CRUD pattern. First, **reorder is its own route** (`PATCH …/order` taking the complete ordered id list), as Architecture §7 already specifies, so the lists are returned whole rather than cursor-paginated — you cannot drag a row to a page you haven't loaded. Second, every company needs exactly one **system "Other" reason**, which means a bootstrap write in `CompaniesService.create()` for new companies, a backfill in this slice's migration for existing ones, and a partial unique index so the invariant can't later be broken. Third, the board's drag handle is the list's only reorder affordance, so this slice implements a **real drag gesture using React Native's built-in `PanResponder`** — no new dependency, no native rebuild — rather than substituting the up/down controls `003-beat-plans-crud` used behind a form's Save button.

Rename is deliberately out of scope (confirmed with the user on 2026-10-19): board 4.12 exposes no rename affordance and PRD FR-ADM-08 enumerates the row's controls without one, so `PATCH …/:id` carries `isActive` and nothing else.

## Technical Context

**Language/Version**: TypeScript 5.6, Node.js ≥22 (API), React Native 0.87.1 (mobile, Android) — unchanged from `003-beat-plans-crud`.

**Primary Dependencies**: NestJS + `nestjs-zod` + Prisma (API); Zod contracts in `@field-sales/shared`; React Navigation 7 (mobile). **No new dependency** — the drag gesture uses `PanResponder` + `Animated` from React Native core (research.md §5), so a Metro reload is enough and no Android rebuild is needed.

**Storage**: PostgreSQL via Prisma. Two new models, `Brand` and `ReasonMessage`, both `companyId`-scoped. No change to any existing column; the only touch to an existing table is a one-time data backfill inserting one "Other" reason row per existing company.

**Testing**: None — CLAUDE.md's standing "no unit or integration tests for now" policy applies. `quickstart.md` is the verification path.

**Target Platform**: The same Android app and Node/NestJS API as every prior slice.

**Project Type**: Mobile app + API, monorepo — no new structure.

**Performance Goals**: Both lists load and render whole (tens of rows per company, spec SC-002's target is 20+ brands and 8+ reasons); a drag commits and reflects the authoritative server order without a visible stall (spec SC-004).

**Constraints**: Pixel-exact match to board 4.12 (spec FR-020) — including its two details that differ from the sibling admin boards: **no bottom navigation bar** (4.6 and 4.8 both have one; 4.12 does not) and **counts carried in the tab labels** rather than in a line above the title. Two-layer tenant isolation on both new tables; every mutating route idempotent; labels unique per company case-insensitively; no hard delete anywhere; Company Admin only; `displayOrder` always server-derived from array position, never client-sent.

**Scale/Scope**: 1 new mobile screen (`BrandsReasonsListScreen`) + 1 tile/route change in `HomeScreen`/`RootNavigator`; 1 new API module (`masters`) with 2 controllers and 2 services, 8 routes total; 2 new Prisma models; 1 bootstrap insert in `CompaniesService.create()`; 3 new error codes; zero new packages.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled Spec Kit template, so CLAUDE.md's "Non-negotiable architectural rules" (mirroring Architecture §21's constitution draft) remain the operative gates — same basis `002-shops-crud` and `003-beat-plans-crud` used.

| Rule | Status | How this feature satisfies it |
|---|---|---|
| 1. Server owns the truth | **PASS** | `displayOrder` is always derived from array position server-side; `isSystem`, `requiresText`, `companyId`, `createdAt`/`updatedAt` are likewise server-only. None of them appear as a key in any Zod request schema, so a client that sends one fails validation rather than having it silently dropped (research.md §1, data-model.md "Validation rules"). |
| 2. Tenant isolation, two layers | **PASS (to implement)** | `Brand` and `ReasonMessage` both carry `companyId`, are added to `TENANT_MODELS` in `tenant.extension.ts` (Layer 1), and get `FORCE ROW LEVEL SECURITY` with the fail-closed `NULLIF(current_setting('app.company_id', true), '')` policy in a sibling `_rls_masters` migration (Layer 2). The bootstrap write needs no RLS escape hatch — `CompaniesService.create()` already switches both layers to the new company before it writes tenant rows (research.md §3). |
| 3. Commands are idempotent | **PASS** | All six mutating routes (`POST`/`PATCH :id`/`PATCH order`, ×2 resources) carry `RequireIdempotencyKeyGuard`; the global `IdempotencyInterceptor` handles replay. This is what spec FR-018 and SC-006 rest on. |
| 4. History is append-only | **N/A for this feature** | Nothing here is a correction-of-an-approved-value. `displayOrder` and `isActive` are current-state fields on master data, and the rule's actual concern — that a later master edit must never rewrite recorded history — is met structurally by `009-visits-and-orders` snapshotting `brandLabel` onto each order line (Architecture §4's "Snapshots everywhere"). Rewriting `displayOrder` wholesale on a reorder is correct here, not a violation. |
| 5. One contract | **PASS** | `packages/shared/src/masters.schema.ts` holds every request/query shape; both controllers wrap them via `createZodDto`, same as `beat-plans.controller.ts`. |
| 6. Role visibility is explicit and structural | **PASS** | `@UseGuards(RolesGuard)` + `@Roles('COMPANY_ADMIN')` at class level on both controllers; the new screen exists only inside `AdminStack`. No range/distance field exists on either entity, so the Executive-visibility interceptor is not implicated. |
| 7. The field app assumes a bad network | **PARTIAL — see Complexity Tracking** | The rule scopes offline queuing to the executive's field actions; `003-beat-plans-crud` recorded it N/A for admin screens on the same basis. This slice narrows spec FR-019's read-side "showing saved data" clause accordingly (research.md §8) and implements its write-side clause in full. |
| 8. Times are UTC in storage | **N/A** | Neither model carries a business-date-bearing field. |
| 9. No secret/token/precise-coordinate in logs | **N/A** | Neither entity holds a coordinate, secret or token. Note the redaction list already covers `reasonText` — that is the executive's free-text note on a visit, a different field in `009`, not a master's `label`; no redaction change is needed here. |
| Testing policy | **PASS** | No test files planned; `quickstart.md` is the manual verification path. |

One partial — recorded in **Complexity Tracking** below rather than waved through.

**Post-Phase-1 re-check**: `data-model.md` and `contracts/masters.md` confirm the above holds once designed in detail. Two points are now concretely specified rather than asserted: the system-reason guards are server-side rejections on every mutating path (not merely hidden UI controls), and the reorder route accepts only a complete, exact id set, so a stale client cannot silently drop another admin's row. No new violations introduced.

## Project Structure

### Documentation (this feature)

```text
specs/004-brands-reasons-crud/
├── plan.md               # This file
├── research.md           # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/
│   └── masters.md        # Phase 1 output
├── checklists/
│   └── requirements.md   # /speckit-specify output
└── tasks.md              # Phase 2 output (/speckit-tasks — not created by this command)
```

### Source Code (repository root)

```text
apps/api/
├── prisma/
│   ├── schema.prisma                              # + Brand, ReasonMessage models
│   └── migrations/
│       ├── <ts>_masters/migration.sql             # tables, the two lower(label) functional
│       │                                          #   unique indexes, the partial
│       │                                          #   one-system-reason-per-company index,
│       │                                          #   AND the "Other" backfill INSERT
│       │                                          #   (must precede the RLS migration —
│       │                                          #   research.md §3)
│       └── <ts+>_rls_masters/migration.sql        # ENABLE/FORCE RLS + policies
└── src/
    ├── infra/prisma/tenant.extension.ts           # + 'Brand', 'ReasonMessage' in TENANT_MODELS
    ├── modules/
    │   ├── masters/
    │   │   ├── masters.module.ts
    │   │   ├── brands.controller.ts               # GET/POST /brands, PATCH /brands/order,
    │   │   │                                      #   PATCH /brands/:id  (order BEFORE :id)
    │   │   ├── brands.service.ts
    │   │   ├── reasons.controller.ts              # same four, + system-row guards
    │   │   └── reasons.service.ts
    │   └── companies/companies.service.ts         # + bootstrap "Other" row after the
    │                                              #   existing set_config/cls.set pivot;
    │                                              #   widen the CompaniesTx Pick
    └── app.module.ts                              # + MastersModule

packages/shared/src/
├── masters.schema.ts                              # create/update/reorder schemas for both
├── errors.ts                                      # + DUPLICATE_BRAND_LABEL,
│                                                  #   DUPLICATE_REASON_LABEL,
│                                                  #   SYSTEM_REASON_IMMUTABLE (409 each)
└── index.ts                                       # + explicit re-export block

apps/mobile/src/
├── features/admin/
│   ├── BrandsReasonsListScreen.tsx                # board 4.12 — tabs, add field, draggable
│   │                                              #   rows, switch, pinned "Other" row
│   └── HomeScreen.tsx                             # tile: comingSoon(...) → navigate();
│                                                  #   + 5th best-effort count fetch
└── navigation/RootNavigator.tsx                   # + BrandsReasonsList route in AdminStack
```

**Structure Decision**: The same monorepo vertical as the three preceding slices — one API module, one Zod contract file, one new admin screen. The two differences from that template are both driven by the architecture rather than by preference: the API module holds **two** controller/service pairs under one `masters` module (Architecture §3 names the folder; §7 keeps `/brands` and `/reasons` as separate route bases — research.md §6), and this slice touches `companies.service.ts`, which no prior CRUD slice did, because the "Other" reason is a per-company bootstrap invariant rather than ordinary master data (research.md §3).

## Complexity Tracking

> One Constitution Check result is **PARTIAL**; recorded here rather than waved through.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Rule 7 ("the field app assumes a bad network") is only partly met: spec **FR-019**'s read-side clause — show previously loaded data with a "showing saved data" indication — is narrowed to the app's existing posture (keep the stale list visible, no banner). The write-side clause (a failed save must never appear to have succeeded) is implemented in full. | There is no offline infrastructure anywhere in the mobile app — no NetInfo dependency, no connectivity state, no cache layer, no outbox, and no existing banner to copy. Constitution rule 7 scopes offline queuing to the **executive's field actions** (visit submission, pin capture, beat start/end), not to Company Admin management screens used at a desk; `003-beat-plans-crud` recorded the same rule N/A on the same basis. | Adding `@react-native-community/netinfo` and a bespoke cache for this one screen would make it the only screen in the app with that behaviour, add a dependency, and prejudge the offline policy that `016-hardening` owns — all for an admin screen, not a field screen. Building rule 7's full outbox here is far outside this slice and is scoped to executive actions anyway. **If the user wants the banner regardless, it is an additive change to this one screen and does not alter the API contract.** |
