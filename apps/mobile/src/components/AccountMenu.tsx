import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BLUE,
  BORDER,
  DANGER,
  INK,
  LABEL,
  MUTED,
} from '../features/admin/adminDesign';
import { OutlineIcon, type IconShape } from './icons/OutlineIcon';

/**
 * The account control in the top-right of every role's home screen: the
 * avatar pill with its chevron, and the dropdown it opens offering **Profile**
 * and **Log out**.
 *
 * **One component for every role**, extracted from the Company Admin's home
 * (board 4.1), which is where this treatment was first built and which the
 * design repeats unchanged on the executive's board 1.3. It owns its own open
 * state so a call site is one element and cannot get the behaviour subtly
 * different — which is exactly what had happened:
 *
 *   * The admin's copy was a `<Modal>` with an absolutely-positioned card, so
 *     the dropdown floated **over** the screen the way a dropdown should.
 *   * The executive's copy rendered the same card **inline inside the scroll
 *     content**, so opening it pushed the entire page down instead of
 *     overlaying it. It also offered only "Log out" — there was no way to
 *     reach the profile screen at all — and hard-coded the role as
 *     "Marketing Executive".
 *
 * Both are now this one component, so the layout bug cannot come back and a
 * third role cannot reintroduce it.
 *
 * The dropdown is deliberately NOT a bar item: PRD §4 records that "Profile is
 * reached from the avatar menu, not the bottom bar", and none of the three
 * profile boards (1.9, 3.9, 4.14) marks it as current in its bar.
 */

const ICON_CHEVRON: IconShape[] = [{ d: 'M6 9l6 6 6-6' }];
const ICON_PROFILE: IconShape[] = [
  { circle: [12, 8, 3.6] },
  { d: 'M5 20c1.6-3.2 4-4.8 7-4.8s5.4 1.6 7 4.8' },
];
const ICON_LOGOUT: IconShape[] = [{ d: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10' }];

/** `Priya Sundaram` → `PS`. Falls back to one letter, then to nothing. */
export function initialsFor(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '';
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return `${parts[0]![0]!}${parts[parts.length - 1]![0]!}`.toUpperCase();
}

export function AccountMenu({
  name,
  roleLabel,
  onProfilePress,
  onLogoutPress,
  loggingOut = false,
  testIDPrefix = 'account',
}: {
  name: string | null | undefined;
  /** Already resolved from `ROLE_LABELS` — the menu never guesses a role. */
  roleLabel: string;
  onProfilePress: () => void;
  onLogoutPress: () => void;
  loggingOut?: boolean;
  testIDPrefix?: string;
}) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        accessibilityLabel={`Account menu — ${name ?? ''}`}
        onPress={() => setOpen(true)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          height: 48,
          paddingVertical: 2,
          paddingLeft: 2,
          paddingRight: 8,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: BORDER,
          backgroundColor: '#FFFFFF',
        }}
        testID={`${testIDPrefix}-avatar`}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: INK,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>
            {initialsFor(name)}
          </Text>
        </View>
        <OutlineIcon
          color={LABEL}
          shapes={ICON_CHEVRON}
          size={18}
          strokeWidth={2.2}
        />
      </Pressable>

      {/*
        A Modal, not an inline view. This is the whole point of the component:
        an inline card pushes the page down as it opens, which is what the
        executive's screen used to do.
      */}
      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}
      >
        <Pressable onPress={() => setOpen(false)} style={{ flex: 1 }}>
          <View
            style={{
              position: 'absolute',
              right: 20,
              top: insets.top + 60,
              width: 200,
              backgroundColor: '#FFFFFF',
              borderWidth: 1,
              borderColor: BORDER,
              borderRadius: 16,
              padding: 6,
              shadowColor: INK,
              shadowOpacity: 0.16,
              shadowRadius: 28,
              shadowOffset: { width: 0, height: 12 },
              elevation: 8,
            }}
          >
            <View
              style={{
                paddingHorizontal: 12,
                paddingTop: 10,
                paddingBottom: 8,
                borderBottomWidth: 1,
                borderBottomColor: '#ECEFF4',
                marginBottom: 4,
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '700', color: INK }}>
                {name ?? ''}
              </Text>
              <Text style={{ fontSize: 12, color: MUTED }}>{roleLabel}</Text>
            </View>

            <Pressable
              onPress={() => {
                setOpen(false);
                onProfilePress();
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                height: 44,
                paddingHorizontal: 12,
                borderRadius: 10,
              }}
              testID={`${testIDPrefix}-menu-profile`}
            >
              <OutlineIcon color={BLUE} shapes={ICON_PROFILE} size={18} />
              <Text style={{ fontSize: 15, fontWeight: '600', color: INK }}>
                Profile
              </Text>
            </Pressable>

            <Pressable
              disabled={loggingOut}
              onPress={() => {
                setOpen(false);
                onLogoutPress();
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                height: 44,
                paddingHorizontal: 12,
                borderRadius: 10,
              }}
              testID={`${testIDPrefix}-menu-logout`}
            >
              <OutlineIcon color={DANGER} shapes={ICON_LOGOUT} size={18} />
              <Text style={{ fontSize: 15, fontWeight: '600', color: DANGER }}>
                {loggingOut ? 'Logging out…' : 'Log out'}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
