import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RoleKey, UserStatus } from '@field-sales/shared';

import { apiRequest } from '../../api/client';
import { AdminBottomNav } from '../../components/AdminBottomNav';
import {
  OutlineIcon,
  type IconShape,
} from '../../components/icons/OutlineIcon';
import type { AdminStackParamList } from '../../navigation/RootNavigator';
import { BG, BLUE, BORDER, INK, MUTED, ROLE_LABELS } from './adminDesign';

/**
 * PRD §4 screen 4.10 ("Users · list"). Layout/colors/icons below are taken
 * verbatim from `docs/ui-design/Field_Sales_Beat_App.html` §4.10 — see that
 * board for the source of every hex value and SVG path here.
 *
 * The design's one filter row is role only — "All" / "Executives" /
 * "Managers" / "Employees" (no `COMPANY_ADMIN` chip; no separate status
 * filter row) — so the previous implementation's extra status-filter row
 * is dropped to match. Deactivating a user is still fully reachable, just
 * relocated to match the design's own structure: tapping a row opens
 * `UserFormScreen` (`UserForm.dc.html` in the design), which already has
 * an Active/Inactive picker — there was never a dedicated "deactivate"
 * control in this board, only in a past session's addition to this screen.
 */

interface UserListItem {
  id: string;
  name: string;
  role: RoleKey;
  status: UserStatus;
  username: string | null;
  email: string | null;
  monthlySalary: string | null;
  halfDayRate: string | null;
  rateEffectiveFrom: string | null;
  photoUrl: string | null;
}

interface UsersListResponse {
  items: UserListItem[];
  nextCursor: string | null;
}

type UsersListNavigationProp = NativeStackNavigationProp<
  AdminStackParamList,
  'UsersList'
>;

/** The design's 3 role chips, in order — `COMPANY_ADMIN` has no chip of its own. */
const ROLE_FILTER_OPTIONS: Array<{ key: RoleKey; label: string }> = [
  { key: 'MARKETING_EXECUTIVE', label: 'Executives' },
  { key: 'MANAGER', label: 'Managers' },
  { key: 'EMPLOYEE', label: 'Employees' },
];

const ICON_BACK: IconShape[] = [{ d: 'M15 18l-6-6 6-6' }];
const ICON_SEARCH: IconShape[] = [
  { circle: [11, 11, 7] },
  { d: 'M20 20l-4-4' },
];
const ICON_PLUS: IconShape[] = [{ d: 'M12 5v14M5 12h14' }];

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return '?';
  }
  const first = words[0]?.charAt(0) ?? '';
  const last =
    words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? '') : '';
  return (first + last).toUpperCase();
}

/** Active: #E3EBFC/#1E3A8A (avatar + status chip + name); Inactive: #E9EDF3/#3A4353, dimmed name. */
function statusColors(status: UserStatus) {
  return status === 'ACTIVE'
    ? { bg: '#E3EBFC', fg: '#1E3A8A', nameColor: INK }
    : { bg: '#E9EDF3', fg: '#3A4353', nameColor: MUTED };
}

export function UsersListScreen() {
  const navigation = useNavigation<UsersListNavigationProp>();
  const insets = useSafeAreaInsets();

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleKey | 'ALL'>('ALL');

  const [items, setItems] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Unfiltered — only for the header's "N active · N inactive" and each
  // chip's count, same posture as HomeScreen.tsx's "Users & roles" tile
  // (up to 100 users, counted client-side; no dedicated count endpoint).
  const [allUsers, setAllUsers] = useState<UserListItem[]>([]);

  // Debounce the raw text input into `debouncedSearch` so `load()` below
  // doesn't fire a `GET /users` on every keystroke.
  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 400);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) {
        params.set('search', debouncedSearch);
      }
      if (roleFilter !== 'ALL') {
        params.set('role', roleFilter);
      }
      const query = params.toString();
      const result = await apiRequest<UsersListResponse>(
        `/users${query ? `?${query}` : ''}`,
      );
      setItems(result.items);
    } catch {
      // Leave the previous list visible on a transient failure rather than
      // clearing it — there is no dedicated error banner on this screen in
      // this slice.
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, roleFilter]);

  const loadCounts = useCallback(async () => {
    try {
      const result = await apiRequest<UsersListResponse>('/users?limit=100');
      setAllUsers(result.items);
    } catch {
      // Leave the previous counts visible on a transient failure.
    }
  }, []);

  // Filter/search changes while this screen is already focused.
  useEffect(() => {
    void load();
  }, [load]);

  // DoD item 11 / spec.md Acceptance Scenario 5: refetch on every
  // screen-focus (not just mount) so a just-created/edited/deactivated user
  // shows up with no manual pull-to-refresh needed.
  useFocusEffect(
    useCallback(() => {
      void load();
      void loadCounts();
    }, [load, loadCounts]),
  );

  const activeCount = allUsers.filter((u) => u.status === 'ACTIVE').length;
  const inactiveCount = allUsers.length - activeCount;
  const countForRole = (role: RoleKey) =>
    allUsers.filter((u) => u.role === role).length;

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <View
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 20,
          paddingBottom: 12,
          gap: 12,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable
            accessibilityLabel="Back to home"
            onPress={() => navigation.goBack()}
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: BORDER,
              backgroundColor: '#FFFFFF',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <OutlineIcon
              color={INK}
              shapes={ICON_BACK}
              size={20}
              strokeWidth={2}
            />
          </Pressable>
          <View style={{ gap: 2 }}>
            <Text style={{ fontSize: 13, color: MUTED }}>
              {activeCount} active · {inactiveCount} inactive
            </Text>
            <Text style={{ fontSize: 28, fontWeight: '700', color: INK }}>
              Users &amp; roles
            </Text>
          </View>
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            height: 48,
            paddingHorizontal: 12,
            borderRadius: 12,
            backgroundColor: '#FFFFFF',
            borderWidth: 1.5,
            borderColor: '#CBD2DD',
          }}
        >
          <OutlineIcon color={MUTED} shapes={ICON_SEARCH} size={18} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setSearchInput}
            placeholder="Search name, username or email"
            placeholderTextColor={MUTED}
            style={{ flexGrow: 1, fontSize: 15, fontWeight: '500', color: INK }}
            testID="users-list-search"
            value={searchInput}
          />
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable
            onPress={() => setRoleFilter('ALL')}
            style={{
              height: 36,
              paddingHorizontal: 14,
              borderRadius: 999,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: roleFilter === 'ALL' ? INK : '#FFFFFF',
              borderWidth: roleFilter === 'ALL' ? 0 : 1.5,
              borderColor: '#CBD2DD',
            }}
            testID="users-list-role-filter-ALL"
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: '600',
                color: roleFilter === 'ALL' ? '#FFFFFF' : INK,
              }}
            >
              All
            </Text>
          </Pressable>
          {ROLE_FILTER_OPTIONS.map(({ key, label }) => {
            const active = roleFilter === key;
            const count = countForRole(key);
            return (
              <Pressable
                key={key}
                onPress={() => setRoleFilter(key)}
                style={{
                  height: 36,
                  paddingHorizontal: 14,
                  borderRadius: 999,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: active ? INK : '#FFFFFF',
                  borderWidth: active ? 0 : 1.5,
                  borderColor: '#CBD2DD',
                }}
                testID={`users-list-role-filter-${key}`}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: '600',
                    color: active ? '#FFFFFF' : INK,
                  }}
                >
                  {count > 0 ? `${label} · ${count}` : label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {loading && items.length === 0 ? (
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        >
          <ActivityIndicator testID="users-list-loading" />
        </View>
      ) : (
        <View style={{ flex: 1, paddingHorizontal: 20 }}>
          <View
            style={{
              backgroundColor: '#FFFFFF',
              borderWidth: 1,
              borderColor: BORDER,
              borderRadius: 16,
              overflow: 'hidden',
            }}
          >
            <FlatList
              contentContainerStyle={{
                paddingBottom: 84 + insets.bottom + 20,
              }}
              data={items}
              keyExtractor={(item) => item.id}
              ListEmptyComponent={
                <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                  <Text style={{ fontSize: 14, color: MUTED }}>
                    No users found.
                  </Text>
                </View>
              }
              renderItem={({ item, index }) => {
                const colors = statusColors(item.status);
                return (
                  <Pressable
                    onPress={() =>
                      navigation.navigate('UserForm', { user: item })
                    }
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      borderBottomWidth: index === items.length - 1 ? 0 : 1,
                      borderBottomColor: '#ECEFF4',
                    }}
                    testID={`users-list-row-${item.id}`}
                  >
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        backgroundColor: colors.bg,
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 14,
                          fontWeight: '700',
                          color: colors.fg,
                        }}
                      >
                        {initialsFor(item.name)}
                      </Text>
                    </View>
                    <View style={{ flexGrow: 1, minWidth: 0, gap: 2 }}>
                      <Text
                        style={{
                          fontSize: 15,
                          fontWeight: '700',
                          color: colors.nameColor,
                        }}
                      >
                        {item.name}
                      </Text>
                      <Text style={{ fontSize: 12, color: MUTED }}>
                        {ROLE_LABELS[item.role]}
                        {item.halfDayRate
                          ? ` · ₹${item.halfDayRate}/half-day`
                          : ''}
                      </Text>
                    </View>
                    <View
                      style={{
                        height: 22,
                        paddingHorizontal: 8,
                        borderRadius: 999,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: colors.bg,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: '700',
                          color: colors.fg,
                        }}
                      >
                        {item.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                      </Text>
                    </View>
                  </Pressable>
                );
              }}
            />
          </View>
        </View>
      )}

      <Pressable
        onPress={() => navigation.navigate('UserForm', undefined)}
        style={{
          position: 'absolute',
          right: 20,
          bottom: 84 + insets.bottom + 20,
          height: 56,
          paddingHorizontal: 20,
          borderRadius: 18,
          backgroundColor: BLUE,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          shadowColor: '#1D4ED8',
          shadowOpacity: 0.3,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: 6,
        }}
        testID="users-list-add"
      >
        <OutlineIcon
          color="#FFFFFF"
          shapes={ICON_PLUS}
          size={20}
          strokeWidth={2.2}
        />
        <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>
          New user
        </Text>
      </Pressable>

      <AdminBottomNav
        active={null}
        bottomInset={insets.bottom}
        onHomePress={() => navigation.goBack()}
        onShopsPress={() => navigation.navigate('ShopsList')}
      />
    </View>
  );
}
