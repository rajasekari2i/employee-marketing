/**
 * Design tokens for the Manager's screens, taken from
 * `docs/ui-design/Field_Sales_Beat_App.html` boards 3.1–3.8 — decoded with
 * the recipe in CLAUDE.md, not approximated from a Tailwind scale.
 *
 * The base palette is shared with every other role and is re-exported from
 * `adminDesign` rather than redefined, so a value never drifts between
 * roles. Everything declared here is a colour the manager's boards use and
 * the other roles' do not.
 */

export {
  BG,
  BLUE,
  INK,
  MUTED,
  LABEL,
  BORDER,
  DANGER,
  ROLE_LABELS,
} from '../admin/adminDesign';

/** The violet "Add extra shop to today" action bar on board 3.1. */
export const ACTION_BAR_BG = '#EFE9FB';
export const ACTION_BAR_INK = '#5B2FA6';

/** Board 3.3's delivery chips, and board 3.4's status card. */
export const CHIP_TO_DELIVER_BG = '#EFE9FB';
export const CHIP_TO_DELIVER_FG = '#5B2FA6';
export const CHIP_DELIVERED_BG = '#E3EBFC';
export const CHIP_DELIVERED_FG = '#1E3A8A';
export const CHIP_NO_ORDER_BG = '#E9EDF3';
export const CHIP_NO_ORDER_FG = '#3A4353';

/** Board 3.3's `ORD` / `NO` row badges — the same pair board 1.5 uses. */
export const BADGE_ORDER_BG = '#E3EBFC';
export const BADGE_ORDER_FG = '#1E3A8A';
export const BADGE_NO_ORDER_BG = '#E9EDF3';
export const BADGE_NO_ORDER_FG = '#3A4353';

/**
 * A distance that exceeded the radius, on boards 3.1, 3.3 and 3.6.
 *
 * This is the colour of the thing an executive must never see at all. It is
 * here, and only here, because the manager's screens exist to surface it.
 */
export const OUT_OF_RANGE_INK = '#7A4105';

/** Board 3.1's within-range bar — within, exceeded, not visited. */
export const RANGE_WITHIN = '#1D4ED8';
export const RANGE_EXCEEDED = '#F2C572';
export const RANGE_NOT_VISITED = '#CBD2DD';

/** Row separator inside the manager's cards. */
export const ROW_SEPARATOR = '#ECEFF4';

/** Attendance cell fills on board 3.7 — always paired with TEXT, never colour alone (FR-039). */
export const ATT_PRESENT_BG = '#E3EBFC';
export const ATT_PRESENT_FG = '#1E3A8A';
export const ATT_LATE_BG = '#FCEFD9';
export const ATT_LATE_FG = '#7A4105';
export const ATT_ABSENT_BG = '#F8E3E0';
export const ATT_ABSENT_FG = '#A3261B';
export const ATT_NEUTRAL_BG = '#E9EDF3';
export const ATT_NEUTRAL_FG = '#3A4353';
export const ATT_UNMARKED_BG = '#F3F5F9';
