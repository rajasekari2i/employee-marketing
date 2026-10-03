import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  TENANT_ASSIGNABLE_ROLE_KEYS,
  type RoleKey,
  type TenantAssignableRoleKey,
  type UserStatus,
} from '@field-sales/shared';

import { apiRequest, generateIdempotencyKey } from '../../api/client';
import type { AdminStackParamList } from '../../navigation/RootNavigator';

/**
 * User Story 3 (specs/001-company-user-auth/orchestration-plan.md), DoD
 * item 9 / PRD §4 screen 4.10. Debounced search (name/username/email),
 * role + status filter chips, calling `GET /users`; each row shows
 * initials, role, half-day rate and status (FR-015). Also carries DoD item
 * 11 (Deactivate) — the row-level action reached from this same screen.
 */

interface UserListItem {
  id: string;
  name: string;
  role: RoleKey;
  status: UserStatus;
  username: string | null;
  email: string | null;
  halfDayRate: string | null;
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

const ROLE_LABELS: Record<RoleKey, string> = {
  SYSTEM_ADMIN: 'System Admin',
  COMPANY_ADMIN: 'Company Admin',
  MANAGER: 'Manager',
  MARKETING_EXECUTIVE: 'Marketing Executive',
  EMPLOYEE: 'Employee',
};

const ROLE_FILTER_OPTIONS: Array<TenantAssignableRoleKey | 'ALL'> = [
  'ALL',
  ...TENANT_ASSIGNABLE_ROLE_KEYS,
];
const STATUS_FILTER_OPTIONS: Array<UserStatus | 'ALL'> = [
  'ALL',
  'ACTIVE',
  'INACTIVE',
];

function initialFor(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : '?';
}

function Chip({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      className={
        active
          ? 'mr-2 rounded-full bg-brand-600 px-3 py-1'
          : 'mr-2 rounded-full border border-gray-300 px-3 py-1'
      }
      onPress={onPress}
      testID={testID}
    >
      <Text
        className={
          active ? 'text-xs font-medium text-white' : 'text-xs text-gray-700'
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function UsersListScreen() {
  const navigation = useNavigation<UsersListNavigationProp>();

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<TenantAssignableRoleKey | 'ALL'>(
    'ALL',
  );
  const [statusFilter, setStatusFilter] = useState<UserStatus | 'ALL'>('ALL');

  const [items, setItems] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);

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
      if (statusFilter !== 'ALL') {
        params.set('status', statusFilter);
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
  }, [debouncedSearch, roleFilter, statusFilter]);

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
    }, [load]),
  );

  function confirmDeactivate(user: UserListItem): void {
    Alert.alert(
      'Deactivate user',
      `${user.name} will no longer be able to sign in. This cannot be undone from this screen.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deactivate',
          style: 'destructive',
          onPress: () => {
            void deactivate(user.id);
          },
        },
      ],
    );
  }

  async function deactivate(userId: string): Promise<void> {
    setDeactivatingId(userId);
    try {
      await apiRequest(`/users/${userId}`, {
        method: 'PATCH',
        body: { status: 'INACTIVE' },
        idempotencyKey: generateIdempotencyKey(),
      });
      await load();
    } catch {
      Alert.alert('Could not deactivate', 'Please try again.');
    } finally {
      setDeactivatingId(null);
    }
  }

  return (
    <View className="flex-1 bg-white">
      <View className="border-b border-gray-200 px-4 py-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-lg font-semibold text-brand-700">Users</Text>
          <Pressable
            className="rounded-md bg-brand-600 px-3 py-2"
            onPress={() => navigation.navigate('UserForm', undefined)}
            testID="users-list-add"
          >
            <Text className="text-xs font-semibold text-white">+ Add user</Text>
          </Pressable>
        </View>

        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          className="mt-3 rounded-md border border-gray-300 px-3 py-2 text-base text-gray-900"
          onChangeText={setSearchInput}
          placeholder="Search name, username or email"
          testID="users-list-search"
          value={searchInput}
        />

        <View className="mt-3 flex-row flex-wrap">
          {ROLE_FILTER_OPTIONS.map((option) => (
            <Chip
              active={roleFilter === option}
              key={`role-${option}`}
              label={option === 'ALL' ? 'All roles' : ROLE_LABELS[option]}
              onPress={() => setRoleFilter(option)}
              testID={`users-list-role-filter-${option}`}
            />
          ))}
        </View>
        <View className="mt-2 flex-row flex-wrap">
          {STATUS_FILTER_OPTIONS.map((option) => (
            <Chip
              active={statusFilter === option}
              key={`status-${option}`}
              label={option === 'ALL' ? 'All statuses' : option}
              onPress={() => setStatusFilter(option)}
              testID={`users-list-status-filter-${option}`}
            />
          ))}
        </View>
      </View>

      {loading && items.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator testID="users-list-loading" />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            <View className="items-center py-10">
              <Text className="text-sm text-gray-500">No users found.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              className="flex-row items-center border-b border-gray-100 px-4 py-3"
              onPress={() => navigation.navigate('UserForm', { user: item })}
              testID={`users-list-row-${item.id}`}
            >
              <View className="h-10 w-10 items-center justify-center rounded-full bg-brand-600">
                <Text className="font-semibold text-white">
                  {initialFor(item.name)}
                </Text>
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-base text-gray-900">{item.name}</Text>
                <Text className="text-xs text-gray-500">
                  {ROLE_LABELS[item.role]}
                  {item.halfDayRate ? ` · ₹${item.halfDayRate}/half-day` : ''}
                </Text>
              </View>
              <Text
                className={
                  item.status === 'ACTIVE'
                    ? 'mr-3 text-xs font-medium text-green-700'
                    : 'mr-3 text-xs font-medium text-gray-400'
                }
              >
                {item.status}
              </Text>
              {item.status === 'ACTIVE' ? (
                <Pressable
                  disabled={deactivatingId === item.id}
                  onPress={(event) => {
                    event.stopPropagation();
                    confirmDeactivate(item);
                  }}
                  testID={`users-list-deactivate-${item.id}`}
                >
                  <Text className="text-xs font-medium text-red-600">
                    {deactivatingId === item.id
                      ? 'Deactivating…'
                      : 'Deactivate'}
                  </Text>
                </Pressable>
              ) : null}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
