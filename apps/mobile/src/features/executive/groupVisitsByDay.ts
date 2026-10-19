/**
 * Turns the server's flat, day-major page into the sequence board 1.5 draws
 * (008-my-visits, FR-003, FR-004, FR-011).
 *
 * A **pure function**, with no hooks and no components, because the one rule
 * that is easy to get wrong lives here and deserves to be readable on its
 * own: *merging a newly-arrived page must not emit a second header for a day
 * that is already open.* A business day with enough visits straddles the
 * ten-row page boundary, and board 1.5 shows one block per day however the
 * boundary falls.
 *
 * It is safe to group **consecutive** rows — and therefore wrong to sort
 * here — because the server orders by `businessDate` first. That day-major
 * ordering is the whole reason `Visit.businessDate` exists (research.md §2).
 */

export interface VisitRow {
  id: string;
  businessDate: string;
  shopName: string;
  outcome: 'ORDER' | 'NO_ORDER';
  summary: string;
  occurredAt: string;
}

export interface DaySummary {
  businessDate: string;
  orderCount: number;
  noOrderCount: number;
}

export type ListEntry =
  | {
      kind: 'day';
      key: string;
      businessDate: string;
      label: string;
      summary: string;
    }
  | { kind: 'visit'; key: string; visit: VisitRow };

/** `Tue 29 Sep` — the board's own day format. */
function formatDay(businessDate: string): string {
  // `YYYY-MM-DD` is parsed at UTC midnight; format in UTC so the label can
  // never shift a day against the business date it came from.
  const date = new Date(`${businessDate}T00:00:00.000Z`);
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/**
 * `"Today · Tue 29 Sep"` for the company's current business date, otherwise
 * `"Tue 29 Sep"` — board 1.5 shows both forms.
 */
export function dayLabel(
  businessDate: string,
  todayBusinessDate: string | null,
): string {
  const formatted = formatDay(businessDate);
  return businessDate === todayBusinessDate
    ? `Today · ${formatted}`
    : formatted;
}

/** `"3 orders · 2 no order"` — taken from `days`, never counted from the rows. */
export function daySummaryText(day: DaySummary): string {
  const orders = `${day.orderCount} order${day.orderCount === 1 ? '' : 's'}`;
  return `${orders} · ${day.noOrderCount} no order`;
}

/**
 * Builds the render sequence.
 *
 * `visits` is the full accumulated list across every page fetched so far,
 * already in server order; `days` is every day summary seen so far. Because
 * a day header is emitted only when `businessDate` **changes**, a day that
 * spans two pages produces exactly one header once the second page has been
 * appended — which is FR-011.
 *
 * The day's summary comes from `days`, **not** from counting `visits`: under
 * an active tab the rows are a subset, while board 1.5's heading still
 * reports the day's real totals (research.md §5).
 *
 * A day with no rows produces no header at all — board 1.5 ends its own
 * grouping with `.filter((g) => g.items.length)`, and a heading with nothing
 * under it reads as a fault.
 */
export function buildListEntries(
  visits: VisitRow[],
  days: DaySummary[],
  todayBusinessDate: string | null,
): ListEntry[] {
  const summaries = new Map(days.map((day) => [day.businessDate, day]));
  const entries: ListEntry[] = [];
  let openDay: string | null = null;

  for (const visit of visits) {
    if (visit.businessDate !== openDay) {
      openDay = visit.businessDate;
      const summary = summaries.get(openDay);
      entries.push({
        kind: 'day',
        key: `day:${openDay}`,
        businessDate: openDay,
        label: dayLabel(openDay, todayBusinessDate),
        summary: summary ? daySummaryText(summary) : '',
      });
    }
    entries.push({ kind: 'visit', key: `visit:${visit.id}`, visit });
  }

  return entries;
}
