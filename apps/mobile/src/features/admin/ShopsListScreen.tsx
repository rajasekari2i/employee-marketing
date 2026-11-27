import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { launchCamera } from 'react-native-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { apiRequest, generateIdempotencyKey } from '../../api/client';
import { AdminBottomNav } from '../../components/AdminBottomNav';
import {
  OutlineIcon,
  type IconShape,
} from '../../components/icons/OutlineIcon';
import {
  cameraPermissionMessage,
  ensureCameraPermission,
} from '../../lib/permissions';
import type { AdminStackParamList } from '../../navigation/RootNavigator';
import { BG, BLUE, BORDER, INK, LABEL, MUTED } from './adminDesign';
import { ShopPhotoPill, ShopPhotosSheet } from './ShopPhotosSheet';

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
  /**
   * `url` is the `?thumb=1` variant (card + 64px strip); `fullUrl` the
   * original, for the photo sheet's pager and the full-screen viewer.
   * `createdAt` backs the viewer's "Added <date>" caption.
   */
  photos: Array<{
    id: string;
    url: string;
    fullUrl: string;
    createdAt: string;
  }>;
}

interface ShopsListResponse {
  items: ShopSummaryForEdit[];
  /** `null` when this was the last page — what stops the infinite scroll asking again. */
  nextCursor: string | null;
  /** Server-counted, matching the current filters — not `items.length`. */
  total: number;
  /** Server-counted, company-wide and filter-independent (labels the "No pin" chip). */
  noPinTotal: number;
}

/** Shops per request — the design's page size, and the API's own default. */
const PAGE_SIZE = 20;

/** FR-007, mirrored from the API's own `MAX_SHOP_PHOTOS` — hides the sheet's add tile at the cap. */
const MAX_SHOP_PHOTOS = 3;

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
  /** Cursor for the NEXT page; `null` means there is no next page. */
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  /** True only while an append is in flight — drives the footer spinner, and stops `onEndReached` stacking requests. */
  const [loadingMore, setLoadingMore] = useState(false);

  // Server-counted (`total`/`noPinTotal` on the list response). These used
  // to be the length of a separate `?limit=100` fetch, which silently
  // capped both numbers at 100 however many shops the company really had.
  const [total, setTotal] = useState(0);
  const [noPinCount, setNoPinCount] = useState(0);

  /**
   * Bumped by every filter/search change and every fresh `load()`. An
   * in-flight append compares the generation it started under against this
   * before committing, so a page that arrives after the admin has already
   * retyped the search is DISCARDED rather than appended to a list it does
   * not belong to.
   */
  const requestGeneration = useRef(0);

  /**
   * The shop whose photos the sheet is showing — the id, not the row, so
   * the sheet always reads the CURRENT row out of `items`. Holding the row
   * itself would leave the sheet showing a stale photo list the moment an
   * upload refreshed the page underneath it.
   */
  const [photoSheetShopId, setPhotoSheetShopId] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoSheetShop =
    items.find((shop) => shop.id === photoSheetShopId) ?? null;

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

  /**
   * The query string for the current search/filter selection, WITHOUT a
   * cursor. Both `load` (first page) and `loadMore` (every page after)
   * build on this, so the two can never disagree about what is being
   * listed — the bug that makes an appended page belong to a different
   * filter than the rows above it.
   */
  const buildQuery = useCallback(
    (cursor: string | null): string => {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
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
      if (cursor) {
        params.set('cursor', cursor);
      }
      return params.toString();
    },
    [debouncedSearch, filter, selectedBeatPlan],
  );

  /** First page: REPLACES the list. Every filter change and every screen focus comes through here. */
  const load = useCallback(async () => {
    const generation = (requestGeneration.current += 1);
    setLoading(true);
    try {
      const result = await apiRequest<ShopsListResponse>(
        `/shops?${buildQuery(null)}`,
      );
      if (generation !== requestGeneration.current) {
        return;
      }
      setItems(result.items);
      setNextCursor(result.nextCursor);
      setTotal(result.total);
      setNoPinCount(result.noPinTotal);
    } catch {
      // Leave the previous list visible on a transient failure — no
      // dedicated error banner on this screen in this slice.
    } finally {
      if (generation === requestGeneration.current) {
        setLoading(false);
      }
    }
  }, [buildQuery]);

  /**
   * Next page: APPENDS. Called by the list's `onEndReached`.
   *
   * Three guards, each for a failure this screen can actually hit:
   *  - `nextCursor === null` — there is no next page; `onEndReached` still
   *    fires on every small scroll at the bottom of a finished list.
   *  - `loadingMore` — `onEndReached` fires repeatedly while a fetch is in
   *    flight, which would otherwise request the same cursor several times
   *    and append the same rows twice.
   *  - `loading` — a first-page load is already replacing the list; an
   *    append landing on top of that would interleave two different pages.
   */
  const loadMore = useCallback(async () => {
    if (nextCursor === null || loadingMore || loading) {
      return;
    }
    const generation = requestGeneration.current;
    setLoadingMore(true);
    try {
      const result = await apiRequest<ShopsListResponse>(
        `/shops?${buildQuery(nextCursor)}`,
      );
      // The filter changed while this page was in flight — these rows
      // belong to a list that is no longer on screen.
      if (generation !== requestGeneration.current) {
        return;
      }
      setItems((prev) => {
        // Belt-and-braces against a duplicate id: a shop created between
        // two page fetches shifts the window, and `createdAt desc` means
        // it lands at the TOP, so the boundary row can repeat. A repeated
        // key is a hard render error in FlatList, not a cosmetic one.
        const seen = new Set(prev.map((shop) => shop.id));
        return [...prev, ...result.items.filter((shop) => !seen.has(shop.id))];
      });
      setNextCursor(result.nextCursor);
      setTotal(result.total);
      setNoPinCount(result.noPinTotal);
    } catch {
      // Keep what is already on screen and keep the cursor, so the next
      // scroll to the bottom retries this same page.
    } finally {
      setLoadingMore(false);
    }
  }, [buildQuery, loading, loadingMore, nextCursor]);

  /**
   * The only loader for the first page. `useFocusEffect` re-runs both when
   * the screen regains focus AND when `load`'s identity changes while it is
   * focused (i.e. the search or a filter changed), which covers everything
   * the separate mount-time `useEffect` here used to — that pair fired two
   * identical requests on every mount.
   *
   * Note this RESETS to page 1: returning from the shop form after
   * scrolling deep into the list puts the admin back at the top. That is
   * the price of guaranteeing an edited shop shows its new values; the
   * alternative (merging the refreshed first page into the existing list)
   * misses an edit to any shop past row 20.
   */
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /**
   * The card pill's two behaviours, from board "Shop card photo icon
   * states": a shop WITH photos opens the sheet; a shop with none goes
   * straight to the camera ("No photos · tap opens camera"), since opening
   * an empty sheet just to press its add tile is a wasted step.
   */
  function openPhotos(shop: ShopSummaryForEdit): void {
    if (shop.photos.length > 0) {
      setPhotoSheetShopId(shop.id);
      return;
    }
    void addPhoto(shop.id);
  }

  /**
   * Camera -> `POST /shops/:id/photos` -> reload, so the new photo is on
   * the card and in the sheet. Not queued through the outbox: that holds
   * field work an executive cannot redo (visits, pins, extra stops), while
   * this is a Company Admin at a desk who can simply retry.
   */
  async function addPhoto(shopId: string): Promise<void> {
    const permission = await ensureCameraPermission();
    if (permission !== 'GRANTED') {
      Alert.alert('Camera unavailable', cameraPermissionMessage(permission));
      return;
    }

    const result = await launchCamera({ mediaType: 'photo', quality: 0.8 });
    if (result.didCancel) {
      return;
    }
    // Surfaced, not swallowed — the same reasoning as `ShopFormScreen`'s
    // picker: dropping this is what makes a blocked camera look like a
    // dead button.
    if (result.errorCode) {
      Alert.alert(
        'Could not open the camera',
        result.errorMessage ?? 'Something went wrong. Please try again.',
      );
      return;
    }
    const asset = result.assets?.[0];
    if (!asset?.uri) {
      return;
    }

    setUploadingPhoto(true);
    try {
      const formData = new FormData();
      // SAFETY: the RN FormData file-descriptor shape — same as
      // `ShopFormScreen`'s upload; no RN-specific FormData types ship with
      // this project to express it more precisely.
      formData.append('photo', {
        uri: asset.uri,
        name: asset.fileName ?? 'photo.jpg',
        type: asset.type ?? 'image/jpeg',
      });
      await apiRequest(`/shops/${shopId}/photos`, {
        method: 'POST',
        body: formData,
        idempotencyKey: generateIdempotencyKey(),
      });
      await load();
      // Opening the sheet only AFTER a successful first upload is what
      // makes "tap the dashed pill" feel like one action rather than two.
      setPhotoSheetShopId(shopId);
    } catch {
      Alert.alert(
        'Could not add the photo',
        'Check your connection and try again.',
      );
    } finally {
      setUploadingPhoto(false);
    }
  }

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
            {total} shops · {noPinCount} without pin
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
          ListFooterComponent={
            loadingMore ? (
              <View style={{ paddingVertical: 20 }}>
                <ActivityIndicator testID="shops-list-loading-more" />
              </View>
            ) : undefined
          }
          onEndReached={() => void loadMore()}
          // Half a screen from the bottom: far enough that the next page is
          // usually already in hand by the time the admin gets there, close
          // enough not to fetch page 2 the moment page 1 renders.
          onEndReachedThreshold={0.5}
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
                {/*
                  Board "Shop list with photo icon": the meta line and the
                  photo pill share one row, meta taking the slack and the
                  pill pinned to the trailing edge.
                */}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Text
                    numberOfLines={1}
                    style={{ flex: 1, minWidth: 0, fontSize: 12, color: MUTED }}
                  >
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
                  {/*
                    Hidden while picking shops for a beat plan: in that mode
                    the whole card is a checkbox, and a control that does
                    something else inside it is a trap.
                  */}
                  {selectionMode ? null : (
                    <ShopPhotoPill
                      count={item.photos.length}
                      onPress={() => openPhotos(item)}
                      shopName={item.name}
                    />
                  )}
                </View>
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
          onVisitsPress={() => navigation.navigate('AdminVisits', {})}
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

      {photoSheetShop ? (
        <ShopPhotosSheet
          canAddPhoto={photoSheetShop.photos.length < MAX_SHOP_PHOTOS}
          onAddPhoto={() => void addPhoto(photoSheetShop.id)}
          onClose={() => setPhotoSheetShopId(null)}
          photos={photoSheetShop.photos}
          shopCode={photoSheetShop.shopCode}
          shopName={photoSheetShop.name}
          visible
        />
      ) : null}

      {/*
        A full-screen block while a photo uploads: the camera has just
        closed, the card has not changed yet, and without this the admin is
        looking at a list that appears to have ignored them.
      */}
      {uploadingPhoto ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: 'rgba(11, 11, 15, 0.35)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          testID="shops-list-photo-uploading"
        >
          <ActivityIndicator color="#FFFFFF" size="large" />
        </View>
      ) : null}
    </View>
  );
}
