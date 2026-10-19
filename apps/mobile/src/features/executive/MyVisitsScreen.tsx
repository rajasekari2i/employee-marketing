import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, apiRequest } from '../../api/client';
import { ExecutiveBottomNav } from '../../components/ExecutiveBottomNav';
import {
  OutlineIcon,
  type IconShape,
} from '../../components/icons/OutlineIcon';
import { subscribeOutbox, type HeldSubmission } from '../../lib/outbox';
import type { ExecutiveStackParamList } from '../../navigation/RootNavigator';
import {
  buildListEntries,
  type DaySummary,
  type ListEntry,
  type VisitRow,
} from './groupVisitsByDay';
import {
  BG,
  BLUE,
  BORDER,
  CHIP_PENDING_BG,
  CHIP_PENDING_FG,
  CHIP_PIN_OK_BG,
  CHIP_PIN_OK_FG,
  DATE_BUTTON_HEIGHT,
  FIELD_BORDER,
  INK,
  LABEL,
  MUTED,
  ROW_SEPARATOR,
  RUNNING_BG,
  RUNNING_BORDER,
  RUNNING_INK,
  SEGMENT_HEIGHT,
  TAB_TRACK,
  VISIT_BADGE_SIZE,
} from './executiveDesign';

/**
 * PRD §4 screen 1.5 ("My visits"), board uuid
 * `94506a6c-c909-40f9-b3d2-e0cca7bad3f5` (008-my-visits).
 *
 * **One agreed divergence from the board, and only one**: the waiting-to-sync
 * strip below the tabs, which is absent whenever the outbox is empty — so in
 * the ordinary case this screen is indistinguishable from board 1.5 and any
 * other difference is a defect (FR-027).
 *
 * Three things this screen must keep straight:
 *
 *  1. **A day never splits across a page.** The server orders day-major, and
 *     `buildListEntries` emits a header only when the business date changes,
 *     so a day straddling the ten-row boundary produces one block once the
 *     next page lands (FR-011).
 *  2. **The counts are not page counts.** The tab counts are totals for the
 *     range in view, and each day's summary is that day's *unfiltered*
 *     totals — board 1.5 computes its heading from the day's full list even
 *     while the rows beneath are filtered. Neither can be tallied from what
 *     is on screen.
 *  3. **This is a read, so nothing here is queued.** Reads are never queued
 *     (`03-ARCHITECTURE.md:1016`); a failed fetch keeps what was loaded and
 *     says so. A visit still in the outbox is reported as waiting, never
 *     faked into a history row.
 */

const ICON_CALENDAR: IconShape[] = [
  { rect: [3, 5, 18, 16, 2] },
  { d: 'M3 10h18M8 3v4M16 3v4' },
];

type Tab = 'all' | 'order' | 'noorder';
type Range = 'ALL' | 'LAST_7_DAYS' | 'LAST_30_DAYS';

const RANGE_LABEL: Record<Range, string> = {
  ALL: 'All time',
  LAST_7_DAYS: 'Last 7 days',
  LAST_30_DAYS: 'Last 30 days',
};

const TAB_OUTCOME: Record<Tab, 'ORDER' | 'NO_ORDER' | undefined> = {
  all: undefined,
  order: 'ORDER',
  noorder: 'NO_ORDER',
};

interface PageResponse {
  items: VisitRow[];
  days: DaySummary[];
  counts?: { all: number; order: number; noOrder: number };
  todayBusinessDate: string;
  nextCursor: string | null;
}

export function MyVisitsScreen() {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<
      NativeStackNavigationProp<ExecutiveStackParamList, 'MyVisits'>
    >();

  const [tab, setTab] = useState<Tab>('all');
  const [range, setRange] = useState<Range>('ALL');
  const [rangeOpen, setRangeOpen] = useState(false);

  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [days, setDays] = useState<DaySummary[]>([]);
  const [counts, setCounts] = useState<{
    all: number;
    order: number;
    noOrder: number;
  } | null>(null);
  const [today, setToday] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [staleNote, setStaleNote] = useState<string | null>(null);
  const [firstLoadError, setFirstLoadError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [held, setHeld] = useState<HeldSubmission[]>([]);

  useEffect(() => subscribeOutbox(setHeld), []);

  /**
   * Guards against two fetches in flight at once.
   *
   * LOAD-BEARING, not tidiness: `onEndReached` can fire twice on one fast
   * scroll, and without this the same page would be appended twice — a
   * duplicate FR-012 forbids. A ref rather than state because the guard has
   * to be read and set synchronously inside the handler.
   */
  const inFlight = useRef(false);
  /** Discards a response that arrived after the tab or range changed. */
  const requestSeq = useRef(0);
  /**
   * Mirrors `visits` so the fetch can ask "is anything already on screen?"
   * without taking `visits` as a dependency — which would give `fetchPage` a
   * new identity on every page and re-run the effects that call it.
   */
  const visitsRef = useRef<VisitRow[]>([]);
  useEffect(() => {
    visitsRef.current = visits;
  }, [visits]);

  const fetchPage = useCallback(
    async (cursor: string | null, mode: 'first' | 'refresh' | 'more') => {
      if (inFlight.current) {
        return;
      }
      inFlight.current = true;
      const seq = (requestSeq.current += 1);

      const params = new URLSearchParams({ limit: '10', range });
      const outcome = TAB_OUTCOME[tab];
      if (outcome) {
        params.set('outcome', outcome);
      }
      if (cursor) {
        params.set('cursor', cursor);
      }

      if (mode === 'more') {
        setLoadingMore(true);
        setPageError(null);
      } else if (mode === 'first') {
        setLoading(true);
        setFirstLoadError(null);
      }

      try {
        const page = await apiRequest<PageResponse>(
          `/visits/mine?${params.toString()}`,
        );
        if (seq !== requestSeq.current) {
          return;
        }

        setToday(page.todayBusinessDate);
        setNextCursor(page.nextCursor);
        setStaleNote(null);
        setFirstLoadError(null);
        if (page.counts) {
          setCounts(page.counts);
        }

        if (mode === 'more') {
          // APPEND — never rebuild. Rebuilding would make the rows the
          // executive is reading jump (FR-010).
          setVisits((current) => [...current, ...page.items]);
          setDays((current) => mergeDays(current, page.days));
        } else {
          setVisits(page.items);
          setDays(page.days);
        }
      } catch (error) {
        if (seq !== requestSeq.current) {
          return;
        }
        const offline =
          error instanceof ApiError && error.code === 'NETWORK_ERROR';
        const message =
          error instanceof Error ? error.message : 'Something went wrong.';

        if (mode === 'more') {
          // FR-025: report it, keep everything already loaded, allow a retry.
          setPageError(
            offline
              ? 'Could not load more. Check your signal and tap to retry.'
              : message,
          );
        } else if (visitsRef.current.length > 0) {
          // FR-024: a failed refresh keeps what was loaded and says so,
          // rather than blanking a screen that was working a moment ago.
          setStaleNote(
            offline
              ? 'No connection. Showing the visits you last loaded.'
              : 'Could not refresh. Showing the visits you last loaded.',
          );
        } else {
          // Nothing loaded and nothing to fall back on — say there is no
          // connection, NOT "you have no visits", which is what an empty
          // list would read as.
          setFirstLoadError(
            offline
              ? 'No connection, so your visits could not be loaded. Try again when you are back online.'
              : message,
          );
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
    [range, tab],
  );

  // Changing the tab or the range restarts the list from that view's newest
  // visits — not resuming at the previous scroll depth (FR-016).
  useEffect(() => {
    setVisits([]);
    setDays([]);
    setNextCursor(null);
    setPageError(null);
    void fetchPage(null, 'first');
  }, [fetchPage]);

  useFocusEffect(
    useCallback(() => {
      // Returning to the screen picks up anything recorded since. On the
      // first mount this is a no-op — the effect above is already fetching
      // and `inFlight` drops the duplicate.
      void fetchPage(null, 'refresh');
    }, [fetchPage]),
  );

  const entries = buildListEntries(visits, days, today);
  const waiting = held.filter((item) => item.kind === 'VISIT').length;

  const tabLabel = (key: Tab): string => {
    if (!counts) {
      return key === 'all' ? 'All' : key === 'order' ? 'Order' : 'No order';
    }
    if (key === 'all') return `All · ${counts.all}`;
    if (key === 'order') return `Order · ${counts.order}`;
    return `No order · ${counts.noOrder}`;
  };

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      {/* header — board: padding 52px 20px 12px, column, gap 12 */}
      <View
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 20,
          paddingBottom: 12,
          gap: 12,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
          }}
        >
          <View style={{ gap: 2, flexShrink: 1 }}>
            <Text style={{ fontSize: 13, color: MUTED }}>
              Your visit history
            </Text>
            <Text style={{ fontSize: 28, fontWeight: '700', color: INK }}>
              My visits
            </Text>
          </View>
          <Pressable
            accessibilityLabel={`Date range: ${RANGE_LABEL[range]}`}
            accessibilityRole="button"
            onPress={() => setRangeOpen(true)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              height: DATE_BUTTON_HEIGHT,
              paddingHorizontal: 12,
              borderRadius: 10,
              borderWidth: 1.5,
              borderColor: FIELD_BORDER,
              backgroundColor: '#FFFFFF',
              flexShrink: 0,
            }}
          >
            <OutlineIcon
              color={INK}
              shapes={ICON_CALENDAR}
              size={16}
              strokeWidth={1.8}
            />
            <Text style={{ fontSize: 13, fontWeight: '600', color: INK }}>
              {RANGE_LABEL[range]}
            </Text>
          </Pressable>
        </View>

        {/* The three tabs. Board 1.5's `.seg` is 38 tall / 700 — NOT board
            1.3's `.tab`, which is 36 / 600, so `FilterTab` is not reused. */}
        <View
          style={{
            flexDirection: 'row',
            gap: 4,
            padding: 4,
            borderRadius: 12,
            backgroundColor: TAB_TRACK,
          }}
        >
          <Segment
            active={tab === 'all'}
            label={tabLabel('all')}
            onPress={() => setTab('all')}
          />
          <Segment
            active={tab === 'order'}
            label={tabLabel('order')}
            onPress={() => setTab('order')}
          />
          <Segment
            active={tab === 'noorder'}
            label={tabLabel('noorder')}
            onPress={() => setTab('noorder')}
          />
        </View>

        {/*
          The slice's ONE agreed divergence from board 1.5 (FR-026, FR-026a).
          A queued visit has no server id and is not in the server's history,
          so it cannot be paged and must not be faked into a row the
          executive could read as recorded. This only reports that something
          is waiting — and it is absent entirely when the queue is empty, so
          the ordinary screen matches the board exactly.
        */}
        {waiting > 0 ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 11,
              paddingHorizontal: 14,
              borderRadius: 14,
              backgroundColor: RUNNING_BG,
              borderWidth: 1,
              borderColor: RUNNING_BORDER,
            }}
          >
            <Text style={{ fontSize: 13, color: RUNNING_INK, flexShrink: 1 }}>
              {waiting} visit{waiting === 1 ? '' : 's'} waiting to sync.{' '}
              {waiting === 1 ? 'It is' : 'They are'} saved on your phone and
              will appear here once sent.
            </Text>
          </View>
        ) : null}

        {staleNote ? (
          <Text style={{ fontSize: 13, color: LABEL }}>{staleNote}</Text>
        ) : null}
      </View>

      {/* main — board: padding 0 20px, column, gap 8 */}
      <FlatList
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: 84 + insets.bottom + 16,
          // No `gap` here on purpose: the rows of one day must sit FLUSH so
          // they read as board 1.5's single card. The space between day
          // blocks comes from the heading's own top padding instead.
        }}
        data={entries}
        keyExtractor={(entry) => entry.key}
        ListEmptyComponent={
          loading ? (
            <View style={{ paddingVertical: 48, alignItems: 'center' }}>
              <ActivityIndicator color={BLUE} />
            </View>
          ) : (
            <EmptyState
              message={
                firstLoadError ??
                (tab === 'all'
                  ? 'You have not recorded any visits yet. They will appear here once you do.'
                  : tab === 'order'
                    ? 'No orders in this range.'
                    : 'No no-order visits in this range.')
              }
            />
          )
        }
        ListFooterComponent={
          <ListFooter
            error={pageError}
            hasMore={nextCursor !== null}
            isEmpty={entries.length === 0}
            loading={loadingMore}
            onRetry={() => void fetchPage(nextCursor, 'more')}
          />
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
        renderItem={({ item, index }) => {
          if (item.kind === 'day') {
            return <DayHeading entry={item} first={index === 0} />;
          }
          const previousEntry = entries[index - 1];
          const nextEntry = entries[index + 1];
          return (
            <VisitRowView
              first={previousEntry?.kind === 'day'}
              last={!nextEntry || nextEntry.kind === 'day'}
              visit={item.visit}
            />
          );
        }}
        style={{ flexGrow: 1 }}
      />

      <ExecutiveBottomNav
        active="MyVisits"
        bottomInset={insets.bottom}
        // 009-my-totals: board 1.6 is built, so this tab navigates too.
        onMyTotalsPress={() => navigation.navigate('MyTotals')}
        onMyVisitsPress={() => undefined}
        onTodayPress={() => navigation.navigate('TodaysBeat')}
      />

      <RangeSheet
        onClose={() => setRangeOpen(false)}
        onSelect={(next) => {
          setRangeOpen(false);
          if (next !== range) {
            setRange(next);
          }
        }}
        selected={range}
        visible={rangeOpen}
      />
    </View>
  );
}

/** Later pages may repeat a day already seen; the newer summary wins. */
function mergeDays(
  current: DaySummary[],
  incoming: DaySummary[],
): DaySummary[] {
  const merged = new Map(current.map((day) => [day.businessDate, day]));
  for (const day of incoming) {
    merged.set(day.businessDate, day);
  }
  return [...merged.values()];
}

/** `.seg` on board 1.5: flex 1, 38 tall, radius 10, weight 700, size 14. */
function Segment({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        flex: 1,
        height: SEGMENT_HEIGHT,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? '#FFFFFF' : 'transparent',
      }}
    >
      <Text
        numberOfLines={1}
        style={{ fontSize: 14, fontWeight: '700', color: active ? INK : MUTED }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** The day heading and its summary — `4px 2px 0` padding, space-between. */
function DayHeading({
  entry,
  first,
}: {
  entry: Extract<ListEntry, { kind: 'day' }>;
  first: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        paddingTop: first ? 4 : 10,
        paddingHorizontal: 2,
      }}
    >
      <Text
        style={{
          fontSize: 12,
          fontWeight: '700',
          letterSpacing: 0.72,
          textTransform: 'uppercase',
          color: MUTED,
          flexShrink: 1,
        }}
      >
        {entry.label}
      </Text>
      <Text style={{ fontSize: 12, color: MUTED }}>{entry.summary}</Text>
    </View>
  );
}

/**
 * One visit row inside the day card.
 *
 * The card is drawn by the rows themselves — white, with a hairline between
 * them, rounded at the day's first and last row — because a `FlatList` over
 * a flat sequence cannot wrap a run of items in a container. The rendered
 * result is identical to board 1.5's `#FFFFFF` / `1px #DFE4EC` / radius-16
 * card.
 */
function VisitRowView({
  visit,
  first,
  last,
}: {
  visit: VisitRow;
  first: boolean;
  last: boolean;
}) {
  const isOrder = visit.outcome === 'ORDER';
  const badge = isOrder
    ? { bg: CHIP_PIN_OK_BG, fg: CHIP_PIN_OK_FG, text: 'ORD' }
    : { bg: CHIP_PENDING_BG, fg: CHIP_PENDING_FG, text: 'NO' };

  return (
    <View
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
          width: VISIT_BADGE_SIZE,
          height: VISIT_BADGE_SIZE,
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
        <Text style={{ fontSize: 13, color: LABEL }}>{visit.summary}</Text>
      </View>

      <Text
        style={{
          fontFamily: 'monospace',
          fontSize: 12,
          color: MUTED,
          flexShrink: 0,
        }}
      >
        {formatClockTime(visit.occurredAt)}
      </Text>
    </View>
  );
}

/** `10:20` — the board's own row time. */
function formatClockTime(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function EmptyState({ message }: { message: string }) {
  return (
    <View style={{ paddingVertical: 48, paddingHorizontal: 8 }}>
      <Text
        style={{
          fontSize: 14,
          lineHeight: 21,
          color: LABEL,
          textAlign: 'center',
        }}
      >
        {message}
      </Text>
    </View>
  );
}

/** The end of the list: loading, a retryable failure, or "nothing older". */
function ListFooter({
  loading,
  hasMore,
  error,
  isEmpty,
  onRetry,
}: {
  loading: boolean;
  hasMore: boolean;
  error: string | null;
  isEmpty: boolean;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <Pressable onPress={onRetry} style={{ paddingVertical: 20 }}>
        <Text style={{ fontSize: 13, color: BLUE, textAlign: 'center' }}>
          {error}
        </Text>
      </Pressable>
    );
  }
  if (loading) {
    return (
      <View style={{ paddingVertical: 20 }}>
        <ActivityIndicator color={BLUE} />
      </View>
    );
  }
  if (!hasMore && !isEmpty) {
    return (
      <View style={{ paddingVertical: 20 }}>
        <Text style={{ fontSize: 12, color: MUTED, textAlign: 'center' }}>
          That is everything.
        </Text>
      </View>
    );
  }
  return null;
}

/**
 * The date-range presets.
 *
 * **No board exists for a date picker** — not here, not on the manager's
 * list (3.3), not on the admin's (4.2) — so rather than invent a screen this
 * is a small sheet over an unchanged one, offering the three presets FR-021
 * names. There is deliberately no custom range.
 */
function RangeSheet({
  visible,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selected: Range;
  onSelect: (next: Range) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const options: Range[] = ['ALL', 'LAST_7_DAYS', 'LAST_30_DAYS'];

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: 'rgba(20,26,38,0.4)',
          justifyContent: 'flex-end',
        }}
      >
        <View
          style={{
            backgroundColor: '#FFFFFF',
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            paddingTop: 14,
            paddingHorizontal: 20,
            paddingBottom: Math.max(insets.bottom, 24),
            gap: 4,
          }}
        >
          <Text
            style={{
              fontSize: 12,
              fontWeight: '700',
              letterSpacing: 0.72,
              textTransform: 'uppercase',
              color: MUTED,
              marginBottom: 6,
            }}
          >
            Show visits from
          </Text>
          {options.map((option) => (
            <Pressable
              key={option}
              onPress={() => onSelect(option)}
              style={{
                height: 48,
                borderRadius: 12,
                paddingHorizontal: 14,
                justifyContent: 'center',
                backgroundColor:
                  option === selected ? TAB_TRACK : 'transparent',
              }}
            >
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: option === selected ? '700' : '500',
                  color: option === selected ? INK : LABEL,
                }}
              >
                {RANGE_LABEL[option]}
              </Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}
