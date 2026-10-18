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
 * PRD §4 screen 4.8 ("Shops · list"). Layout/colors/icons below are taken
 * verbatim from `docs/ui-design/Field_Sales_Beat_App.html` §4.8 — see that
 * board for the source of every hex value and SVG path here.
 *
 * The "All beats" filter chip is rendered exactly as the design shows it
 * but is disabled (`research.md` §1, 002-shops-crud): `BeatPlan` doesn't
 * exist yet (that's the `007-beat-plans` slice), so there is nothing to
 * filter by. Tapping it explains why instead of silently doing nothing.
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
  beatPlanName: null;
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

type QuickFilter = 'ALL' | 'NO_PIN' | 'INACTIVE';

const ICON_SEARCH: IconShape[] = [
  { circle: [11, 11, 7] },
  { d: 'M20 20l-4-4' },
];
const ICON_CHEVRON_DOWN: IconShape[] = [{ d: 'M6 9l6 6 6-6' }];
const ICON_PLUS: IconShape[] = [{ d: 'M12 5v14M5 12h14' }];

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
  const insets = useSafeAreaInsets();

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState<QuickFilter>('ALL');

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
  }, [debouncedSearch, filter]);

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
            accessibilityHint="Available once beat plans are set up"
            onPress={() =>
              Alert.alert(
                'Beat plans',
                'Filtering by beat plan is available once beat plans are set up.',
              )
            }
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              height: 36,
              paddingHorizontal: 14,
              borderRadius: 999,
              borderWidth: 1.5,
              borderColor: '#CBD2DD',
              backgroundColor: '#FFFFFF',
              opacity: 0.5,
            }}
            testID="shops-list-beat-filter"
          >
            <Text style={{ fontSize: 13, fontWeight: '600', color: INK }}>
              All beats
            </Text>
            <OutlineIcon
              color={INK}
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
            paddingBottom: 84 + insets.bottom + 90,
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
            return (
              <Pressable
                onPress={() => navigation.navigate('ShopForm', { shop: item })}
                style={{
                  backgroundColor: '#FFFFFF',
                  borderWidth: 1,
                  borderColor: BORDER,
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
                <Text numberOfLines={1} style={{ fontSize: 13, color: LABEL }}>
                  {addressLine(item)}
                </Text>
                <Text style={{ fontSize: 12, color: MUTED }}>
                  <Text style={{ fontFamily: 'monospace' }}>
                    {item.shopCode}
                  </Text>
                  {' · Unassigned · '}
                  {item.ownerName ?? '—'}
                </Text>
              </Pressable>
            );
          }}
        />
      )}

      <Pressable
        onPress={() => navigation.navigate('ShopForm', { shop: undefined })}
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
        testID="shops-list-new-shop"
      >
        <OutlineIcon
          color="#FFFFFF"
          shapes={ICON_PLUS}
          size={20}
          strokeWidth={2.2}
        />
        <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>
          New shop
        </Text>
      </Pressable>

      <AdminBottomNav
        active="Shops"
        bottomInset={insets.bottom}
        onHomePress={() => navigation.navigate('Home')}
        onShopsPress={() => {}}
      />
    </View>
  );
}
