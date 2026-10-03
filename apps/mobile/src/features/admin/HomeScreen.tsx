import { useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import type { RoleKey, UserStatus } from '@field-sales/shared';

import { apiRequest } from '../../api/client';
import { clearSession, getSession } from '../../lib/secureSession';
import type { AdminStackParamList } from '../../navigation/RootNavigator';

/**
 * User Story 2 (specs/001-company-user-auth/orchestration-plan.md), DoD
 * items 6-7 / PRD §4 screen 4.1 ("Admin home"). This slice only builds the
 * name display + avatar menu (Profile/Log out) the DoD calls for — the
 * full 4.1 (tiles, today's-assignment banner, company settings summary,
 * bottom bar) is FR-ADM's later scope, not this story's.
 */

/** contracts/me.md's exact `GET /me` response shape. */
interface MeResponse {
  id: string;
  name: string;
  email: string | null;
  username: string | null;
  role: RoleKey;
  companyId: string | null;
  status: UserStatus;
  photoUrl: string | null;
  permissions: string[];
  company: { name: string; timezone: string } | null;
}

type HomeNavigationProp = NativeStackNavigationProp<
  AdminStackParamList,
  'Home'
>;

function initialFor(name: string | undefined): string {
  const trimmed = (name ?? '').trim();
  return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : '?';
}

export function HomeScreen() {
  const navigation = useNavigation<HomeNavigationProp>();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void apiRequest<MeResponse>('/me')
      .then((data) => {
        if (!cancelled) {
          setMe(data);
        }
      })
      .catch(() => {
        // A failed /me call here is almost always the API client's own
        // refresh-retry interceptor having already cleared the session
        // store on an unrecoverable 401 — RootNavigator is about to swap
        // back to Sign In on its own (subscribeSession()), so there is
        // nothing useful to show the user in the moment before that
        // happens.
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout(): Promise<void> {
    setMenuOpen(false);
    setLoggingOut(true);
    try {
      const session = await getSession();
      if (session) {
        // contracts/auth.md: logout requires auth (the still-valid access
        // token, attached automatically by apiRequest()) and the stored
        // refresh token in the body.
        await apiRequest('/auth/logout', {
          method: 'POST',
          body: { refreshToken: session.refreshToken },
        });
      }
    } catch {
      // DoD item 7: clear the session store regardless of the logout
      // call's success/failure — never strand the user looking
      // logged-in because of a network error.
    } finally {
      await clearSession();
      setLoggingOut(false);
      // No explicit navigation call: clearing the session store notifies
      // RootNavigator (subscribeSession()), which swaps back to the Sign
      // In stack on its own — same pattern as SignInScreen's login.
    }
  }

  return (
    <View className="flex-1 bg-white">
      <View className="flex-row items-center justify-between border-b border-gray-200 px-4 py-3">
        <Text className="text-lg font-semibold text-brand-700">Home</Text>
        <Pressable
          accessibilityLabel="Account menu"
          onPress={() => setMenuOpen(true)}
          testID="home-avatar"
        >
          <View className="h-9 w-9 items-center justify-center rounded-full bg-brand-600">
            <Text className="font-semibold text-white">
              {initialFor(me?.name)}
            </Text>
          </View>
        </Pressable>
      </View>

      <View className="flex-1 items-center justify-center px-6">
        {loading ? (
          <ActivityIndicator testID="home-loading" />
        ) : (
          <Text className="text-lg text-gray-800" testID="home-user-name">
            {me?.name ?? 'Signed in'}
          </Text>
        )}
      </View>

      <Modal
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
        transparent
        visible={menuOpen}
      >
        <Pressable
          className="flex-1 bg-black/20"
          onPress={() => setMenuOpen(false)}
        >
          <View className="absolute right-4 top-16 w-44 rounded-md bg-white py-1 shadow-lg">
            <Pressable
              className="px-4 py-3"
              onPress={() => {
                setMenuOpen(false);
                navigation.navigate('Profile');
              }}
              testID="home-menu-profile"
            >
              <Text className="text-gray-800">Profile</Text>
            </Pressable>
            <Pressable
              className="px-4 py-3"
              disabled={loggingOut}
              onPress={() => {
                void handleLogout();
              }}
              testID="home-menu-logout"
            >
              <Text className="text-gray-800">
                {loggingOut ? 'Logging out…' : 'Log out'}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
