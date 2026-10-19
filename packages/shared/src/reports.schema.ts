// Zod request contract for the executive's own totals (contracts/executive-totals.md,
// 009-my-totals). "One contract" (Constitution rule 5): both the NestJS API
// (via `nestjs-zod`'s `createZodDto`, wrapped in the controller) and the
// mobile app's board-1.6 screen use this.
//
// THIS SCHEMA IS ONE FIELD. WHAT IS ABSENT IS THE POINT.
//
//   * There is no `executiveId`. The caller's own id comes from the verified
//     JWT, so SC-009 ("zero cross-executive leakage") is not a guard that must
//     be got right on every code path — it is a thing that cannot be
//     expressed.
//
//   * There is no `from` / `to`, even though `03-ARCHITECTURE.md:837` writes
//     this route as `?from=&to=`. Resolving "what is Monday of this week, in
//     my company's timezone?" on the device would be a SECOND conversion
//     point, which Constitution rule 8 puts in exactly one place
//     (`CompanyClock`) — and a wrong device timezone would get it wrong
//     SILENTLY, leaving the executive's figures disagreeing with their
//     manager's for the same person and the same period, with nothing on
//     either screen to explain why. The client sends a period NAME; the
//     server decides what dates that means. `from`/`to` is the manager's
//     arbitrary-range shape and belongs with the rest of slice 014.
//
// `.strict()` makes all three of those a 400 naming the unrecognised key,
// rather than a field the server has to remember to ignore.

import { z } from 'zod';

export const executiveTotalsQuerySchema = z
  .object({
    /**
     * Board 1.6's three tabs. The boundaries each one means are resolved
     * server-side from the company's timezone — see the header.
     *
     * `THIS_WEEK` is the default because that is the board's own default
     * state (FR-007).
     */
    period: z.enum(['TODAY', 'THIS_WEEK', 'THIS_MONTH']).default('THIS_WEEK'),
  })
  // See the header — an unknown key must be a 400, not a silent strip.
  .strict();

export type ExecutiveTotalsQuery = z.infer<typeof executiveTotalsQuerySchema>;
