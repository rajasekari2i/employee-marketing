import { Alert, Pressable, Text, View } from 'react-native';

import { OutlineIcon, type IconShape } from './icons/OutlineIcon';

/**
 * The bottom nav bar on every Company Admin screen that has one
 * (`docs/ui-design/Field_Sales_Beat_App.html` §4.1/§4.14 both carry it
 * identically — same 4 items, same icons). Shared so the icon paths (and
 * the fix for the "Visits" icon's outer clipboard rect, missing from the
 * first, Home-only copy of this) live in exactly one place.
 *
 * As of 011-admin-visits all four items have a destination; each is still an
 * optional prop defaulting to the "coming soon" alert, so a screen that
 * hasn't been updated to pass one keeps working.
 */

const BLUE = '#1D4ED8';
const MUTED = '#5A6474';
const BORDER = '#DFE4EC';

const ICON_HOME: IconShape[] = [
  { d: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
];
const ICON_VISITS: IconShape[] = [
  { rect: [5, 4, 14, 17, 2] },
  { d: 'M9 3h6v3H9zM9 13l2 2 4-4' },
];
const ICON_BEATS: IconShape[] = [
  { circle: [6, 18, 2.5] },
  { circle: [18, 6, 2.5] },
  { d: 'M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5' },
];
const ICON_SHOPS: IconShape[] = [
  { d: 'M3 9l1.5-5h15L21 9M3 9h18M3 9v11h18V9M9 20v-6h6v6' },
];

export type AdminBottomNavTab = 'Home' | 'Visits' | 'Beats' | 'Shops';

function comingSoon(feature: string): void {
  Alert.alert(feature, 'This is coming in a later update.');
}

function NavItem({
  icon,
  label,
  active,
  onPress,
}: {
  icon: IconShape[];
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{ flex: 1, alignItems: 'center', gap: 4, paddingTop: 10 }}
    >
      <OutlineIcon color={active ? BLUE : MUTED} shapes={icon} size={24} />
      <Text
        style={{
          fontSize: 12,
          fontWeight: '600',
          color: active ? BLUE : MUTED,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function AdminBottomNav({
  active,
  onHomePress,
  onVisitsPress,
  onBeatsPress,
  onShopsPress,
  bottomInset = 0,
}: {
  /** `null` when the current screen isn't one of these 4 (e.g. Profile). */
  active: AdminBottomNavTab | null;
  onHomePress: () => void;
  /** 011-admin-visits: navigates to the company-wide visits list, board 4.2. Defaults to the "coming soon" alert for any screen that hasn't been updated to pass this yet. */
  onVisitsPress?: () => void;
  /** 003-beat-plans-crud: navigates to the beat plan directory. Defaults to the "coming soon" alert for any screen that hasn't been updated to pass this yet. */
  onBeatsPress?: () => void;
  /** 002-shops-crud: navigates to the shop directory. Defaults to the "coming soon" alert for any screen that hasn't been updated to pass this yet. */
  onShopsPress?: () => void;
  bottomInset?: number;
}) {
  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: 84 + bottomInset,
        paddingBottom: bottomInset,
        flexDirection: 'row',
        backgroundColor: '#FFFFFF',
        borderTopWidth: 1,
        borderTopColor: BORDER,
      }}
    >
      <NavItem
        active={active === 'Home'}
        icon={ICON_HOME}
        label="Home"
        onPress={onHomePress}
      />
      <NavItem
        active={active === 'Visits'}
        icon={ICON_VISITS}
        label="Visits"
        onPress={onVisitsPress ?? (() => comingSoon('Visits'))}
      />
      <NavItem
        active={active === 'Beats'}
        icon={ICON_BEATS}
        label="Beats"
        onPress={onBeatsPress ?? (() => comingSoon('Beat plans'))}
      />
      <NavItem
        active={active === 'Shops'}
        icon={ICON_SHOPS}
        label="Shops"
        onPress={onShopsPress ?? (() => comingSoon('Shops'))}
      />
    </View>
  );
}
