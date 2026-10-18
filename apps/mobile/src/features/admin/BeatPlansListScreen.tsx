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

import { apiRequest } from '../../api/client';
import { AdminBottomNav } from '../../components/AdminBottomNav';
import {
  OutlineIcon,
  type IconShape,
} from '../../components/icons/OutlineIcon';
import type { AdminStackParamList } from '../../navigation/RootNavigator';
import { BG, BORDER, INK, LABEL, MUTED } from './adminDesign';

/**
 * PRD §4 screen 4.6 ("Beat plans · list"). Layout/colors/icons below are
 * taken verbatim from `docs/ui-design/Field_Sales_Beat_App.html` §4.6 — see
 * that board for the source of every hex value and SVG path here.
 */

export interface BeatPlanSummaryForEdit {
  id: string;
  name: string;
  code: string;
  executive: { id: string; name: string } | null;
  workingDays: number[];
  isActive: boolean;
  shops: Array<{ id: string; name: string; pinStatus: 'NONE' | 'APPROVED' }>;
}

interface BeatPlansListResponse {
  items: BeatPlanSummaryForEdit[];
  nextCursor: string | null;
}

type BeatPlansListNavigationProp = NativeStackNavigationProp<
  AdminStackParamList,
  'BeatPlansList'
>;

type QuickFilter = 'ALL' | 'UNASSIGNED' | 'INACTIVE';

const ICON_SEARCH: IconShape[] = [
  { circle: [11, 11, 7] },
  { d: 'M20 20l-4-4' },
];
const ICON_PLUS: IconShape[] = [{ d: 'M12 5v14M5 12h14' }];

const DAY_ABBR = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Plan status chip — 3-way (the design's sample data only shows Active/Unassigned; Inactive reuses UsersListScreen.tsx's neutral inactive pair, same precedent ShopsListScreen.tsx's pin chip followed). Inactive takes precedence over assignment. */
function statusChip(plan: BeatPlanSummaryForEdit) {
  if (!plan.isActive) {
    return { bg: '#E9EDF3', fg: '#3A4353', label: 'Inactive' };
  }
  if (!plan.executive) {
    return { bg: '#FCEFD9', fg: '#7A4105', label: 'Unassigned' };
  }
  return { bg: '#E3EBFC', fg: '#1E3A8A', label: 'Active' };
}

/** `[1,2,3,4,5,6]` -> "Mon–Sat"; a non-contiguous or empty selection falls back to a plain list / "No days set". */
function workingDaysSummary(days: number[]): string {
  if (days.length === 0) {
    return 'No days set';
  }
  const sorted = [...days].sort((a, b) => a - b);
  const isContiguous = sorted.every((day, index) => {
    const previous = sorted[index - 1];
    return index === 0 || previous === undefined || day === previous + 1;
  });
  if (isContiguous) {
    const first = DAY_ABBR[sorted[0] ?? 0];
    const last = DAY_ABBR[sorted[sorted.length - 1] ?? 0];
    return first === last ? first! : `${first}–${last}`;
  }
  return sorted.map((day) => DAY_ABBR[day]).join(', ');
}

export function BeatPlansListScreen() {
  const navigation = useNavigation<BeatPlansListNavigationProp>();
  const insets = useSafeAreaInsets();

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState<QuickFilter>('ALL');

  const [items, setItems] = useState<BeatPlanSummaryForEdit[]>([]);
  const [loading, setLoading] = useState(true);

  // Unfiltered — only for the header's "N plans · N assigned" line, same
  // client-side-counted posture as ShopsListScreen.tsx's "allShops".
  const [allPlans, setAllPlans] = useState<BeatPlanSummaryForEdit[]>([]);

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
      if (filter === 'UNASSIGNED') {
        params.set('assignment', 'UNASSIGNED');
      } else if (filter === 'INACTIVE') {
        params.set('isActive', 'false');
      }
      const query = params.toString();
      const result = await apiRequest<BeatPlansListResponse>(
        `/beat-plans${query ? `?${query}` : ''}`,
      );
      setItems(result.items);
    } catch {
      // Leave the previous list visible on a transient failure — no
      // dedicated error banner on this screen in this slice.
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, filter]);

  const loadCounts = useCallback(async () => {
    try {
      const result = await apiRequest<BeatPlansListResponse>(
        '/beat-plans?limit=100',
      );
      setAllPlans(result.items);
    } catch {
      // Leave the previous counts visible on a transient failure.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
      void loadCounts();
    }, [load, loadCounts]),
  );

  const assignedCount = allPlans.filter((p) => p.executive !== null).length;

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
        <View style={{ gap: 2 }}>
          <Text style={{ fontSize: 13, color: MUTED }}>
            {allPlans.length} plans · {assignedCount} assigned
          </Text>
          <Text style={{ fontSize: 28, fontWeight: '700', color: INK }}>
            Beat plans
          </Text>
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
            placeholder="Search beat or executive"
            placeholderTextColor={MUTED}
            style={{ flexGrow: 1, fontSize: 15, fontWeight: '500', color: INK }}
            testID="beat-plans-list-search"
            value={searchInput}
          />
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[
            { key: 'ALL' as const, label: `All · ${allPlans.length}` },
            { key: 'UNASSIGNED' as const, label: 'Unassigned' },
            { key: 'INACTIVE' as const, label: 'Inactive' },
          ].map(({ key, label }) => {
            const active = filter === key;
            return (
              <Pressable
                key={key}
                onPress={() => setFilter(key)}
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
                testID={`beat-plans-list-filter-${key}`}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: '600',
                    color: active ? '#FFFFFF' : INK,
                  }}
                >
                  {label}
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
          <ActivityIndicator testID="beat-plans-list-loading" />
        </View>
      ) : (
        <FlatList
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: 84 + insets.bottom + 90,
            gap: 10,
          }}
          data={items}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <Text style={{ fontSize: 14, color: MUTED }}>
                No beat plans found.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const chip = statusChip(item);
            return (
              <Pressable
                onPress={() =>
                  navigation.navigate('BeatPlanForm', { beatPlan: item })
                }
                style={{
                  backgroundColor: '#FFFFFF',
                  borderWidth: 1,
                  borderColor: BORDER,
                  borderRadius: 16,
                  padding: 14,
                  gap: 6,
                  marginBottom: 10,
                }}
                testID={`beat-plans-list-row-${item.id}`}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: '700',
                      color: INK,
                      flexShrink: 1,
                    }}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                  <View
                    style={{
                      height: 22,
                      paddingHorizontal: 8,
                      borderRadius: 999,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: chip.bg,
                      flexShrink: 0,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: '700',
                        color: chip.fg,
                      }}
                    >
                      {chip.label}
                    </Text>
                  </View>
                </View>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                  }}
                >
                  <Text style={{ fontSize: 13, color: LABEL }}>
                    <Text style={{ fontFamily: 'monospace', color: MUTED }}>
                      {item.code}
                    </Text>
                    {' · '}
                    {item.executive?.name ?? 'No executive'}
                  </Text>
                  <Text style={{ fontSize: 13, color: LABEL }}>
                    {item.shops.length} shops ·{' '}
                    {workingDaysSummary(item.workingDays)}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <Pressable
        onPress={() =>
          navigation.navigate('BeatPlanForm', { beatPlan: undefined })
        }
        style={{
          position: 'absolute',
          right: 20,
          bottom: 84 + insets.bottom + 20,
          height: 56,
          paddingHorizontal: 20,
          borderRadius: 18,
          backgroundColor: '#1D4ED8',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          shadowColor: '#1D4ED8',
          shadowOpacity: 0.3,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: 6,
        }}
        testID="beat-plans-list-new"
      >
        <OutlineIcon
          color="#FFFFFF"
          shapes={ICON_PLUS}
          size={20}
          strokeWidth={2.2}
        />
        <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>
          New beat plan
        </Text>
      </Pressable>

      <AdminBottomNav
        active="Beats"
        bottomInset={insets.bottom}
        onHomePress={() => navigation.navigate('Home')}
        onBeatsPress={() => {}}
        onShopsPress={() => navigation.navigate('ShopsList')}
      />
    </View>
  );
}
