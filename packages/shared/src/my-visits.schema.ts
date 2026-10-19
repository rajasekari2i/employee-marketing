// Zod request contract for the executive's own visit history
// (contracts/my-visits.md, 008-my-visits). "One contract" (Constitution
// rule 5): both the NestJS API (via `nestjs-zod`'s `createZodDto`, wrapped in
// the controller) and the mobile app's board-1.5 screen use this.
//
// THERE IS NO `executiveId` PARAMETER, AND THAT IS THE POINT.
//
// The caller's own id comes from the verified JWT (`request.user.sub`), never
// from the query. Combined with `.strict()`, a hand-crafted
// `?executiveId=<someone else>` is a 400 naming the unrecognised key rather
// than a field the server has to remember to ignore — which is what turns
// SC-008 ("zero cross-executive leakage") from a guard that must be got right
// into something that cannot be expressed. A route that accepted the
// parameter would have to defend it on every code path forever.
//
// Nothing the server owns appears here either. This is a read, so there is no
// equivalent of the server-owned body fields slices 006 and 007 had to
// exclude — `businessDate`, `distanceMeters`, the flags and the radius are
// all decided and stored server-side and have no place in a query string.

import { z } from 'zod';

export const myVisitsQuerySchema = z
  .object({
    /**
     * The id of the visit to continue after. Absent = the first page.
     *
     * Keyset, not offset (research.md §3): "the rows after *this specific
     * row*" is what makes FR-012 hold when a visit is recorded between two
     * fetches. With OFFSET that insertion shifts every later row down and
     * page 2 re-serves page 1's last row — a duplicate the client cannot
     * detect. An unknown or stale cursor yields an empty page, not an error.
     */
    cursor: z.string().min(1).optional(),
    /**
     * Default 10 — the user's explicit instruction for this screen. The
     * house `min(1).max(100)` bound is kept so a client cannot ask for an
     * unbounded page, matching `listShopsQuery` / `listUsersQuery`.
     */
    limit: z.coerce.number().int().min(1).max(100).default(10),
    /** Board 1.5's three tabs. Absent = "All". Applied in SQL, not in the client. */
    outcome: z.enum(['ORDER', 'NO_ORDER']).optional(),
    /**
     * Board 1.5's date-range control.
     *
     * `ALL` is the default (FR-020) — a **recorded departure** from PRD
     * FR-MY-02's "defaults to the last 7 days", decided with the user so the
     * screen actually pages back through previous visits. The 7-day window
     * survives as a preset, so nothing FR-MY-02 describes is lost.
     *
     * Boundaries are company-local business dates resolved by CompanyClock,
     * never the device clock (Constitution rule 8).
     */
    range: z.enum(['ALL', 'LAST_7_DAYS', 'LAST_30_DAYS']).default('ALL'),
  })
  // See the header — an unknown key must be a 400, not a silent strip.
  .strict();

export type MyVisitsQuery = z.infer<typeof myVisitsQuerySchema>;
