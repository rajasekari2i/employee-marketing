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
