/**
 * Design tokens for the Marketing Executive's screens, taken verbatim from
 * `docs/ui-design/Field_Sales_Beat_App.html` board 1.3 ("Today's beat", uuid
 * `20463df0-5cdd-44a1-bce2-f24ff89bf4c6`) — decoded with the recipe in
 * CLAUDE.md, not approximated from the NativeWind/Tailwind scale.
 *
 * Tokens the executive boards share with the admin boards are re-exported
 * from `adminDesign` rather than redefined, so a value never drifts between
 * the two roles. Everything defined here is a colour board 1.3 uses and no
 * admin board does.
 */

export {
  BG,
  BLUE,
  INK,
  MUTED,
  LABEL,
  BORDER,
  DANGER,
} from '../admin/adminDesign';

/** On the blue cards: the lighter blue for secondary copy and the chip fill. */
export const ON_BLUE_MUTED = '#D3DFFB';
export const BLUE_CHIP = '#4169E1';

/** The amber accent — the progress fill and the "planned + extra" line. */
export const AMBER_ACCENT = '#F2C572';

/** The "beat running" strip. */
export const RUNNING_BG = '#E3EBFC';
export const RUNNING_BORDER = '#C7D6FA';
export const RUNNING_INK = '#1E3A8A';

/** The inline end-beat confirmation strip. */
export const CONFIRM_BG = '#FCEFD9';
export const CONFIRM_BORDER = '#F0D2A0';
export const CONFIRM_INK = '#6B3904';

/** The ended (closed-day) card. */
export const ENDED_BG = '#141A26';
export const ENDED_CHIP = '#3A4353';
export const ENDED_MUTED = '#C4CBD8';

/** The locked strip shown before starting and after ending. */
export const LOCKED_BG = '#E9EDF3';
export const LOCKED_INK = '#3A4353';

/** The filter tab group — the same pill treatment board 4.12 uses. */
export const TAB_TRACK = '#E6EAF1';

/** Stop-row status chips. */
export const CHIP_PENDING_BG = '#E9EDF3';
export const CHIP_PENDING_FG = '#3A4353';
export const CHIP_VIOLET_BG = '#EFE9FB';
export const CHIP_VIOLET_FG = '#5B2FA6';

/** Stop-row pin chips. */
export const CHIP_PIN_OK_BG = '#E3EBFC';
export const CHIP_PIN_OK_FG = '#1E3A8A';
export const CHIP_PIN_MISSING_BG = '#FCEFD9';
export const CHIP_PIN_MISSING_FG = '#7A4105';

/** The neutral chip and the sequence badge. */
export const CHIP_NEUTRAL_BG = '#F3F5F9';

/** Row separator inside the stop list. */
export const ROW_SEPARATOR = '#ECEFF4';

/**
 * `3h 38m` / `9h 08m`, the board's own elapsed and duration format.
 * Minutes are zero-padded; hours are not.
 */
export function formatDuration(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

/** `09:04` in the device's local time — the board shows a wall-clock time, not a date. */
export function formatClock(value: Date): string {
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}

/** `Tue, 29 Sep` — the board's header date. */
export function formatHeaderDate(value: Date): string {
  return value.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** The board greets by first name only ("Good morning, Priya"). */
export function greetingFor(value: Date, fullName: string | undefined): string {
  const hour = value.getHours();
  const part =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const first = (fullName ?? '').trim().split(/\s+/)[0] ?? '';
  return first ? `${part}, ${first}` : part;
}

/**
 * Board 1.4 ("Add extra shop", uuid `eccc1168-1e66-4039-92fc-0d14dd936744`),
 * decoded with the CLAUDE.md recipe.
 *
 * Only the hexes board 1.3 does not already define are added here. The board
 * reuses several of the values above at identical hex, so those are reused by
 * name rather than redeclared: `CHIP_VIOLET_BG` is the banner fill,
 * `RUNNING_BG` is the selected row's fill, `BORDER` is the picker card's
 * hairline, `BLUE` is the selected border and the dashed actions, and the pin
 * and beat chips are `CHIP_PIN_OK_*` / `CHIP_PIN_MISSING_*` /
 * `CHIP_PENDING_*` unchanged.
 */

/** The violet banner's ink — darker than the chip's `CHIP_VIOLET_FG`. */
export const BANNER_INK = '#4C2690';

/**
 * The search field's hairline, and the disabled primary button's fill. One
 * hex, two roles, exactly as the board uses it.
 */
export const FIELD_BORDER = '#CBD2DD';

/** The unselected radio's ring. */
export const RADIO_RING = '#AEB7C5';

/** `.btn` on the boards: 54 px tall, 14 radius, 700/16. */
export const PRIMARY_BUTTON_HEIGHT = 54;

/** The dashed secondary action shared by boards 1.3 and 1.4: 48 px tall, 14 radius. */
export const DASHED_BUTTON_HEIGHT = 48;

/**
 * Board 1.5 ("My visits", uuid `94506a6c-c909-40f9-b3d2-e0cca7bad3f5`),
 * decoded with the CLAUDE.md recipe.
 *
 * Almost every colour board 1.5 uses is already defined above at the same
 * hex, so they are reused by name rather than redeclared: `TAB_TRACK`
 * (`#E6EAF1`) is the tab track, `BORDER` (`#DFE4EC`) the day card and the
 * bar's top edge, `ROW_SEPARATOR` (`#ECEFF4`) the row divider,
 * `CHIP_PIN_OK_BG`/`CHIP_PIN_OK_FG` the `ORD` badge,
 * `CHIP_PENDING_BG`/`CHIP_PENDING_FG` the `NO` badge, `FIELD_BORDER`
 * (`#CBD2DD`) the date button's hairline, and `RUNNING_*` the waiting strip.
 * What follows is the geometry that is genuinely new.
 *
 * **One discrepancy found while decoding, deliberately NOT fixed here.**
 * Board 1.3's `.tab` is `36px / 600`; `FilterTab` in `TodaysBeatScreen.tsx`
 * renders it at `38px / 600`, so it matches neither board. Board 1.5's
 * `.seg` is `38px / 700` — different again. `FilterTab` is therefore **not**
 * reused for board 1.5; this screen builds its own segment at the right
 * weight. Slice 005's 2 px discrepancy is left alone because
 * `TodaysBeatScreen` is not this feature's file, and is recorded here and in
 * `specs/008-my-visits/tasks.md` as its own small fix.
 */

/** `.seg` on board 1.5 — 38 tall, radius 10, weight 700, size 14. */
export const SEGMENT_HEIGHT = 38;

/** The date-range control in board 1.5's header. */
export const DATE_BUTTON_HEIGHT = 40;

/** The `ORD` / `NO` badge on a visit row: 36 square, radius 11, 11/800. */
export const VISIT_BADGE_SIZE = 36;

/**
 * Board 1.6 ("My totals", uuid `ef79b256-19a4-4963-b087-47a8ee0a71f7`),
 * decoded with the CLAUDE.md recipe.
 *
 * Almost every colour board 1.6 uses is already defined above at the same
 * hex, so they are reused by name rather than redeclared: `BLUE` is the
 * completion card, the Orders tile value, the brand bar fill and today's
 * column; `ON_BLUE_MUTED` is that card's secondary copy; `BLUE_CHIP` is the
 * progress track and `AMBER_ACCENT` its fill; `TAB_TRACK` is the period tab
 * track and `SEGMENT_HEIGHT` its segment, identical to board 1.5's `.seg` at
 * weight 700; `BORDER` is every card hairline; and `ROW_SEPARATOR` is both
 * the brand row divider and the brand bar's own track.
 */

/** A day with orders that is not today, in the weekly chart. */
export const CHART_BAR_INACTIVE = '#9DB5F0';

/** The weekly chart card's fixed height. */
export const CHART_CARD_HEIGHT = 110;

/** The tallest a weekly column's bar gets — the busiest day of the week. */
export const CHART_BAR_MAX_HEIGHT = 54;

/** The completion percentage on the blue card. */
export const COMPLETION_RATE_SIZE = 30;

/**
 * `1,286` / `5,742` / `1,28,600` — Indian digit grouping, which is what
 * board 1.6 uses (`toLocaleString('en-IN')`).
 *
 * Written out rather than delegated to `Intl`: Hermes ships a reduced ICU
 * and `toLocaleString` can quietly ignore the locale there, which would
 * silently switch the grouping to thousands on device while looking correct
 * in any JS console. The rule is the last three digits, then pairs.
 */
export function formatQuantity(value: number): string {
  const digits = Math.abs(Math.trunc(value)).toString();
  const sign = value < 0 ? '-' : '';
  if (digits.length <= 3) {
    return `${sign}${digits}`;
  }
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  return `${sign}${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
}
