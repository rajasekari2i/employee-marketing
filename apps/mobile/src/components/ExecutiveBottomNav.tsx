import { Alert, Pressable, Text, View } from 'react-native';

import { OutlineIcon, type IconShape } from './icons/OutlineIcon';

/**
 * The bottom nav bar on the Marketing Executive's screens
 * (`docs/ui-design/Field_Sales_Beat_App.html` board 1.3).
 *
 * **Three** items, not the admin bar's four — Today · My visits · My totals.
 * All three render even though only Today is built, because omitting two
 * would visibly change the bar's spacing and proportions against the board,
 * and the standing fidelity rule is about the rendered result. The admin bar
 * already sets the precedent of a live bar with not-yet-built destinations.
 *
 * A sibling of `AdminBottomNav` rather than a parameterised shared component:
 * that one is written around the admin's own four-item set and route names,
 * and a generic version of both would be harder to read than two small files.
 */

const BLUE = '#1D4ED8';
const MUTED = '#5A6474';
const BORDER = '#DFE4EC';

const ICON_TODAY: IconShape[] = [
  { d: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z' },
  { circle: [12, 10, 2.5] },
];
const ICON_MY_VISITS: IconShape[] = [
  { circle: [12, 12, 9] },
  { d: 'M12 7v5l3 2' },
];
const ICON_MY_TOTALS: IconShape[] = [
  { d: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
];

export type ExecutiveBottomNavTab = 'Today' | 'MyVisits' | 'MyTotals';

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

export function ExecutiveBottomNav({
  active,
  onTodayPress,
  bottomInset = 0,
}: {
  active: ExecutiveBottomNavTab | null;
  onTodayPress: () => void;
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
        active={active === 'Today'}
        icon={ICON_TODAY}
        label="Today"
        onPress={onTodayPress}
      />
      <NavItem
        active={active === 'MyVisits'}
        icon={ICON_MY_VISITS}
        label="My visits"
        onPress={() => comingSoon('My visits')}
      />
      <NavItem
        active={active === 'MyTotals'}
        icon={ICON_MY_TOTALS}
        label="My totals"
        onPress={() => comingSoon('My totals')}
      />
    </View>
  );
}
