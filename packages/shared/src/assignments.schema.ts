// Zod request-body contracts for the beat-day commands
// (contracts/assignments.md, 005-executive-dashboard). "One contract"
// (Constitution rule 5): both the NestJS API (via `nestjs-zod`'s
// `createZodDto`, wrapped in the controller rather than here, same split as
// every prior slice) and the mobile app's `TodaysBeatScreen` use these.
//
// `GET /assignments/today` has no schema here because it takes no input at
// all — not even a date. The day is always the caller's company-local
// business date, resolved server-side by `CompanyClock`; accepting a date
// from the client is exactly the bug FR-005 exists to prevent.
//
// Everything below is deliberately ABSENT from the request shapes, so a
// client that sends one fails validation rather than having it silently
// dropped (CLAUDE.md Constitution rule 1 — the server owns the truth):
//   * `businessDate` — derived from the company's timezone, never supplied.
//   * `status`, `startedAt`, `endedAt` — the lifecycle is the server's.
//   * every `AssignmentStop` field, including `sequence`, `source`, `status`
//     and `effectiveRadiusMeters` — the route is a server-built snapshot.

import { z } from 'zod';

/**
 * The position reading both commands carry.
 *
 * A location is **required** to start or end a beat (FR-014): the whole
 * visit-authenticity concern rests on being able to say where the day began
 * and ended, so there is no "start without a fix" path.
 *
 * `accuracyMeters` is recorded and **never blocks** — the product's rule is
 * that poor readings are flagged for a manager's review, not refused at the
 * door. It is validated only for shape (a non-negative integer), not quality.
 *
 * `capturedAt` is the **device's claim** about when it read the position, kept
 * for later quality checks. It is never the authoritative time: `startedAt`
 * and `endedAt` always come from the server's own clock, so a wrong device
 * clock cannot move a beat in time.
 */
const positionFields = {
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().int().min(0),
  capturedAt: z.string().datetime(),
};

/** `POST /assignments/:id/start` request body (contracts/assignments.md). */
export const startBeatSchema = z.object(positionFields);

export type StartBeatInput = z.infer<typeof startBeatSchema>;

/**
 * `POST /assignments/:id/end` request body — identical to start by design.
 *
 * There is no `note` field: board 1.3's end confirmation offers only "Keep
 * going" and "End beat", so nothing in the product can produce one.
 */
export const endBeatSchema = z.object(positionFields);

export type EndBeatInput = z.infer<typeof endBeatSchema>;
