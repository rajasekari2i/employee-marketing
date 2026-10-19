import { Pressable, Text, View } from 'react-native';

import {
  OutlineIcon,
  type IconShape,
} from '../../components/icons/OutlineIcon';
import { BLUE, DASHED_BUTTON_HEIGHT } from './executiveDesign';

/**
 * The dashed secondary action boards 1.3 and 1.4 both draw, identically:
 *
 *   height 48, border-radius 14, 1.5px dashed #1D4ED8, 700/15 label in
 *   #1D4ED8, plus-icon (stroke-width 2.2) on the left, 8px gap.
 *
 * One treatment rather than two copies — board 1.3's "Add extra shop to
 * today" and board 1.4's "Shop not listed — create new" are the same control
 * with different copy, and letting them drift would be a fidelity defect on
 * whichever got edited second (007-extra-shops, FR-025).
 */

const ICON_PLUS: IconShape[] = [{ d: 'M12 5v14M5 12h14' }];

export function DashedAction({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{
        flexShrink: 0,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: DASHED_BUTTON_HEIGHT,
        borderRadius: 14,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: BLUE,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View>
        <OutlineIcon
          color={BLUE}
          shapes={ICON_PLUS}
          size={18}
          strokeWidth={2.2}
        />
      </View>
      <Text style={{ fontSize: 15, fontWeight: '700', color: BLUE }}>
        {label}
      </Text>
    </Pressable>
  );
}
