// 012-monthly-salary-run, contracts/salary.md.
//
// **What is absent from these schemas is the point.** `grossTotal`,
// `payableUnits`, `rate`, `amount`, `version`, `finalisedBy` and
// `finalisedAt` are every one of them server-computed, and every one of them
// is missing here. With `.strict()` that makes a client sending any of them
// a `400` rather than a silent strip — the client proposes a *month*, never a
// figure (CLAUDE.md Constitution rule 1, FR-020).
//
// The one input that looks like it should be required and is not: `year` and
// `month` on the query. Omitting them means "the previous month, as the
// SERVER reckons it" — resolved from the company's timezone by
// `CompanyClock`, never by the device. The client opens the screen with no
// parameters at all, which is the only arrangement in which the server stays
// the single authority on what "last month" is (FR-002).

import { z } from 'zod';

/** A calendar year a salary run can address. Bounded so a typo cannot address year 12026. */
const periodYear = z.coerce.number().int().min(2000).max(2100);

/** 1 = January … 12 = December. */
const periodMonth = z.coerce.number().int().min(1).max(12);

/**
 * `GET /salary-runs` — board 4.13.
 *
 * All three fields optional: no period means the previous month, and no
 * `version` means the latest one for that month.
 */
export const salaryRunQuerySchema = z
  .object({
    year: periodYear.optional(),
    month: periodMonth.optional(),
    /** A specific earlier version; omitted means the latest. */
    version: z.coerce.number().int().min(1).optional(),
  })
  .strict();

/**
 * `POST /salary-runs` — generate.
 *
 * A period, and nothing else. The server computes every figure from
 * attendance and rates it reads itself.
 */
export const generateSalaryRunSchema = z
  .object({
    year: periodYear,
    month: periodMonth,
  })
  .strict();

/**
 * `POST /salary-runs/:id/finalise` — the lock.
 *
 * **Empty, and `.strict()`.** Who finalised it is the JWT's and when is the
 * server's clock, so a body carrying `finalisedBy` or `finalisedAt` is a
 * `400`. The same discipline as `markDeliveredSchema` in 010.
 */
export const finaliseSalaryRunSchema = z.object({}).strict();

export type SalaryRunQuery = z.infer<typeof salaryRunQuerySchema>;
export type GenerateSalaryRunInput = z.infer<typeof generateSalaryRunSchema>;
export type FinaliseSalaryRunInput = z.infer<typeof finaliseSalaryRunSchema>;
