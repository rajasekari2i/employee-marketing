import { Pressable, Text, View } from 'react-native';

import { OutlineIcon, type IconShape } from './icons/OutlineIcon';

/**
 * The bottom nav bar on the Manager's screens
 * (`docs/ui-design/Field_Sales_Beat_App.html` board 3.1).
 *
 * **Three** items — Reports · Visits · Attendance — the manager's own set,
 * which is neither the admin's four nor the executive's three.
 *
 * A third sibling of `AdminBottomNav` and `ExecutiveBottomNav` rather than a
 * parameterised shared component, for the reason `ExecutiveBottomNav`'s own
 * header records: each is written around its role's item set and route
 * names, and a generic version of three would be harder to read than three
 * small files.
 *
 * **Profile is deliberately not here.** PRD §4 records that "Profile is
 * reached from the avatar menu, not the bottom bar", and none of the three
 * profile boards marks a bar item as current — which is why `active` is
 * nullable.
 */

const BLUE = '#1D4ED8';
const MUTED = '#5A6474';
const BORDER = '#DFE4EC';

const ICON_REPORTS: IconShape[] = [{ d: 'M4 20V10M10 20V4M16 20v-7M22 20H2' }];
const ICON_VISITS: IconShape[] = [
  { circle: [12, 12, 9] },
  { d: 'M12 7v5l3 2' },
];
const ICON_ATTENDANCE: IconShape[] = [
  { rect: [3, 5, 18, 16, 2] },
  { d: 'M3 10h18M8 3v4M16 3v4M9 15l2 2 4-4' },
];

export type ManagerBottomNavTab = 'Reports' | 'Visits' | 'Attendance';

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

export function ManagerBottomNav({
  active,
  onReportsPress,
  onVisitsPress,
  onAttendancePress,
  bottomInset = 0,
}: {
  /** `null` when the current screen is not one of the three (e.g. Profile). */
  active: ManagerBottomNavTab | null;
  onReportsPress: () => void;
  onVisitsPress: () => void;
  onAttendancePress: () => void;
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
        active={active === 'Reports'}
        icon={ICON_REPORTS}
        label="Reports"
        onPress={onReportsPress}
      />
      <NavItem
        active={active === 'Visits'}
        icon={ICON_VISITS}
        label="Visits"
        onPress={onVisitsPress}
      />
      <NavItem
        active={active === 'Attendance'}
        icon={ICON_ATTENDANCE}
        label="Attendance"
        onPress={onAttendancePress}
      />
    </View>
  );
}
