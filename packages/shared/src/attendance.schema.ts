// Zod request contracts for attendance (contracts/manager-app.md,
// 010-manager-app). "One contract" (Constitution rule 5).
//
// EVERYTHING BELOW IS ABSENT ON PURPOSE, so a client that sends one fails
// validation with a 400 rather than having it silently dropped
// (Constitution rule 1 — the server owns the truth):
//
//   * `latenessFlag` — THE ONE TO EXPLAIN. It looks like an observation the
//     device could make: it knows the arrival time, so why not the verdict?
//     Because lateness is not an observation, it is the COMPANY'S SETTINGS
//     APPLIED TO ONE — `morningSessionStart`/`eveningSessionStart` with
//     `delay1hMinutes`/`delay2hMinutes` as thresholds. It is exactly the
//     same shape of value as `distanceMeters`, which is the company's radius
//     applied to a device-supplied position, and which this product has
//     never accepted from a client either (FR-035, SC-010).
//   * `payableUnits` — derived from `CompanySettings.payableUnitByStatus`.
//     Lateness never reduces it (OD-01, FR-038).
//   * `version`, `isActive`, `supersededById` — the append-only machinery.
//     A client cannot choose which version it is writing.
//   * `recordedBy`, `recordedAt` — the JWT's and the server's clock.
//
// `changeReason` IS REQUIRED ONLY ON AN AMENDMENT, and the client never
// declares which case it is in. The server knows from whether an active row
// already exists for that person, date and session — requiring a reason to
// record a plain Present would be noise, and asking the client to say
// "this is an amendment" would let it lie.

import { z } from 'zod';

export const attendanceDayQuerySchema = z
  .object({
    /** A company-local business date. Absent = today. */
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
      .optional(),
  })
  .strict();

export type AttendanceDayQuery = z.infer<typeof attendanceDayQuerySchema>;

export const recordAttendanceSchema = z
  .object({
    userId: z.string().min(1),
    businessDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
    session: z.enum(['MORNING', 'EVENING']),
    status: z.enum(['PRESENT', 'ABSENT', 'LEAVE', 'HOLIDAY', 'WEEKLY_OFF']),
    /** Required when PRESENT, and not allowed otherwise — see the refinement. */
    actualTime: z.string().datetime().optional(),
    /** Required when amending. The SERVER decides whether this is one. */
    changeReason: z.string().trim().min(3).max(280).optional(),
  })
  // See the header — unknown keys must be rejected, not stripped.
  .strict()
  .refine((v) => (v.status === 'PRESENT') === (v.actualTime !== undefined), {
    message: 'actualTime is required for PRESENT and not allowed otherwise',
  });

export type RecordAttendanceInput = z.infer<typeof recordAttendanceSchema>;
