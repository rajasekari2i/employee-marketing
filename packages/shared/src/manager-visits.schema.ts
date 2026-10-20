// Zod request contract for the manager's visits list (contracts/manager-app.md,
// 010-manager-app). "One contract" (Constitution rule 5).
//
// `outOfRange` IS A SEPARATE FIELD FROM `outcome`, NOT A THIRD VALUE OF IT.
//
// Board 3.3 draws four tabs — All / Order / No order / Out of range — which
// reads like one enum with four values. It is not. Decoding the board's own
// script shows the filter as:
//
//     cur === 'out' ? v.out : v.kind === cur
//
// `out` is a BOOLEAN beside `kind`, because exceeding the radius is a
// property of the measurement, not a third kind of outcome. A visit is an
// order or a no-order; out-of-range is a flag on top.
//
// That is why the Out-of-range tab contains BOTH orders and no-orders, and
// why the detail screen has to be chosen by the tab the manager came from
// rather than by what the visit is (FR-029) — the same out-of-range order
// shows the read-only range screen from one tab and the delivery screen from
// another.

import { z } from 'zod';

export const managerVisitsQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    /** The user asked for 10; the house bound stays 1–100. */
    limit: z.coerce.number().int().min(1).max(100).default(10),
    /** A company-local business date. Absent = every day. */
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
      .optional(),
    /** Board 3.3's Order / No order tabs. */
    outcome: z.enum(['ORDER', 'NO_ORDER']).optional(),
    /** Board 3.3's Out of range tab — orthogonal to `outcome`. See the header. */
    outOfRange: z.coerce.boolean().optional(),
    executiveId: z.string().min(1).optional(),
    beatPlanId: z.string().min(1).optional(),
  })
  .strict();

export type ManagerVisitsQuery = z.infer<typeof managerVisitsQuerySchema>;

/**
 * `POST /orders/:id/deliver` body — deliberately empty.
 *
 * Who marked it is the JWT's and when is the server's clock, so a body
 * carrying `deliveredBy` or `deliveredAt` is a 400 rather than a silent
 * strip (Constitution rule 1).
 */
export const markDeliveredSchema = z.object({}).strict();

export type MarkDeliveredInput = z.infer<typeof markDeliveredSchema>;

/**
 * `POST /assignments/:id/stops/manager` body — board 3.2 (FR-043).
 *
 * **No `newShop` branch**, unlike the executive's route. An executive
 * creates a shop from the field because they are standing in front of one;
 * a manager at a desk picks from the directory, and board 3.2 offers search
 * and no create.
 *
 * `reason` is REQUIRED and is written to the audit log.
 */
export const managerAddStopSchema = z
  .object({
    shopId: z.string().min(1),
    reason: z.string().trim().min(3).max(280),
  })
  .strict();

export type ManagerAddStopInput = z.infer<typeof managerAddStopSchema>;

/**
 * `GET /assignments?date=&executiveId=` — `03-ARCHITECTURE.md:821`.
 *
 * Added for board 3.2, which cannot work without it: the manager chooses a
 * PERSON, while `POST /assignments/:id/stops/manager` is addressed by that
 * person's DAY. This resolves one to the other, and supplies the board's
 * "5 of 12 done" progress line at the same time.
 */
export const managerAssignmentsQuerySchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
      .optional(),
    executiveId: z.string().min(1).optional(),
  })
  .strict();

export type ManagerAssignmentsQuery = z.infer<
  typeof managerAssignmentsQuerySchema
>;
