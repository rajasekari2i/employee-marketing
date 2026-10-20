import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { apiRequest } from '../../api/client';
import { ManagerBottomNav } from '../../components/ManagerBottomNav';
import type { ManagerStackParamList } from '../../navigation/RootNavigator';
import {
  BADGE_NO_ORDER_BG,
  BADGE_NO_ORDER_FG,
  BADGE_ORDER_BG,
  BADGE_ORDER_FG,
  BG,
  BLUE,
  BORDER,
  CHIP_DELIVERED_BG,
  CHIP_DELIVERED_FG,
  CHIP_NO_ORDER_BG,
  CHIP_NO_ORDER_FG,
  CHIP_TO_DELIVER_BG,
  CHIP_TO_DELIVER_FG,
  INK,
  LABEL,
  MUTED,
  OUT_OF_RANGE_INK,
  ROW_SEPARATOR,
} from './managerDesign';
import { describeFailure, isOffline, LoadNotice } from './loadState';

/**
 * PRD §4 screen 3.3 ("Visits · list + filters"), board uuid
 * `d71d2e67-7b3b-479c-b242-96da6f4965de` (010-manager-app).
 *
 * **Which detail screen a row opens is decided by the TAB, not the visit.**
 * From the Out of range tab every row opens the read-only range screen,
 * whatever its outcome; from Order or No order it opens that outcome's
 * screen — so the same out-of-range order shows board 3.6 from one tab and
 * board 3.4, with Mark as delivered, from the other (FR-029).
 *
 * That is board 3.3's own rule, read off its script:
 *
 *     cur === 'out' ? 'VisitReview' : v.kind === 'order' ? 'OrderDetail' : 'NoOrderDetail'
 */

type Tab = 'all' | 'order' | 'noorder' | 'out';

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'order', label: 'Order' },
  { id: 'noorder', label: 'No order' },
  { id: 'out', label: 'Out of range' },
];

interface VisitRow {
  id: string;
  businessDate: string;
  outcome: 'ORDER' | 'NO_ORDER';
  shopName: string;
  executiveName: string;
  occurredAt: string;
  summary: string;
  deliveryStatus: 'TO_DELIVER' | 'DELIVERED' | null;
  distanceMeters: number;
  isExceedRange: boolean;
}

interface PageResponse {
  items: VisitRow[];
  counts?: { all: number; order: number; noOrder: number; outOfRange: number };
  nextCursor: string | null;
}

export function ManagerVisitsScreen() {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<
      NativeStackNavigationProp<ManagerStackParamList, 'ManagerVisits'>
    >();
  const route = useRoute<RouteProp<ManagerStackParamList, 'ManagerVisits'>>();

  const [tab, setTab] = useState<Tab>(
    route.params?.outOfRange
      ? 'out'
      : route.params?.outcome === 'ORDER'
        ? 'order'
        : route.params?.outcome === 'NO_ORDER'
          ? 'noorder'
          : 'all',
  );
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [counts, setCounts] = useState<PageResponse['counts'] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleNote, setStaleNote] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  /** One fast scroll can fire `onEndReached` twice; this stops a page being appended twice. */
  const inFlight = useRef(false);
  const requestSeq = useRef(0);

  /**
   * Read in the catch to tell "a refresh failed over rows already on
   * screen" from "the first load failed". A ref, not the state, because
   * `fetchPage` is memoised on `tab` — the state it closes over is the one
   * from the render that created it, which is always the empty first page.
   */
  const loadedCount = useRef(0);

  const fetchPage = useCallback(
    async (cursor: string | null, mode: 'first' | 'refresh' | 'more') => {
      if (inFlight.current) return;
      inFlight.current = true;
      const seq = (requestSeq.current += 1);

      const params = new URLSearchParams({ limit: '10' });
      if (tab === 'order') params.set('outcome', 'ORDER');
      if (tab === 'noorder') params.set('outcome', 'NO_ORDER');
      if (tab === 'out') params.set('outOfRange', 'true');
      if (cursor) params.set('cursor', cursor);

      if (mode === 'more') {
        setLoadingMore(true);
        setPageError(null);
      } else if (mode === 'first') {
        setLoading(true);
        setError(null);
      }

      try {
        const page = await apiRequest<PageResponse>(
          `/visits?${params.toString()}`,
        );
        if (seq !== requestSeq.current) return;
        setNextCursor(page.nextCursor);
        setError(null);
        setStaleNote(null);
        if (page.counts) setCounts(page.counts);
        if (mode === 'more') {
          // Append, never rebuild — rebuilding makes the rows the manager is
          // reading jump (FR-018).
          setVisits((current) => {
            const next = [...current, ...page.items];
            loadedCount.current = next.length;
            return next;
          });
        } else {
          loadedCount.current = page.items.length;
          setVisits(page.items);
        }
      } catch (err) {
        if (seq !== requestSeq.current) return;
        if (mode === 'more') {
          // FR-018: keep every page already appended and offer the retry.
          setPageError(
            isOffline(err)
              ? 'Could not load more. Tap to retry.'
              : err instanceof Error
                ? err.message
                : 'Something went wrong.',
          );
        } else {
          const failure = describeFailure(
            err,
            'the visits',
            loadedCount.current > 0,
          );
          setStaleNote(failure.staleNote);
          setError(failure.error);
        }
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        }
        inFlight.current = false;
      }
    },
    [tab],
  );

  // Changing the tab restarts from the newest matching visit (FR-020).
  useEffect(() => {
    setVisits([]);
    setNextCursor(null);
    setPageError(null);
    void fetchPage(null, 'first');
  }, [fetchPage]);

  const tabLabel = (id: Tab): string => {
    if (!counts) return TABS.find((t) => t.id === id)!.label;
    const n =
      id === 'all'
        ? counts.all
        : id === 'order'
          ? counts.order
          : id === 'noorder'
            ? counts.noOrder
            : counts.outOfRange;
    return `${TABS.find((t) => t.id === id)!.label} · ${n}`;
  };

  /** FR-029 — the tab decides, not the visit. */
  function openVisit(visit: VisitRow): void {
    if (tab === 'out') {
      navigation.navigate('OutOfRangeVisit', { visitId: visit.id });
      return;
    }
    if (visit.outcome === 'ORDER') {
      navigation.navigate('OrderVisit', { visitId: visit.id });
      return;
    }
    navigation.navigate('NoOrderVisit', { visitId: visit.id });
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
            Visit history · all executives
          </Text>
          <Text style={{ fontSize: 28, fontWeight: '700', color: INK }}>
            Visits
          </Text>
        </View>

        <View
          style={{
            flexDirection: 'row',
            gap: 4,
            padding: 4,
            borderRadius: 12,
            backgroundColor: '#E6EAF1',
          }}
        >
          {TABS.map((t) => (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === t.id }}
              key={t.id}
              onPress={() => setTab(t.id)}
              style={{
                flex: 1,
                height: 38,
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: tab === t.id ? '#FFFFFF' : 'transparent',
              }}
            >
              <Text
                numberOfLines={1}
                style={{
                  fontSize: 13,
                  fontWeight: '700',
                  color: tab === t.id ? INK : MUTED,
                }}
              >
                {tabLabel(t.id)}
              </Text>
            </Pressable>
          ))}
        </View>

        <LoadNotice staleNote={staleNote} />
      </View>

      <FlatList
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: 84 + insets.bottom + 16,
        }}
        data={visits}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          loading ? (
            <View style={{ paddingVertical: 48, alignItems: 'center' }}>
              <ActivityIndicator color={BLUE} />
            </View>
          ) : (
            <Text
              style={{
                fontSize: 14,
                lineHeight: 21,
                color: LABEL,
                paddingVertical: 48,
                textAlign: 'center',
              }}
            >
              {error ?? 'No visits match these filters.'}
            </Text>
          )
        }
        ListFooterComponent={
          pageError ? (
            <Pressable
              onPress={() => void fetchPage(nextCursor, 'more')}
              style={{ paddingVertical: 20 }}
            >
              <Text style={{ fontSize: 13, color: BLUE, textAlign: 'center' }}>
                {pageError}
              </Text>
            </Pressable>
          ) : loadingMore ? (
            <View style={{ paddingVertical: 20 }}>
              <ActivityIndicator color={BLUE} />
            </View>
          ) : !nextCursor && visits.length > 0 ? (
            <Text
              style={{
                fontSize: 12,
                color: MUTED,
                textAlign: 'center',
                paddingVertical: 20,
              }}
            >
              That is everything.
            </Text>
          ) : (
            <View />
          )
        }
        onEndReached={() => {
          if (nextCursor && !inFlight.current && !pageError) {
            void fetchPage(nextCursor, 'more');
          }
        }}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            onRefresh={() => {
              setRefreshing(true);
              void fetchPage(null, 'refresh');
            }}
            refreshing={refreshing}
          />
        }
        renderItem={({ item, index }) => (
          <VisitRowView
            first={index === 0}
            last={index === visits.length - 1}
            onPress={() => openVisit(item)}
            visit={item}
          />
        )}
      />

      <ManagerBottomNav
        active="Visits"
        bottomInset={insets.bottom}
        onAttendancePress={() => navigation.navigate('AttendanceDay')}
        onReportsPress={() => navigation.navigate('PreviousDayReport')}
        onVisitsPress={() => undefined}
      />
    </View>
  );
}

function VisitRowView({
  visit,
  first,
  last,
  onPress,
}: {
  visit: VisitRow;
  first: boolean;
  last: boolean;
  onPress: () => void;
}) {
  const isOrder = visit.outcome === 'ORDER';
  const badge = isOrder
    ? { bg: BADGE_ORDER_BG, fg: BADGE_ORDER_FG, text: 'ORD' }
    : { bg: BADGE_NO_ORDER_BG, fg: BADGE_NO_ORDER_FG, text: 'NO' };
  const chip = !isOrder
    ? { bg: CHIP_NO_ORDER_BG, fg: CHIP_NO_ORDER_FG, text: 'No order' }
    : visit.deliveryStatus === 'DELIVERED'
      ? { bg: CHIP_DELIVERED_BG, fg: CHIP_DELIVERED_FG, text: 'Delivered' }
      : { bg: CHIP_TO_DELIVER_BG, fg: CHIP_TO_DELIVER_FG, text: 'To deliver' };

  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        gap: 12,
        alignItems: 'center',
        paddingVertical: 11,
        paddingHorizontal: 14,
        backgroundColor: '#FFFFFF',
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderColor: BORDER,
        borderTopWidth: first ? 1 : 0,
        borderBottomWidth: 1,
        borderBottomColor: last ? BORDER : ROW_SEPARATOR,
        ...(first ? { borderTopLeftRadius: 16, borderTopRightRadius: 16 } : {}),
        ...(last
          ? { borderBottomLeftRadius: 16, borderBottomRightRadius: 16 }
          : {}),
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          flexShrink: 0,
          borderRadius: 11,
          backgroundColor: badge.bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 11, fontWeight: '800', color: badge.fg }}>
          {badge.text}
        </Text>
      </View>

      <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 2 }}>
        <Text
          numberOfLines={1}
          style={{ fontSize: 15, fontWeight: '700', color: INK }}
        >
          {visit.shopName}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 12, color: MUTED }}>
          {visit.executiveName} · {formatClock(visit.occurredAt)}
        </Text>
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <View
            style={{
              height: 22,
              paddingHorizontal: 8,
              borderRadius: 999,
              backgroundColor: chip.bg,
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 11, fontWeight: '700', color: chip.fg }}>
              {chip.text}
            </Text>
          </View>
          <Text
            numberOfLines={1}
            style={{ fontSize: 12, color: LABEL, flexShrink: 1 }}
          >
            {visit.summary}
          </Text>
        </View>
      </View>

      {/* The measurement — the thing an executive is never shown (FR-046). */}
      <Text
        style={{
          fontFamily: 'monospace',
          fontSize: 12,
          fontWeight: visit.isExceedRange ? '700' : '500',
          color: visit.isExceedRange ? OUT_OF_RANGE_INK : MUTED,
          flexShrink: 0,
        }}
      >
        {visit.distanceMeters} m{visit.isExceedRange ? ' · out' : ''}
      </Text>
    </Pressable>
  );
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
