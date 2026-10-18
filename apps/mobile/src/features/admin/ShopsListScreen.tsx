import { useCallback, useEffect, useState } from 'react';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  FlatList,
  Modal,
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
import { BG, BLUE, BORDER, INK, LABEL, MUTED } from './adminDesign';

/**
 * PRD §4 screen 4.8 ("Shops · list"). Layout/colors/icons below are taken
 * verbatim from `docs/ui-design/Field_Sales_Beat_App.html` §4.8 — see that
 * board for the source of every hex value and SVG path here.
 *
 * The "All beats" filter opens a real picker (003-beat-plans-crud
 * follow-up) once `BeatPlan` exists — originally shipped disabled in
 * 002-shops-crud, before that slice was built. A shop's beat-plan
 * membership itself is still only ever set from the beat plan's own form
 * (`BeatPlanFormScreen`'s shop list); this screen only displays/filters by
 * it, never assigns it.
 */

export interface ShopSummaryForEdit {
  id: string;
  name: string;
  shopCode: string;
  ownerName: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  pinStatus: 'NONE' | 'APPROVED';
  latitude: number | null;
  longitude: number | null;
  locationSource: 'MAP_SEARCH' | 'MANUAL_DRAG' | null;
  verificationRadiusMeters: number | null;
  isActive: boolean;
  beatPlanNames: string[];
  photos: Array<{ id: string; url: string }>;
}

interface ShopsListResponse {
  items: ShopSummaryForEdit[];
  nextCursor: string | null;
}

type ShopsListNavigationProp = NativeStackNavigationProp<
  AdminStackParamList,
  'ShopsList'
>;
type ShopsListRouteProp = RouteProp<AdminStackParamList, 'ShopsList'>;

type QuickFilter = 'ALL' | 'NO_PIN' | 'INACTIVE';

const ICON_SEARCH: IconShape[] = [
  { circle: [11, 11, 7] },
  { d: 'M20 20l-4-4' },
];
const ICON_CHEVRON_DOWN: IconShape[] = [{ d: 'M6 9l6 6 6-6' }];
const ICON_PLUS: IconShape[] = [{ d: 'M12 5v14M5 12h14' }];
const ICON_CHECK: IconShape[] = [{ d: 'M20 6L9 17l-5-5' }];

/** Pin-saved: #E3EBFC/#1E3A8A; No-pin: #FCEFD9/#7A4105 (board 4.8's own `ok`/`miss` chip colors). */
function pinChipColors(pinStatus: 'NONE' | 'APPROVED') {
  return pinStatus === 'APPROVED'
    ? { bg: '#E3EBFC', fg: '#1E3A8A', label: 'Pin saved' }
    : { bg: '#FCEFD9', fg: '#7A4105', label: 'No pin' };
}

function addressLine(shop: ShopSummaryForEdit): string {
  return [shop.addressLine1, shop.addressLine2, shop.city]
    .filter((part) => part && part.length > 0)
    .join(', ');
}

export function ShopsListScreen() {
  const navigation = useNavigation<ShopsListNavigationProp>();
  const route = useRoute<ShopsListRouteProp>();
  const insets = useSafeAreaInsets();

  /**
   * 003-beat-plans-crud, research.md §2: when launched with `selectionMode`
   * (from `BeatPlanFormScreen`'s "+ Add existing shops"), this screen
   * becomes a multi-select picker instead of navigating to `ShopForm` on
   * tap — the FAB becomes "Done" and calls `onSelect` with the chosen
   * shops. No params (the normal Shops-tab case) leaves every existing
   * behavior below unchanged.
   */
  const selectionMode = route.params?.selectionMode ?? false;
  const onSelect = route.params?.onSelect;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState<QuickFilter>('ALL');

  // Beat-plans follow-up: "All beats" opens a real picker once a plan is
  // chosen, `beatPlanId` narrows the list server-side (contracts/shops.md).
  const [beatPlanOptions, setBeatPlanOptions] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [selectedBeatPlan, setSelectedBeatPlan] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [beatPlanPickerOpen, setBeatPlanPickerOpen] = useState(false);

  const [items, setItems] = useState<ShopSummaryForEdit[]>([]);
  const [loading, setLoading] = useState(true);

  // Unfiltered — only for the header's "N shops · N without pin" line, same
  // client-side-counted posture as UsersListScreen.tsx's "allUsers".
  const [allShops, setAllShops] = useState<ShopSummaryForEdit[]>([]);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 400);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    void apiRequest<{ items: Array<{ id: string; name: string }> }>(
      '/beat-plans?limit=100',
    )
      .then((result) => {
        if (!cancelled) {
          setBeatPlanOptions(result.items);
        }
      })
      .catch(() => {
        // Leave beatPlanOptions empty — the picker shows "All beats" only.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) {
        params.set('search', debouncedSearch);
      }
      if (filter === 'NO_PIN') {
        params.set('pinStatus', 'NO_PIN');
      } else if (filter === 'INACTIVE') {
        params.set('isActive', 'false');
      }
      if (selectedBeatPlan) {
        params.set('beatPlanId', selectedBeatPlan.id);
      }
      const query = params.toString();
      const result = await apiRequest<ShopsListResponse>(
        `/shops${query ? `?${query}` : ''}`,
      );
      setItems(result.items);
    } catch {
      // Leave the previous list visible on a transient failure — no
      // dedicated error banner on this screen in this slice.
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, filter, selectedBeatPlan]);

  const loadCounts = useCallback(async () => {
    try {
      const result = await apiRequest<ShopsListResponse>('/shops?limit=100');
      setAllShops(result.items);
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

  const noPinCount = allShops.filter((s) => s.pinStatus === 'NONE').length;

  function toggleSelected(shopId: string): void {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(shopId)) {
        next.delete(shopId);
      } else {
        next.add(shopId);
      }
      return next;
    });
  }

  function finishSelection(): void {
    const selectedShops = items.filter((item) => selectedIds.has(item.id));
    onSelect?.(selectedShops);
    navigation.goBack();
  }

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
            {allShops.length} shops · {noPinCount} without pin
          </Text>
          <Text style={{ fontSize: 28, fontWeight: '700', color: INK }}>
            Shops
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
            placeholder="Search name, code, owner or phone"
            placeholderTextColor={MUTED}
            style={{ flexGrow: 1, fontSize: 15, fontWeight: '500', color: INK }}
            testID="shops-list-search"
            value={searchInput}
          />
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable
            onPress={() => setBeatPlanPickerOpen(true)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              height: 36,
              paddingHorizontal: 14,
              borderRadius: 999,
              borderWidth: selectedBeatPlan ? 0 : 1.5,
              borderColor: '#CBD2DD',
              backgroundColor: selectedBeatPlan ? INK : '#FFFFFF',
            }}
            testID="shops-list-beat-filter"
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: '600',
                color: selectedBeatPlan ? '#FFFFFF' : INK,
              }}
              numberOfLines={1}
            >
              {selectedBeatPlan?.name ?? 'All beats'}
            </Text>
            <OutlineIcon
              color={selectedBeatPlan ? '#FFFFFF' : INK}
              shapes={ICON_CHEVRON_DOWN}
              size={14}
              strokeWidth={2}
            />
          </Pressable>
          {[
            { key: 'ALL' as const, label: 'All' },
            {
              key: 'NO_PIN' as const,
              label: noPinCount > 0 ? `No pin · ${noPinCount}` : 'No pin',
            },
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
                testID={`shops-list-filter-${key}`}
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
          <ActivityIndicator testID="shops-list-loading" />
        </View>
      ) : (
        <FlatList
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: selectionMode
              ? insets.bottom + 90
              : 84 + insets.bottom + 90,
            gap: 10,
          }}
          data={items}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <Text style={{ fontSize: 14, color: MUTED }}>
                No shops found.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const chip = pinChipColors(item.pinStatus);
            const selected = selectedIds.has(item.id);
            return (
              <Pressable
                onPress={() =>
                  selectionMode
                    ? toggleSelected(item.id)
                    : navigation.navigate('ShopForm', { shop: item })
                }
                style={{
                  backgroundColor: '#FFFFFF',
                  borderWidth: selected ? 2 : 1,
                  borderColor: selected ? BLUE : BORDER,
                  borderRadius: 16,
                  padding: 14,
                  gap: 5,
                  marginBottom: 10,
                }}
                testID={`shops-list-row-${item.id}`}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  {selectionMode ? (
                    <View
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 4,
                        borderWidth: 1.5,
                        borderColor: selected ? BLUE : '#AEB7C5',
                        backgroundColor: selected ? BLUE : '#FFFFFF',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {selected ? (
                        <OutlineIcon
                          color="#FFFFFF"
                          shapes={ICON_CHECK}
                          size={13}
                          strokeWidth={2.5}
                        />
                      ) : null}
                    </View>
                  ) : null}
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: '700',
                      color: INK,
                      flexShrink: 1,
                      flexGrow: 1,
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
                <Text numberOfLines={1} style={{ fontSize: 13, color: LABEL }}>
                  {addressLine(item)}
                </Text>
                <Text style={{ fontSize: 12, color: MUTED }}>
                  <Text style={{ fontFamily: 'monospace' }}>
                    {item.shopCode}
                  </Text>
                  {' · '}
                  {item.beatPlanNames.length > 0
                    ? item.beatPlanNames.join(', ')
                    : 'Unassigned'}
                  {' · '}
                  {item.ownerName ?? '—'}
                </Text>
              </Pressable>
            );
          }}
        />
      )}

      <Pressable
        onPress={
          selectionMode
            ? finishSelection
            : () => navigation.navigate('ShopForm', { shop: undefined })
        }
        style={{
          position: 'absolute',
          right: 20,
          bottom: selectionMode ? insets.bottom + 20 : 84 + insets.bottom + 20,
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
        testID={
          selectionMode ? 'shops-list-selection-done' : 'shops-list-new-shop'
        }
      >
        {selectionMode ? null : (
          <OutlineIcon
            color="#FFFFFF"
            shapes={ICON_PLUS}
            size={20}
            strokeWidth={2.2}
          />
        )}
        <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>
          {selectionMode ? `Done · ${selectedIds.size} selected` : 'New shop'}
        </Text>
      </Pressable>

      {selectionMode ? null : (
        <AdminBottomNav
          active="Shops"
          bottomInset={insets.bottom}
          onHomePress={() => navigation.navigate('Home')}
          onBeatsPress={() => navigation.navigate('BeatPlansList')}
          onShopsPress={() => {}}
        />
      )}

      <Modal
        animationType="slide"
        onRequestClose={() => setBeatPlanPickerOpen(false)}
        transparent
        visible={beatPlanPickerOpen}
      >
        <Pressable
          onPress={() => setBeatPlanPickerOpen(false)}
          style={{
            flex: 1,
            backgroundColor: 'rgba(20,26,38,0.4)',
            justifyContent: 'flex-end',
          }}
        >
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={{
              backgroundColor: '#FFFFFF',
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              maxHeight: '70%',
              paddingBottom: 20,
            }}
          >
            <Text
              style={{
                fontSize: 16,
                fontWeight: '700',
                color: INK,
                padding: 16,
              }}
            >
              Filter by beat plan
            </Text>
            <FlatList
              data={[{ id: '', name: 'All beats' }, ...beatPlanOptions]}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    setSelectedBeatPlan(item.id ? item : null);
                    setBeatPlanPickerOpen(false);
                  }}
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    borderTopWidth: 1,
                    borderTopColor: '#ECEFF4',
                  }}
                  testID={`shops-list-beat-filter-option-${item.id || 'all'}`}
                >
                  <Text style={{ fontSize: 15, color: INK }}>{item.name}</Text>
                </Pressable>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
