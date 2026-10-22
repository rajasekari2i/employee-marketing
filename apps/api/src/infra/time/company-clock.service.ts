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
   * The Monday of the week a business date falls in, as `YYYY-MM-DD`.
   *
   * 009-my-totals. One line on top of {@link weekdayOf}, which already
   * returns 1 = Monday … 7 = Sunday — the convention `BeatPlan.workingDays`
   * stores — so Monday is simply that many days back, minus one.
   *
   * The arithmetic lives HERE and nowhere else. Rule 8 requires one
   * conversion point, and this file's header already records the growth
   * path: a feature needing real time arithmetic adopts it inside this
   * service "without touching a single caller". A report resolving its own
   * week boundaries would be the second place that knows what a week is.
   *
   * The product's week runs **Monday to Sunday** (009 spec, FR-006).
   */
  startOfWeek(businessDate: string): string {
    return this.shiftDays(businessDate, -(this.weekdayOf(businessDate) - 1));
  }

  /** The first day of the month a business date falls in, as `YYYY-MM-DD`. */
  startOfMonth(businessDate: string): string {
    return `${businessDate.slice(0, 7)}-01`;
  }

  /**
   * The last day of the month a business date falls in, as `YYYY-MM-DD`.
   *
   * Day 0 of the following month is the last day of this one — which also
   * gets February and leap years right without a table.
   */
  endOfMonth(businessDate: string): string {
    const [year, month] = businessDate.split('-').map(Number);
    return this.toIsoDate(new Date(Date.UTC(year, month, 0)));
  }

  /**
   * Adds (or subtracts) whole days to a business date.
   *
   * Safe because the value carries no time: it is parsed at UTC midnight,
   * shifted, and formatted back, so it can never drift across a boundary the
   * way a local-midnight instant could.
   */
  shiftDays(businessDate: string, days: number): string {
    const date = this.toDateColumn(businessDate);
    date.setUTCDate(date.getUTCDate() + days);
    return this.toIsoDate(date);
  }

  /**
   * The calendar month before the one a business date falls in, as
   * `{year, month}` with `month` 1-12.
   *
   * 012-monthly-salary-run. A salary run addresses a MONTH rather than a date
   * range, so this returns the two numbers the run is keyed by rather than a
   * pair of dates — the boundaries are then `startOfMonth`/`endOfMonth` of any
   * day inside it.
   *
   * The arithmetic lives HERE and nowhere else (Constitution rule 8). A salary
   * service resolving its own month boundaries would be the second place that
   * knows what a month is, which is what {@link startOfWeek}'s own comment
   * already argues against.
   */
  previousMonth(businessDate: string): { year: number; month: number } {
    const previousMonthDay = this.shiftDays(
      this.startOfMonth(businessDate),
      -1,
    );
    const [year, month] = previousMonthDay.split('-').map(Number);
    return { year, month };
  }

  /** The first day of a `{year, month}` period, as `YYYY-MM-DD`. */
  periodStart(year: number, month: number): string {
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
  }

  /** The last day of a `{year, month}` period, as `YYYY-MM-DD`. */
  periodEnd(year: number, month: number): string {
    return this.endOfMonth(this.periodStart(year, month));
  }

  /**
   * Whether a period has finished, in the company's own reckoning.
   *
   * **A month is complete only once it is entirely in the past** — the
   * current month is not, which is what FR-031 refuses. Comparing the
   * period's last day against today is enough and needs no clock arithmetic
   * beyond what is already here.
   */
  isPeriodComplete(
    year: number,
    month: number,
    todayBusinessDate: string,
  ): boolean {
    return this.periodEnd(year, month) < todayBusinessDate;
  }

  private toIsoDate(value: Date): string {
    return value.toISOString().slice(0, 10);
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
