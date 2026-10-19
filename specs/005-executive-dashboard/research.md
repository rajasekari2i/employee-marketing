# Phase 0 Research: Executive Dashboard — Today's Beat

## 1. Creating today's route on first open, safely

**Decision**: `GET /assignments/today` creates the route when none exists for the caller's company-local business date, inside the request's existing transaction. The `DailyAssignment` table carries `@@unique([companyId, businessDate, executiveId])`, and the service treats a unique-constraint violation as "someone else just created it" — it re-reads and returns that row rather than failing. No scheduled job is added.

**Rationale**: This is the user's decision of 2026-10-19 (spec.md Assumptions). The unique index is what makes it safe: two devices, a double tap, or a refresh storm all converge on one row by construction rather than by locking or by hoping. The read-then-create-then-reread shape is the standard way to make an upsert race-proof when the uniqueness is already enforced by the database.

A `GET` that can write is unusual enough to call out. It is acceptable here, narrowly, because the write is **idempotent by construction** (the unique index), creates nothing the caller could observe as a distinct action, and is exactly the endpoint Architecture §7's API surface already names (`GET /assignments/today`). It takes no `Idempotency-Key`, and it is the only read in this codebase permitted to write.

**Alternatives considered**: A separate `POST /assignments/today/ensure` called by the app before the `GET` — rejected: two round trips on the field app's most-used screen, and the app could still race itself between them, so the unique index would be doing the real work anyway. A scheduled nightly job — the user considered and rejected it (no scheduler runtime exists; a failed overnight run leaves an executive with an empty screen and no recovery). An advisory lock around the create — rejected as redundant: the unique index already serialises the only thing that matters, at lower cost.

## 2. Company-local business date: a `CompanyClock` with no new dependency

**Decision**: Add one `CompanyClock` service as the single place that converts between UTC storage and company-local meaning, implemented with Node's built-in `Intl.DateTimeFormat` rather than Luxon. Its one method for this slice returns the company-local calendar date as `YYYY-MM-DD`, from `new Intl.DateTimeFormat('en-CA', { timeZone, year, month, day })`. `businessDate` is stored as a `@db.Date` column so it is a calendar date, not an instant.

**Rationale**: Constitution rule 8 requires a *single* conversion point, not a specific library. Node 24 ships full ICU, and the `en-CA` locale formats as `YYYY-MM-DD` natively — verified against `Asia/Kolkata`, `UTC`, `America/Los_Angeles` and `Pacific/Auckland`, the last correctly reporting the next calendar day. That is precisely and only what this slice needs. Routing it through `CompanyClock` means a later slice that needs real time arithmetic (resolving `beatNotStartedAt` into a company-local instant for reminders, say) can adopt Luxon inside that one service without touching a single caller.

**Alternatives considered**: Adding Luxon now because Architecture §1 names it — rejected for this slice: a dependency earning its place only in a feature that is not being built, when the constitution's actual requirement (one conversion point) is already met. Deriving the date from the device clock — rejected outright; it is the bug FR-005 exists to prevent, and a wrong phone timezone would silently file a visit under the wrong day. Storing `businessDate` as a timestamp — rejected: a calendar date compared across timezones must not carry a time component.

## 3. Device location: one library, core permissions

**Decision**: Add `@react-native-community/geolocation` for positioning, and use React Native's built-in `PermissionsAndroid` for the runtime permission request. Declare `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION` in the Android manifest. A native rebuild is required; this slice cannot ship as a JavaScript-only update.

**Rationale**: The app has no positioning capability at all today — the only mapping is an admin tapping a point on a `react-native-maps` view, which is a map interaction, never a device reading. `@react-native-community/geolocation` is the maintained community successor to the API removed from React Native core, supports the new architecture, and can be configured to use Play Services for better accuracy. Permissions need no second dependency: `PermissionsAndroid` is in React Native core and this feature requests exactly one permission group on one platform, so `react-native-permissions` would be a dependency earning nothing.

`ACCESS_COARSE_LOCATION` is declared alongside fine location because Android 12+ lets the user grant only approximate location; without it declared, that choice fails outright instead of returning a usable low-accuracy fix — which FR-014 explicitly wants to accept and record rather than block.

**Alternatives considered**: `react-native-geolocation-service` — rejected: its last release predates the new architecture and this React Native version, and its main historical advantage (Play Services accuracy) is now configurable in the community module. `react-native-permissions` — rejected as unnecessary for a single Android permission group. Starting the beat without a location and backfilling later — rejected: it contradicts FR-014 and would let a beat exist with no provable start point, which is the measurement the whole visit-authenticity concern rests on.

## 4. Beat-day lifecycle: two commands, both replay-safe

**Decision**: `POST /assignments/:id/start` and `POST /assignments/:id/end`, each requiring an `Idempotency-Key` and each returning `200` with the current day rather than `201`. Starting an already-running day returns it unchanged; ending an already-ended day returns it unchanged. Starting a day that has already ended is a genuine error (`BEAT_DAY_ENDED`), as is ending one that never started (`BEAT_NOT_STARTED`).

**Rationale**: Architecture §10's state machine says it directly — "`start` on a running day and `end` on an ended day both return the current row with `200`, never an error — so a double tap or a retry is harmless." That is a stronger guarantee than the idempotency key alone, which only replays an identical request; here even a *different* key must not produce a second start. The two genuine errors are the transitions the state machine has no arrow for, and they deserve distinct codes so the app can say something specific rather than "something went wrong".

`status` stays null until the beat starts, so "has today started?" is a single field on the row the screen has already loaded, with no join and no second query — the reason Architecture §9 puts the lifecycle on `DailyAssignment` rather than in a separate table.

**Alternatives considered**: `PATCH /assignments/:id` with a status field — rejected: it invites a client to name the target state, and the client would then be able to attempt `ENDED → RUNNING`; two named commands make the illegal transitions unrepresentable. Returning `409` on a repeated start — rejected: it directly contradicts the architecture and would make a flaky-network double tap look like a failure to the executive.

## 5. What the executive is allowed to receive

**Decision**: The stop payload returned to an executive carries the shop's identity, address, pin status, its sequence, status and source — and deliberately **not** `effectiveRadiusMeters`, nor any distance or flag field.

**Rationale**: Constitution rule 6 makes range information structurally invisible to this role. `effectiveRadiusMeters` is not itself a measurement, but it is the threshold every range verdict is computed against — handing it to the device would let the app derive "am I inside the radius?" locally, which is exactly the inference the rule exists to prevent. It is stored on the stop (frozen at creation, per FR-007) because the server needs it later; it simply never leaves the server. This costs nothing now and avoids a breaking response change when visit submission is built.

**Alternatives considered**: Returning it because no visit logic exists yet — rejected: the field would have to be removed later, and a removal is a breaking change to a shipped contract.

## 6. Ordering, counts and the nearest shop

**Decision**: The server returns stops already ordered — to-do first, then revisit, then completed, with extra-sourced stops first inside each group and planned stops by sequence — and returns the counts alongside. The nearest-shop name shown on the running card is computed server-side by straight-line distance from the recorded start point, over today's stops that have an approved pin.

**Rationale**: FR-011's ordering is a product rule, not a presentation preference; computing it once on the server keeps the three filter tabs, any future screen and any report consistent, and keeps the client from re-deriving a rule it could get subtly wrong. The same argument applies to the counts, which must agree with the list exactly (SC-007). Distance is a server-owned computation by Constitution rule 1 — the device never computes distance for any purpose, even a cosmetic one, so that there is one and only one distance implementation in the product. Shops without an approved pin have no coordinates to measure from and are excluded from that comparison only; they still appear in the list.

**Alternatives considered**: Sorting and counting on the device — rejected on both the consistency and the rule-1 grounds above. Including unpinned shops in the nearest-shop comparison by falling back to some other location — rejected: there is no honest fallback, and a wrong "nearest" is worse than naming the nearest shop that can actually be measured.

## 7. The executive app shell

**Decision**: Add a third navigation stack alongside the existing admin and placeholder stacks, selected for `MARKETING_EXECUTIVE`, plus an `ExecutiveBottomNav` component mirroring the existing admin one. The bar carries all three destinations the design draws — Today, My visits, My totals — with the two unbuilt ones using the app's established "coming soon" affordance rather than being omitted.

**Rationale**: Today every non-admin role falls through to a single placeholder screen; the stack selection is one branch, so adding a third is small and leaves the other roles untouched. Rendering all three tabs keeps the chrome identical to board 1.3, which the standing fidelity rule requires; omitting two tabs would visibly change the bar's spacing and proportions. The admin bottom bar already sets the precedent of a live bar with not-yet-built destinations.

**Alternatives considered**: A single Today screen with no bottom bar until the other tabs exist — rejected: it is a visible deviation from the board on the one screen the user singled out. Reusing `AdminBottomNav` with different items — rejected: it is written around the admin's four-item set and its own route names; a sibling component is clearer than parameterising it into something generic.

## 8. Rendering what does not exist yet

**Decision**: Three parts of board 1.3 depend on features that are not built. Each is rendered exactly as the board draws it, populated with the honest empty value, rather than hidden: the per-row previous-outcome chip shows the design's own "First visit" wording; the Revisit and Extra counts show zero; the closed-day card's Orders and No-order totals show zero, with Visited and Not visited computed from stop status.

**Rationale**: The standing fidelity rule is about the rendered result, so hiding a chip or a stat changes the card's shape and would have to be undone later. Every one of these becomes real without a layout change the moment visit recording and extra shops exist. "First visit" is not invented copy — it is the string the design itself uses for a shop with no history, which is literally true for every shop today.

**Alternatives considered**: Hiding the elements until they have data — rejected: it deviates from the board now and causes a second, larger UI change later. Inventing plausible sample values — rejected outright; showing an executive a visit that did not happen is worse than showing none.

## 9. Deferred, and why each is safe to defer

**Decision**: Auto-closing a forgotten beat, the not-started and not-ended reminders, and the `AUTO_CLOSED` state are all out of this slice. A beat left running stays running.

**Rationale**: All three need a scheduled-job runtime, which does not exist — no scheduler package, no job registry, no advisory-lock helper. Introducing that runtime is a substantial piece of infrastructure whose first real consumer is the reminder set, not this screen. Nothing in this slice is incorrect without it: a running beat is a true statement about a day the executive did not close, and the executive can still end it the next time they open the app. The company settings that configure these times already exist and are left untouched.

The enum consequence is deliberate: `BeatDayStatus` declares `RUNNING` and `ENDED` only. `AUTO_CLOSED` is added additively by the slice that can actually set it — the same posture `002-shops-crud` took when it declared only the `LocationSource` values it could reach. By contrast `StopStatus` and `StopSource` declare their full sets even though only `PENDING` and `PLAN` have writers today, because this slice's own ordering, filtering and counting logic **reads** the other values (FR-011, FR-017) and the design draws chips for them.

**Alternatives considered**: Building the scheduler here so auto-close ships with the lifecycle — rejected: it roughly doubles the slice for a behaviour no user is waiting on, and the reminders that share that runtime are a different feature with their own design. Closing a stale beat opportunistically when the executive next opens the app — rejected: it would record an end time and location that are not where or when the executive actually finished, which is worse than an honestly-still-running day.
