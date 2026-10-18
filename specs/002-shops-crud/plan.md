# Implementation Plan: Shops CRUD (Company Admin)

**Branch**: `002-shops-crud` | **Date**: 2026-10-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-shops-crud/spec.md`

## Summary

Give the Company Admin a working shop directory: wire the existing "Shops" tile (Admin home) and "Shops" bottom-nav item to a new shop list screen (board 4.8), add a "New shop" action that opens a shop form (board 4.9) in create mode, and make tapping any list row open the same form pre-filled in edit mode. Backed by a new `shops` API module (list/create/update, photo upload, Google-Maps-backed location capture) and new `Shop`/`ShopPhoto` Prisma models, following the exact module/screen patterns already established by the `users` slice (001-company-user-auth). Beat-plan assignment is shown per the design but disabled — `BeatPlan` doesn't exist yet (that's slice `007-beat-plans`). The form's Location section is a fully interactive Google Map (search + drag-to-pin), reusing the `GOOGLE_MAPS_API_KEY` config slot already present in `apps/mobile/src/config.ts`.

## Technical Context

**Language/Version**: TypeScript 5.6, Node.js ≥22 (API), React Native 0.87.1 (mobile, Android only — no `ios/` project exists yet)

**Primary Dependencies**: NestJS + `nestjs-zod` + Prisma (API); Zod contracts in `@field-sales/shared`; React Navigation 7, `react-native-image-picker`, `react-native-svg` (mobile, existing). **New**: `react-native-maps` (Google Maps provider) for the shop form's Location section — no map library is installed yet.

**Storage**: PostgreSQL via Prisma. New `Shop` and `ShopPhoto` models (companyId-scoped); photos reuse the existing `FileObject`/`FilesModule` upload pipeline with a new `PhotoKind.SHOP_PHOTO`. `ShopPinChange` (append-only coordinate-correction audit) is added now because `BUS-17` is non-negotiable the moment edit-time coordinate changes are possible — it is not a separate feature to defer.

**Testing**: None — CLAUDE.md's standing "no unit or integration tests for now" policy applies; verification is the `quickstart.md` manual walkthrough.

**Target Platform**: Android app (`devDebug`/`srtDebug` flavors) + the existing Node/NestJS API.

**Project Type**: Mobile app + API, monorepo (`apps/api`, `apps/mobile`, `packages/shared`) — matches the existing `001-company-user-auth` layout exactly, not a fresh structure.

**Performance Goals**: Shop directory search/filter feels instant for companies with 500+ shops (spec SC-001); list endpoint paginated the same cursor-based way as `GET /users`.

**Constraints**: Pixel-exact match to `docs/ui-design/Field_Sales_Beat_App.html` boards 4.8/4.9 (spec FR-013); two-layer tenant isolation on every new table; every mutating endpoint idempotent; shop code unique per company; no hard delete, only deactivate; Admin-only role gating; `GOOGLE_MAPS_API_KEY` is currently empty for the `dev` flavor, so map tiles won't render locally until a real key is supplied — this blocks *visual verification* of the Location section, not the code.

**Scale/Scope**: 2 new mobile screens (`ShopsListScreen`, `ShopFormScreen`), a 3-prop extension to the shared `AdminBottomNav`, 1 new API module (`shops`: list, create, update, photo add/remove), 2–3 new Prisma models, 1 new native dependency + Android manifest change.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template, so the operative constitution is CLAUDE.md's "Non-negotiable architectural rules" (sourced from Architecture §1/§21). Checked against this feature:

| Rule | Status | How this feature satisfies it |
|---|---|---|
| 1. Server owns the truth | **PASS** | `locationStatus`, `verifiedBy/At`, `geohash` are always server-set; a client-sent value for any of them is rejected by the Zod schema, same pattern as `users.schema.ts`. |
| 2. Tenant isolation, two layers | **PASS (to implement)** | `Shop`, `ShopPhoto`, `ShopPinChange` all carry `companyId`; registered in the Prisma extension and under `FORCE ROW LEVEL SECURITY`, same as every tenant table since `003-company-and-users`. |
| 3. Commands are idempotent | **PASS** | `POST /shops`, `PATCH /shops/:id`, `POST /shops/:id/photos` all require `Idempotency-Key`, reusing `RequireIdempotencyKeyGuard` as-is. |
| 4. History is append-only | **PASS** | An edit that changes an already-`APPROVED` coordinate writes a `ShopPinChange` row (old + new values, actor, reason) rather than overwriting silently — this is why `ShopPinChange` is in scope now, not deferred. |
| 5. One contract | **PASS** | `packages/shared/src/shops.schema.ts`, mirrored into `shops.controller.ts` via `createZodDto`, same as `users.schema.ts`. |
| 6. Role visibility is explicit and structural | **PASS** | `@Roles('COMPANY_ADMIN')` + `RolesGuard` on the whole controller; the two new screens only exist inside `AdminNavigator`. |
| 7. The field app assumes a bad network | **N/A for this feature** | The offline outbox rule is scoped to the Executive's field actions (visit submission, extra-shop add, *executive* pin capture, beat start/end) — not Company Admin management screens. `UsersListScreen`/`UserFormScreen` set the existing precedent of no offline queue on Admin screens; this feature follows it. |
| 8. Times are UTC in storage | **N/A** | `Shop` has no business-date-bearing field. |
| 9. No secret/token/precise-coordinate in logs | **PASS (to implement)** | Shop lat/lng added to the existing redaction list the same way visit coordinates already are. |
| Testing policy | **PASS** | No test files planned, per the standing policy; `quickstart.md` is the manual verification path. |

No violations — **Complexity Tracking is not needed.**

**Post-Phase-1 re-check**: `data-model.md` and `contracts/shops.md` confirm the above holds once designed in detail — in particular, `ShopPinChange` (added specifically to satisfy rule 4) and the client-input schema's total omission of every server-only location field (rule 1) are both now concretely specified, not just asserted. No new violations introduced.

## Project Structure

### Documentation (this feature)

```text
specs/002-shops-crud/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/
│   └── shops.md          # Phase 1 output
└── tasks.md              # Phase 2 output (/speckit-tasks — not created by this command)
```

### Source Code (repository root)

```text
apps/api/
├── prisma/
│   ├── schema.prisma                         # + Shop, ShopPhoto, ShopPinChange models;
│   │                                          #   + PhotoKind.SHOP_PHOTO, LocationSource,
│   │                                          #   LocationStatus, PinChangeStatus enums
│   └── prisma/migrations/<new>_shops/         # migration.sql for the above
└── src/modules/shops/
    ├── shops.module.ts                        # imports FilesModule, same as users.module.ts
    ├── shops.controller.ts                    # GET/POST /shops, PATCH /shops/:id,
    │                                          #   POST/DELETE /shops/:id/photos
    └── shops.service.ts                       # tenant-scoped CRUD + pin-change audit logic

packages/shared/src/
├── shops.schema.ts                            # createShopSchema, updateShopSchema,
│                                              #   listShopsQuerySchema, shop photo/pin schemas
└── enums.ts                                   # + LocationSource, LocationStatus (HTTP-boundary mirrors)

apps/mobile/
├── package.json                               # + react-native-maps
├── android/app/src/main/AndroidManifest.xml   # + <meta-data com.google.android.geo.API_KEY
│                                              #     android:value="@string/GOOGLE_MAPS_API_KEY">
├── src/components/AdminBottomNav.tsx          # + onShopsPress prop (replaces hardcoded
│                                              #   comingSoon('Shops') call)
├── src/features/admin/
│   ├── ShopsListScreen.tsx                    # board 4.8 — mirrors UsersListScreen.tsx
│   └── ShopFormScreen.tsx                     # board 4.9 — mirrors UserFormScreen.tsx,
│                                              #   + MapView location picker
└── src/navigation/RootNavigator.tsx           # + ShopsList, ShopForm routes on AdminStackParamList
```

**Structure Decision**: Reuse the exact monorepo layout and per-slice vertical already established by `001-company-user-auth` — one API module under `apps/api/src/modules/shops`, one Zod contract file in `packages/shared`, two screens under `apps/mobile/src/features/admin` sharing `adminDesign.ts`/`AdminBottomNav`/`OutlineIcon`. No new top-level structure is introduced; the only net-new piece is the `react-native-maps` native dependency and its one Android manifest entry.

## Complexity Tracking

*No Constitution Check violations — this section is intentionally empty.*
