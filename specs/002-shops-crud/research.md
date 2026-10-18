# Phase 0 Research: Shops CRUD (Company Admin)

## 1. Beat-plan field and filter

**Decision**: Ship the "Beat plan" select on the shop form and the beat-plan filter chip on the directory exactly as the design shows them, but **disabled**, with a short note ("Available once beat plans are set up"). No `BeatPlan`/`BeatPlanShop` schema work happens in this feature.

**Rationale**: The target Prisma schema (Architecture §4) puts shop-to-plan membership on `BeatPlanShop`, a join row created from the *beat plan* screen (4.7), not a column on `Shop`. `BeatPlan` doesn't exist anywhere in `schema.prisma` yet, and the build order (`CLAUDE.md`) places `007-beat-plans` after `006-shops` deliberately. Building a throwaway `beatPlanId` field on `Shop` now would mean rewriting it the moment `007-beat-plans` lands — exactly the kind of backward-compat shim CLAUDE.md says to avoid.

**Alternatives considered**:
- *Minimal `BeatPlan` stub now* — rejected: pulls schema work out of its intended slice and still needs extending later (executive, working days, ordered shop list) for no benefit in this feature.
- *Free-text "beat plan" label on `Shop`* — rejected: contradicts the normalized relation design and would need real data migration once `BeatPlanShop` exists.

## 2. Interactive map (search + drag-to-pin)

**Decision**: Add `react-native-maps` (Google Maps provider, Android-only for now) and use the Google Maps Geocoding/Places API directly from the mobile app, reusing the single `GOOGLE_MAPS_API_KEY` already wired through `react-native-config` → `apps/mobile/src/config.ts`.

**Rationale**: `apps/mobile/.env.example`, `config.ts`, and `react-native-config.d.ts` already carry a `GOOGLE_MAPS_API_KEY` slot — a prior session decided Google Maps was the provider and wired the config layer, it just never added the map library itself or an Android manifest entry. `react-native-maps` is the standard RN community map view and is what the existing config plumbing was clearly built for. The Android Maps SDK key is a client-embedded, package-name + SHA-1-restricted key by design (not a server secret), so using the same key for the search/geocoding call keeps one key, one place, instead of inventing a second server-side proxy endpoint for no isolation benefit.

**Consequence flagged to the user**: the `dev` flavor's `GOOGLE_MAPS_API_KEY` is currently empty (`config.ts`'s own comment: "Legitimately empty for the dev flavor"), so map tiles will not render locally until a real key is supplied for that flavor. This blocks *visual* verification of the Location section on a dev build, not the implementation itself. Adding `react-native-maps` requires a native rebuild (new Gradle dependency, Google Play Services Maps), consistent with CLAUDE.md's standing instruction to add a native dependency rather than approximate the design, while still flagging the rebuild requirement.

**Alternatives considered**:
- *Static mock map, "skip" only, live map deferred* — this was the other option offered to the user; not chosen. Logged here only because it was a real fork, not because it needs re-litigating.
- *Server-side geocoding proxy endpoint* — rejected for this feature: no secret is actually being protected (the Maps Android key is meant to be client-embedded), so a proxy adds a new endpoint and a round trip for no isolation benefit.

## 3. Coordinate-change audit (`ShopPinChange`)

**Decision**: When an edit changes the coordinates of a shop whose `locationStatus` is already `APPROVED`, the save creates a `ShopPinChange` row (from/to lat-lng, accuracy, source, `requestedBy`) and immediately marks it decided by the same Company Admin (`decidedBy`/`decidedAt` = the same actor and moment), then applies the new coordinates to `Shop`. A shop moving from no pin (`NONE`/`PENDING`) to its first pin is a direct capture — no correction row, since nothing is being overwritten.

**Rationale**: `BUS-17` ("Shop coordinates, once approved, change only through an authorised correction with full history") and the append-only non-negotiable rule apply regardless of which role makes the change. The Company Admin already holds decide-authority over `ShopPinChange` per the architecture's API surface (`POST /shops/:id/pin-changes/:cid/decide` lists Manager and Admin), so self-deciding their own correction is consistent with that authority, not a bypass of it — it just avoids requiring a second admin to approve the first admin's own edit.

**Alternatives considered**:
- *Silently overwrite `Shop.latitude/longitude` on edit* — rejected outright: violates `BUS-17` and the append-only rule directly.
- *Require a separate approval step before an edited pin takes effect* — rejected as unnecessary friction: there is no second-approver role requirement anywhere in the BRD/PRD for an Admin-initiated change; the audit trail is the point, not a blocking approval gate.

## 4. List search, filtering, and pagination

**Decision**: Mirror `GET /users`'s existing shape exactly — cursor-based pagination (`nextCursor`), `search` matching name/code/owner/phone via a case-insensitive partial match, and boolean/enum filters (`pinStatus`, `isActive`) as query params alongside the disabled `beatPlanId` filter placeholder.

**Rationale**: `listUsersQuerySchema` and `UsersService.list()` already establish this project's convention; reusing it keeps `shops.schema.ts` and `shops.service.ts` consistent with the only other list endpoint in the codebase and avoids inventing a second pagination style.

**Alternatives considered**: Offset pagination — rejected, no precedent in this codebase and cursor pagination is already the established choice.

## 5. Deactivate, never delete

**Decision**: No `DELETE /shops/:id` endpoint. `PATCH /shops/:id` with `{ isActive: false }` is the only way to retire a shop, for every shop regardless of whether it is already referenced by history.

**Rationale**: `FR-ADM-09` ("a master row that is already referenced by history can be deactivated but not deleted") combined with the append-only non-negotiable rule. Applying the same rule uniformly — even to a never-referenced shop — avoids a second, inconsistent code path and matches how `users.service.ts` has no delete endpoint either.
