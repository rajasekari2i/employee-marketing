# Phase 0 Research: Visit Outcomes

## 1. Where held submissions live on the device

**Decision**: Add `@react-native-async-storage/async-storage` and keep the queue as one ordered JSON list under a single key, with all writes funnelled through one in-process serialiser so two writers can never interleave. Not SQLite.

**Rationale**: What the queue actually needs is: append one item, read all in order, delete one by id, and survive a process restart. That is a list, not a relational workload — a day's worth of held visits is tens of items, not thousands. AsyncStorage is the smallest dependency that does it, is the most widely used storage module in the React Native ecosystem, and needs no schema or migration machinery of its own.

Architecture §1 says "SQLite outbox". That wording is about *durability and ordering*, both of which this satisfies; adopting SQLite would add a native database, a schema, and migrations to maintain for a list of pending items. If the outbox later grows responsibilities — storing cached reads, or holding photos — SQLite becomes the right call, and the queue's interface is small enough to swap behind.

**The write-serialisation point is load-bearing, not a nicety**: AsyncStorage replaces the whole value on write, so a read-modify-write from two callers at once silently drops one item. Every mutation goes through one promise chain.

**Alternatives considered**: `react-native-mmkv` — faster and synchronous, but a heavier native integration than this needs, and its advantage is read throughput, which is not the bottleneck. SQLite (`react-native-nitro-sqlite`) — rejected above. Keeping the queue only in memory — rejected outright: it fails the one requirement that matters, surviving an app restart (FR-036).

## 2. Knowing when to try sending

**Decision**: No connectivity library. Sync is attempted on four triggers: immediately after a submission is enqueued, when the app comes to the foreground, after any other API call succeeds, and when the executive opens Today. A send that fails leaves the item queued; nothing is ever dropped on a failed attempt.

**Rationale**: "Is there a connection?" is not the question that matters — "did the request succeed?" is. A device can report itself connected while behind a captive portal, on a dead Wi-Fi access point, or in a dead spot with a bar showing; `NetInfo.isConnected` is true in all three, so a NetInfo-gated queue would attempt and fail exactly as often while adding a dependency. The reverse case — genuinely connected but NetInfo late to notice — would make the queue sit idle. Driving sync from "an API call just worked" uses the only signal that is actually evidence.

**Alternatives considered**: `@react-native-community/netinfo` with a connectivity listener — rejected for the reasons above; it can be added later as an *extra* trigger without changing the queue. A fixed polling timer — rejected: it wakes the app to fail repeatedly in a dead spot and still needs the same success/failure handling.

## 3. The idempotency key is minted when the visit is recorded

**Decision**: The key is generated at the moment the executive submits on the device — before anything is queued — stored with the held item, and reused on every send attempt for the rest of that item's life. It is never regenerated at send time.

**Rationale**: This is what makes the whole offline path safe, and it is easy to get subtly wrong. If the key were minted when the request is sent, a visit sent once, whose response was lost, and then retried would carry a *different* key and be recorded twice — exactly the duplicate FR-037 and SC-005 forbid. Minting at record time means the server sees the same key however many times the device tries, and replays the stored response instead of creating a second visit. Architecture §1 says the same thing ("ULIDs minted on the mobile device so a timeout-retry carries the same key"); this slice is the first where it has teeth, because it is the first with retries that can span hours.

**Alternatives considered**: Server-side deduplication on (stop, executive, timestamp) — rejected: it guesses at identity rather than being told it, and a legitimate revisit would look like a duplicate.

## 4. What the visit is measured against

**Decision**: `AssignmentStop` gains a frozen snapshot of the shop's approved coordinates, set when the route is created and set when an executive captures a missing pin. The server measures distance from **that** snapshot, and copies it onto the visit along with the radius already frozen on the stop.

**Rationale**: The spec requires an offline visit synced days later to be measured against the shop's location *as it was when the visit was recorded* (edge case), not as it is at sync time. The radius already satisfied this — `effectiveRadiusMeters` has been frozen on the stop since the previous feature — but the coordinates did not: measuring against the shop's live row would use whatever a manager has since approved. Freezing the coordinate on the stop closes that gap with one additive field pair.

Setting it again at pin capture is what makes the "shop had no location" path work: the stop is created before the pin exists, so its snapshot starts empty and is filled the moment the executive saves the pin — still before any outcome can be recorded there.

The device never supplies the shop's coordinates, only its own position. Trusting a client-sent shop coordinate would hand the device control of the measurement, which is precisely what Constitution rule 1 exists to prevent.

**Alternatives considered**: Measuring against the shop's live coordinates at processing time — rejected: a pin correction between recording and syncing would silently re-measure a visit that already happened. Snapshotting onto the visit only at send time — rejected: for a queued visit that *is* sync time, so it solves nothing.

## 5. The mock-location signal has no producer in this slice

**Decision**: The submission contract carries an optional mock-location flag, the server stores and flags it when present, and the current positioning library **does not supply it** — so the flag has no producer today. This is recorded rather than quietly dropped.

**Rationale**: PRD FR-VISIT-10 asks for "the mock-location signal **if the OS provides it**", and the installed `@react-native-community/geolocation` does not expose Android's `isFromMockProvider()` on its position object. Rather than inventing a value, omit the field and leave the server's `MOCK_LOCATION_SUSPECTED` flag declared but unwritten — the same posture used for `AUTO_CLOSED` in the previous feature, where an enum value with no writer was declared honestly instead of faked.

**This is a real gap in the anti-fraud story and should be visible, not buried**: a mocked position is currently indistinguishable from a real one. Closing it means either a small native module calling `isFromMockProvider()`, or swapping the positioning library — both out of scope here, both additive later, and neither changes this contract.

**Alternatives considered**: Swapping to `react-native-geolocation-service`, which exposes `mocked` — rejected for this slice: it is a less-maintained library that predates this React Native version, and it was already rejected in the previous feature's research for that reason. Inferring mocking from implausible accuracy — rejected: it would flag honest readings and miss careful fakes.

## 6. Executives need read access to brands and reasons

**Decision**: Widen `GET /brands` and `GET /reasons` to the Marketing Executive, returning **active entries only** for that role, ordered as the admin set them. The admin's own view is unchanged and still returns inactive entries too.

**Rationale**: The previous feature scoped these endpoints to the Company Admin and recorded that "role-scoped read access for those two roles is deferred to the feature that needs it". This is that feature: the order screen cannot offer brands and the no-order screen cannot offer reasons without them. The role permissions (`brands:read:own`, `reasons:read:own`) were already seeded for the executive and have simply had no endpoint behind them.

Filtering to active entries for the executive is a product rule, not a convenience: an executive must never be able to record against a brand or reason the admin has retired (FR-008, FR-013), and enforcing it in the response as well as on submission means the UI cannot offer an invalid choice in the first place.

**Alternatives considered**: A separate executive-only endpoint — rejected as a duplicate of an endpoint that already returns the right data. Returning everything and filtering on the device — rejected: it leaks retired masters to the client and relies on the UI to enforce a rule the server owns.

## 7. The critical path is one transaction, in a fixed order

**Decision**: Visit submission follows Architecture §10's order exactly, all inside one transaction: idempotency replay check → tenant-scoped load of the stop, assignment and shop → reject if the beat is not running, the stop is not this executive's, it is already completed, or the shop has no approved pin → compute quality flags → measure distance from the frozen coordinate → resolve the frozen radius → set the range flag and review status → create the visit and, for an order, its order and lines → mark the stop completed → write the audit record → commit.

**Rationale**: The ordering is not arbitrary. The rejections come before any computation so an invalid submission costs nothing; the measurement happens before the write so the visit is never stored without its verdict; and the stop is marked completed inside the same transaction as the visit, which is what makes "exactly one outcome per stop" true under concurrency rather than merely likely. Creating the visit, the order and its lines together is what FR-027 and SC-009 require — a visit whose order is missing is a commercial record that cannot be reconstructed.

Notifications, if any, fire **after** the commit, so a push failure can never roll back a saved visit.

**Alternatives considered**: Computing flags before the rejections — rejected: wasted work on requests that cannot succeed. Marking the stop completed in a second transaction — rejected: it opens a window where a visit exists against a stop still shown as pending, which two devices could both pass through.

## 8. How range information stays out of the executive's responses

**Decision**: The executive's endpoints never select the range-bearing fields in the first place. No serialisation interceptor, no field-stripping layer — the query simply does not ask for `distanceMeters`, `isExceedRange`, the flag set, `effectiveRadiusMeters` or the frozen shop coordinates.

**Rationale**: This is the same approach the previous feature took, and it keeps the guarantee where it is hardest to undo by accident: a field that was never loaded cannot be leaked by a later refactor that spreads an object into a response. An interceptor that strips fields is a filter someone can forget to apply to a new endpoint; a select list that omits them fails closed.

Architecture §1 describes "a serialisation interceptor keyed on a permission" as the mechanism. That remains the right shape once several roles read the same records through the same endpoints — a manager review feature will want exactly that. Until then, two role-separated endpoints with their own select lists are simpler and strictly harder to get wrong.

**Alternatives considered**: One endpoint per record with a response filtered by role — rejected for this slice on the "fails closed" argument above.

## 9. The pin-capture map needs a key that is not configured

**Decision**: Board 1.8's map is implemented with the already-installed `react-native-maps`. **The dev build's `GOOGLE_MAPS_API_KEY` is empty**, so map tiles will render blank until a key is supplied — the surrounding controls, the accuracy reading, the verdict and the save gate all work regardless.

**Rationale**: Worth stating plainly rather than discovering during verification. The shop form already uses `react-native-maps` the same way, so this is not a new integration — it is the same unconfigured key, and it affects any screen with a map. A pin can still be captured from the device position without visible tiles; what is lost is the executive's ability to *see* where they are dropping it, which matters for the drag-to-adjust affordance.

**Alternatives considered**: A tile-free capture screen showing only coordinates and accuracy — rejected: it is a different screen from the one the design specifies, and the key is a configuration fix rather than a design problem.

## 10. What is deliberately not built

**Decision**: Out of this slice: granting a revisit (a manager action), marking an order delivered, the manager's review screens, deciding a pin-correction request, and the executive's own "My visits"/"My totals" tabs.

**Rationale**: Each is a different actor's workflow with its own screens. This slice produces the records those features consume — out-of-range visits land in a review state, correction requests are raised, orders are created with a delivery status — so nothing downstream has to be retro-fitted. The enums carry their full sets where this slice's own code reads them, and omit values only when nothing here writes *or* reads them (the posture established in the previous two slices).

**Alternatives considered**: Building the manager's out-of-range queue here so the flagged visits are visible — rejected: it is the manager review feature, with its own three detail screens, and bundling it would roughly double an already large slice.
