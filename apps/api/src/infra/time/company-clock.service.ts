import { Injectable } from '@nestjs/common';

/**
 * The single place this codebase converts between UTC storage and
 * company-local meaning (CLAUDE.md Constitution rule 8: "Times are UTC in
 * storage, company-local in meaning. Only CompanyClock converts").
 *
 * It lives in `infra/` rather than inside the assignments module on purpose:
 * attendance, salary runs and the reminder jobs all need the same conversion
 * later, and rule 8 requires there to be exactly one implementation of it —
 * not one per feature.
 *
 * **Implemented with Node's built-in `Intl`, not Luxon** (research.md §2).
 * Architecture §1 names Luxon, but the rule's actual requirement is a single
 * conversion point, not a specific library, and the one operation
 * 005-executive-dashboard needs — "what is today's calendar date in this
 * company's timezone?" — is exactly what `Intl.DateTimeFormat` with the
 * `en-CA` locale produces natively, as `YYYY-MM-DD`. Node ships full ICU, and
 * this was verified against `Asia/Kolkata`, `UTC`, `America/Los_Angeles` and
 * `Pacific/Auckland`, the last correctly reporting the next calendar day.
 *
 * A later feature that needs real time arithmetic (resolving a company's
 * `beatNotStartedAt` of "10:30" into an instant, say) adopts Luxon **inside
 * this service**, without touching a single caller — which is the whole point
 * of funnelling the conversion through one class.
 */
@Injectable()
export class CompanyClock {
  /**
   * The company's current local calendar date as `YYYY-MM-DD`.
   *
   * This is the product's `businessDate`. It is deliberately derived from the
   * company's own timezone and the server's clock — never from a date the
   * client sends or from the device's clock — so an executive whose phone has
   * the wrong timezone still gets the correct day (FR-005).
   *
   * `en-CA` is used purely because it formats as `YYYY-MM-DD`; no part of the
   * product is Canadian. The explicit `year`/`month`/`day` options keep that
   * independent of any future change to the locale's default format.
   */
  businessDate(timezone: string, now: Date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  }

  /**
   * The weekday of a company-local business date, as 1 = Monday … 7 = Sunday —
   * the convention `BeatPlan.workingDays` already stores (Architecture's own).
   *
   * Takes the `YYYY-MM-DD` string rather than a `Date` so it cannot be handed
   * an instant whose timezone has not been resolved yet. The string is parsed
   * as UTC midnight, which is safe precisely because it carries no time: the
   * calendar date was already settled by {@link businessDate}.
   */
  weekdayOf(businessDate: string): number {
    const day = new Date(`${businessDate}T00:00:00.000Z`).getUTCDay();
    // getUTCDay() is 0 = Sunday … 6 = Saturday; the product uses 1 = Monday … 7 = Sunday.
    return day === 0 ? 7 : day;
  }

  /**
   * The same business date as a `Date` at UTC midnight, for writing to a
   * Postgres `DATE` column. The column stores a calendar date with no time, so
   * this must not carry a local-midnight offset that could land on the
   * neighbouring day.
   */
  toDateColumn(businessDate: string): Date {
    return new Date(`${businessDate}T00:00:00.000Z`);
  }
}
