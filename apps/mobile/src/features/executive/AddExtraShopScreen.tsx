import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, apiRequest } from '../../api/client';
import {
  OutlineIcon,
  type IconShape,
} from '../../components/icons/OutlineIcon';
import { getCurrentPosition } from '../../lib/location';
import { enqueue, sync } from '../../lib/outbox';
import type { ExecutiveStackParamList } from '../../navigation/RootNavigator';
import { DashedAction } from './DashedAction';
import {
  BANNER_INK,
  BG,
  BLUE,
  BORDER,
  CHIP_PENDING_BG,
  CHIP_PENDING_FG,
  CHIP_PIN_MISSING_BG,
  CHIP_PIN_MISSING_FG,
  CHIP_PIN_OK_BG,
  CHIP_PIN_OK_FG,
  CHIP_VIOLET_BG,
  FIELD_BORDER,
  INK,
  LABEL,
  MUTED,
  PRIMARY_BUTTON_HEIGHT,
  RADIO_RING,
  RUNNING_BG,
  formatHeaderDate,
} from './executiveDesign';

/**
 * PRD §4 screen 1.4 ("Add extra shop"), board uuid
 * `eccc1168-1e66-4039-92fc-0d14dd936744` (007-extra-shops).
 *
 * **Zero agreed divergences from the board.** Unlike slice 006, nothing here
 * is deliberately removed, so any visible difference from the design is a
 * defect (FR-025).
 *
 * Two things this screen must keep straight:
 *
 *  1. **The distance shown here is not a visit's measured distance.** It is
 *     measured from where the executive is *now*, to a shop that is **not**
 *     on today's route, rounded for display by the server, and it decides
 *     nothing. The rule that an executive never sees a visit's measured
 *     distance, its range verdict or any quality flag is untouched (FR-021).
 *     The device never computes it — `distanceLabel` arrives as a string.
 *  2. **Choosing needs a connection; adding does not.** The picker is a read
 *     and reads are never queued, so with no connection the screen says so
 *     plainly rather than showing an empty list (FR-024). The add goes
 *     through the outbox and is never reported as a failure (FR-023).
 */

const ICON_BACK: IconShape[] = [{ d: 'M15 18l-6-6 6-6' }];
const ICON_SEARCH: IconShape[] = [
  { circle: [11, 11, 7] },
  { d: 'M20 20l-4-4' },
];
const ICON_INFO: IconShape[] = [
  { circle: [12, 12, 9] },
  { d: 'M12 11v5M12 8h.01' },
];

interface ShopChoice {
  id: string;
  name: string;
  addressLine: string | null;
  pinStatus: 'NONE' | 'PENDING_VERIFICATION' | 'APPROVED';
  beatPlanName: string | null;
  distanceMeters: number | null;
  distanceLabel: string | null;
}

interface AddExtraStopResult {
  stopId: string;
  shopId: string;
  shopName: string;
  pinStatus: 'NONE' | 'PENDING_VERIFICATION' | 'APPROVED';
  totalStopsToday: number;
}

/** How long to wait after the last keystroke before asking the server. */
const SEARCH_DEBOUNCE_MS = 300;

export function AddExtraShopScreen() {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<
      NativeStackNavigationProp<ExecutiveStackParamList, 'AddExtraShop'>
    >();
  const route = useRoute<RouteProp<ExecutiveStackParamList, 'AddExtraShop'>>();
  const { assignmentId, beatPlanName, totalStopsToday } = route.params;

  const [position, setPosition] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [items, setItems] = useState<ShopChoice[]>([]);
  const [positionUsed, setPositionUsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * The position is requested on mount but the screen **renders
   * immediately** — a cold GPS fix can take seconds, and the search box and
   * the list are useful before it lands. Distances simply fill in when it
   * arrives, which also makes the no-fix path a degradation rather than a
   * special case (research.md §8).
   */
  useEffect(() => {
    let cancelled = false;
    void getCurrentPosition().then((fix) => {
      if (!cancelled && fix.ok) {
        setPosition({
          latitude: fix.position.latitude,
          longitude: fix.position.longitude,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedSearch(search.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [search]);

  /** Guards against an older response overwriting a newer one. */
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = (requestSeq.current += 1);
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ excludeAssignment: assignmentId });
    if (position) {
      params.set('lat', String(position.latitude));
      params.set('lng', String(position.longitude));
    }
    if (debouncedSearch) {
      params.set('search', debouncedSearch);
    }

    try {
      const result = await apiRequest<{
        items: ShopChoice[];
        positionUsed: boolean;
      }>(`/shops/nearby?${params.toString()}`);
      if (seq !== requestSeq.current) {
        return;
      }
      setItems(result.items);
      setPositionUsed(result.positionUsed);
      setOffline(false);
      // A shop that has just been added by a manager, or by this executive
      // on another device, stops being offered — so a stale selection must
      // not survive the refresh.
      setSelectedId((current) =>
        current && result.items.some((item) => item.id === current)
          ? current
          : null,
      );
    } catch (err) {
      if (seq !== requestSeq.current) {
        return;
      }
      // FR-024: the picker is a read and is never queued, so with no
      // connection the executive is told that plainly — NOT shown an empty
      // list they would read as "there is nothing to add".
      if (err instanceof ApiError && err.code === 'NETWORK_ERROR') {
        setOffline(true);
        setItems([]);
      } else {
        setError(
          err instanceof Error
            ? err.message
            : 'Could not load shops. Try again.',
        );
      }
    } finally {
      if (seq === requestSeq.current) {
        setLoading(false);
      }
    }
  }, [assignmentId, debouncedSearch, position]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = items.find((item) => item.id === selectedId) ?? null;

  async function add(): Promise<void> {
    if (!selected || adding) {
      return;
    }
    setAdding(true);
    setError(null);
    const body = { shopId: selected.id };

    // Held FIRST, then sent — the key is minted here and reused for the life
    // of the item, so a retry after a lost response adds the shop exactly
    // once rather than twice (FR-023, research.md §9).
    const held = await enqueue(
      'STOP',
      `/assignments/${assignmentId}/stops`,
      body,
    );

    try {
      await apiRequest<AddExtraStopResult>(
        `/assignments/${assignmentId}/stops`,
        { method: 'POST', body, idempotencyKey: held.idempotencyKey },
      );
      await sync();
      navigation.goBack();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NETWORK_ERROR') {
        // Not a failure. The add is on the phone, survives a restart, and
        // syncs exactly once — the executive is told it is waiting, and the
        // stop is not openable until it lands (FR-023, SC-011).
        setNotice(
          `${selected.name} is saved on your phone and will be added to today's list when you are back online.`,
        );
        setAdding(false);
        navigation.goBack();
        return;
      }

      // The server refused in a way retrying cannot fix — drop the held copy
      // so it does not sit in the queue being retried forever, and say what
      // happened in plain language (FR-011).
      await sync();
      setError(
        err instanceof ApiError && err.code === 'SHOP_ALREADY_IN_BEAT'
          ? `${selected.name} is already on today's list.`
          : err instanceof Error
            ? err.message
            : 'Could not add the shop. Try again.',
      );
      setAdding(false);
      void load();
      return;
    }
    setAdding(false);
  }

  const showDistances = positionUsed;

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      {/* header — board: padding 52px 20px 12px, column, gap 14 */}
      <View
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 20,
          paddingBottom: 12,
          gap: 14,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable
            accessibilityLabel="Back to today"
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
              flexShrink: 0,
            }}
          >
            <OutlineIcon
              color={INK}
              shapes={ICON_BACK}
              size={20}
              strokeWidth={2}
            />
          </Pressable>
          <View style={{ flexShrink: 1 }}>
            <Text style={{ fontSize: 13, color: MUTED }}>
              {formatHeaderDate(new Date())}
              {beatPlanName ? ` · ${beatPlanName}` : ''}
            </Text>
            <Text style={{ fontSize: 24, fontWeight: '700', color: INK }}>
              Add extra shop
            </Text>
          </View>
        </View>

        <View
          style={{
            flexDirection: 'row',
            gap: 10,
            paddingVertical: 12,
            paddingHorizontal: 14,
            borderRadius: 14,
            backgroundColor: CHIP_VIOLET_BG,
          }}
        >
          <View style={{ flexShrink: 0, paddingTop: 1 }}>
            <OutlineIcon
              color={BANNER_INK}
              shapes={ICON_INFO}
              size={20}
              strokeWidth={1.8}
            />
          </View>
          <Text
            style={{
              fontSize: 13,
              lineHeight: 19.5,
              color: BANNER_INK,
              flexShrink: 1,
            }}
          >
            The shop is added to{' '}
            <Text style={{ fontWeight: '700' }}>today&rsquo;s list only</Text>.
            Your beat plan stays as it is, and your manager sees it as an extra
            visit.
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
            borderColor: FIELD_BORDER,
          }}
        >
          <OutlineIcon
            color={MUTED}
            shapes={ICON_SEARCH}
            size={18}
            strokeWidth={1.8}
          />
          <TextInput
            accessibilityLabel="Search shops"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setSearch}
            placeholder="Search shop name or owner"
            placeholderTextColor={MUTED}
            style={{
              flexGrow: 1,
              fontSize: 15,
              fontWeight: '500',
              color: INK,
              padding: 0,
            }}
            value={search}
          />
        </View>
      </View>

      {/* main — board: padding 0 20px, column, gap 8 */}
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: 16,
          gap: 8,
        }}
        style={{ flexGrow: 1 }}
      >
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'baseline',
          }}
        >
          <Text
            style={{
              fontSize: 12,
              fontWeight: '700',
              letterSpacing: 0.72,
              textTransform: 'uppercase',
              color: MUTED,
            }}
          >
            {debouncedSearch ? 'Matches' : 'Nearby'} · not in today&rsquo;s list
          </Text>
          {showDistances && !debouncedSearch ? (
            <Text style={{ fontSize: 12, color: MUTED }}>Closest first</Text>
          ) : null}
        </View>

        {notice ? (
          <Text style={{ fontSize: 13, color: LABEL }}>{notice}</Text>
        ) : null}
        {error ? (
          <Text style={{ fontSize: 13, color: '#A3261B' }}>{error}</Text>
        ) : null}

        {loading && items.length === 0 ? (
          <View style={{ paddingVertical: 32, alignItems: 'center' }}>
            <ActivityIndicator color={BLUE} />
          </View>
        ) : null}

        {/* FR-007 / FR-024: never a blank panel — each empty case says which
            one it is, and the create-new action stays offered. */}
        {!loading && offline ? (
          <Text style={{ fontSize: 13, lineHeight: 19, color: LABEL }}>
            No connection, so the list of shops you can add cannot be loaded.
            Try again when you are back online.
          </Text>
        ) : null}

        {!loading && !offline && items.length === 0 ? (
          <Text style={{ fontSize: 13, lineHeight: 19, color: LABEL }}>
            {debouncedSearch
              ? `No shop matches “${debouncedSearch}”. Check the spelling, or create the shop below.`
              : "Every shop nearby is already on today's list. You can still create a new shop below."}
          </Text>
        ) : null}

        {items.length > 0 ? (
          <View
            accessibilityRole="radiogroup"
            style={{
              backgroundColor: '#FFFFFF',
              borderWidth: 1,
              borderColor: BORDER,
              borderRadius: 16,
              padding: 4,
            }}
          >
            {items.map((item) => (
              <ShopRow
                key={item.id}
                item={item}
                onPress={() => setSelectedId(item.id)}
                selected={item.id === selectedId}
                showDistance={showDistances}
              />
            ))}
          </View>
        ) : null}

        <DashedAction
          label="Shop not listed — create new"
          onPress={() =>
            navigation.navigate('CreateShopFromField', {
              assignmentId,
              beatPlanName,
            })
          }
        />
      </ScrollView>

      {/* footer — board: padding 12px 20px 30px, white, 1px top border, gap 10 */}
      <View
        style={{
          paddingTop: 12,
          paddingHorizontal: 20,
          paddingBottom: Math.max(insets.bottom, 30),
          backgroundColor: '#FFFFFF',
          borderTopWidth: 1,
          borderTopColor: BORDER,
          gap: 10,
        }}
      >
        {selected ? (
          <Text style={{ fontSize: 13, color: LABEL }}>
            Adding <Text style={{ fontWeight: '700' }}>{selected.name}</Text> as
            stop {totalStopsToday + 1} today.
          </Text>
        ) : (
          <Text style={{ fontSize: 13, color: MUTED }}>
            Choose a shop to continue.
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          disabled={!selected || adding}
          onPress={() => void add()}
          style={{
            height: PRIMARY_BUTTON_HEIGHT,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: selected ? BLUE : FIELD_BORDER,
          }}
        >
          {adding ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text
              style={{
                fontSize: 16,
                fontWeight: '700',
                color: selected ? '#FFFFFF' : MUTED,
              }}
            >
              Add to today&rsquo;s list
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

/**
 * One `.opt` row: 22 px radio, name 15/700, address 12 px ellipsised, two
 * chips, distance right-aligned in the mono face.
 */
function ShopRow({
  item,
  selected,
  showDistance,
  onPress,
}: {
  item: ShopChoice;
  selected: boolean;
  showDistance: boolean;
  onPress: () => void;
}) {
  const pinned = item.pinStatus === 'APPROVED';
  const pinChip = pinned
    ? { bg: CHIP_PIN_OK_BG, fg: CHIP_PIN_OK_FG, label: 'Pin saved' }
    : {
        bg: CHIP_PIN_MISSING_BG,
        fg: CHIP_PIN_MISSING_FG,
        label:
          item.pinStatus === 'PENDING_VERIFICATION'
            ? 'Pin awaiting approval'
            : 'No pin — capture on arrival',
      };

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        gap: 12,
        alignItems: 'center',
        width: '100%',
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: 14,
        backgroundColor: selected ? RUNNING_BG : '#FFFFFF',
        borderWidth: 2,
        borderColor: selected ? BLUE : 'transparent',
      }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          flexShrink: 0,
          borderRadius: 11,
          borderWidth: 2,
          borderColor: selected ? BLUE : RADIO_RING,
          backgroundColor: selected ? BLUE : '#FFFFFF',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: '#FFFFFF',
          }}
        />
      </View>

      <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 3 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: INK }}>
          {item.name}
        </Text>
        {item.addressLine ? (
          <Text numberOfLines={1} style={{ fontSize: 12, color: MUTED }}>
            {item.addressLine}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <Chip bg={pinChip.bg} fg={pinChip.fg} label={pinChip.label} />
          <Chip
            bg={CHIP_PENDING_BG}
            fg={CHIP_PENDING_FG}
            label={item.beatPlanName ?? 'No beat'}
          />
        </View>
      </View>

      {showDistance && item.distanceLabel ? (
        <Text
          style={{
            fontFamily: 'monospace',
            fontSize: 12,
            fontWeight: '700',
            color: MUTED,
            flexShrink: 0,
          }}
        >
          {item.distanceLabel}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** `.chip`: 22 px tall, 8 px side padding, fully rounded, 11/700. */
function Chip({ bg, fg, label }: { bg: string; fg: string; label: string }) {
  return (
    <View
      style={{
        height: 22,
        paddingHorizontal: 8,
        borderRadius: 999,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: '700', color: fg }}>
        {label}
      </Text>
    </View>
  );
}
