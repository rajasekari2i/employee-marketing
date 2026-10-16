import { Alert } from 'react-native';
import type { RoleKey } from '@field-sales/shared';

/**
 * Design tokens/helpers shared by every Company Admin screen built from
 * `docs/ui-design/Field_Sales_Beat_App.html`'s §4.x boards (so far §4.1
 * Home and §4.14 Profile) — hex values are copied verbatim from those
 * boards' CSS, not approximated from the NativeWind/Tailwind scale.
 */

export const BLUE = '#1D4ED8';
export const INK = '#141A26';
export const MUTED = '#5A6474';
export const LABEL = '#3A4353';
export const BORDER = '#DFE4EC';
export const BG = '#F3F5F9';
export const AMBER = '#7A4105';
export const DANGER = '#A3261B';

export const ROLE_LABELS: Record<RoleKey, string> = {
  SYSTEM_ADMIN: 'System Admin',
  COMPANY_ADMIN: 'Company Administrator',
  MANAGER: 'Manager',
  MARKETING_EXECUTIVE: 'Marketing Executive',
  EMPLOYEE: 'Employee',
};

/** "Ramesh N" -> "RN" — the two-letter avatar initials every board uses. */
export function initialsFor(name: string | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return '?';
  }
  const first = words[0]?.charAt(0) ?? '';
  const last =
    words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? '') : '';
  return (first + last).toUpperCase();
}

/** For any tile/action whose backend module isn't built yet (CLAUDE.md's build order). */
export function comingSoon(feature: string): void {
  Alert.alert(feature, 'This is coming in a later update.');
}
