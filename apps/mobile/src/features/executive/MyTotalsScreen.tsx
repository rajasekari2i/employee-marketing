import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, apiRequest } from '../../api/client';
import { ExecutiveBottomNav } from '../../components/ExecutiveBottomNav';
import { subscribeOutbox, type HeldSubmission } from '../../lib/outbox';
import type { ExecutiveStackParamList } from '../../navigation/RootNavigator';
import {
  AMBER_ACCENT,
  BG,
  BLUE,
  BLUE_CHIP,
  BORDER,
  CHART_BAR_INACTIVE,
  CHART_BAR_MAX_HEIGHT,
  CHART_CARD_HEIGHT,
  COMPLETION_RATE_SIZE,
  INK,
  LABEL,
  MUTED,
  ON_BLUE_MUTED,
  ROW_SEPARATOR,
  RUNNING_BG,
  RUNNING_BORDER,
  RUNNING_INK,
  SEGMENT_HEIGHT,
  TAB_TRACK,
  formatQuantity,
} from './executiveDesign';

/**
 * PRD §4 screen 1.6 ("My totals"), board uuid
 * `ef79b256-19a4-4963-b087-47a8ee0a71f7` (009-my-totals).
 *
 * **Two agreed divergences from the board, and only two** — both decided
 * with the user and both correctness-driven, with every colour, radius, font
 * and spacing value left as the board's:
 *
 *  1. The weekly chart has **seven** columns, not six. With the board's
 *     Mon–Sat an order recorded on a Sunday would be counted in the
 *     completion card, the tiles and the brand totals while being invisible
 *     in the chart — a silent disagreement between two halves of one screen.
 *  2. The brand section lists **every** brand rather than the three that fit,
 *     which is what earns the guarantee that the brand quantities add up to
 *     the Total qty tile exactly. The page scrolls when they do not fit,
 *     rather than nesting a scrolling card inside a scrolling screen, which
 *     React Native handles poorly and which would trap the gesture.
 *
 * Any third difference from board 1.6 is a defect.
 *
 * **Every number here is the server's.** The period boundaries, the
 * completion ratio, the three tiles, the brand totals and the weekly series
 * are all computed from the company's own calendar — the screen sends a
 * period name and renders what comes back.
 */

type Period = 'TODAY' | 'THIS_WEEK' | 'THIS_MONTH';

const PERIOD_TABS: ReadonlyArray<{ id: Period; label: string }> = [
  { id: 'TODAY', label: 'Today' },
  { id: 'THIS_WEEK', label: 'This week' },
  { id: 'THIS_MONTH', label: 'This month' },
];

interface BrandTotal {
  brandId: string;
  label: string;
  quantity: number;
}

interface DayTotal {
  businessDate: string;
  label: string;
  orderCount: number;
  isToday: boolean;
}

interface TotalsResponse {
  period: { period: Period; from: string; to: string; label: string };
  completion: {
    assignedStops: number;
    visitedStops: number;
    completionRate: number | null;
  };
  totals: { orderCount: number; noOrderCount: number; totalQuantity: number };
  brands: BrandTotal[];
  week: { from: string; to: string; days: DayTotal[] };
}

export function MyTotalsScreen() {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<
      NativeStackNavigationProp<ExecutiveStackParamList, 'MyTotals'>
    >();

  const [period, setPeriod] = useState<Period>('THIS_WEEK');
  const [data, setData] = useState<TotalsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [staleNote, setStaleNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [held, setHeld] = useState<HeldSubmission[]>([]);

  useEffect(() => subscribeOutbox(setHeld), []);

  /** Mirrors `data` so the fetch can ask "is anything on screen?" without taking it as a dependency. */
  const dataRef = useRef<TotalsResponse | null>(null);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = (requestSeq.current += 1);
    setError(null);

    try {
      const next = await apiRequest<TotalsResponse>(
        `/reports/executive-totals?period=${period}`,
      );
      if (seq !== requestSeq.current) {
        return;
      }
      setData(next);
      setStaleNote(null);
    } catch (err) {
      if (seq !== requestSeq.current) {
        return;
      }
      const offline = err instanceof ApiError && err.code === 'NETWORK_ERROR';
      const message =
        err instanceof Error ? err.message : 'Something went wrong.';

      if (dataRef.current) {
        // FR-024: keep what is on screen and say it is not fresh, rather
        // than blanking a screen that was working a moment ago.
        setStaleNote(
          offline
            ? 'No connection. Showing the figures you last loaded.'
            : 'Could not refresh. Showing the figures you last loaded.',
        );
      } else {
        // Nothing to fall back on. Say there is no connection — NOT a screen
        // of zeroes, which an executive would read as "I did nothing".
        setError(
          offline
            ? 'No connection, so your totals could not be loaded. Try again when you are back online.'
            : message,
        );
      }
    } finally {
      if (seq === requestSeq.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [period]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const waiting = held.length;
  const completion = data?.completion;
  const totals = data?.totals;
  const brands = data?.brands ?? [];
  const largestBrand = brands[0]?.quantity ?? 0;
  const busiestDay = Math.max(
    1,
    ...(data?.week.days.map((day) => day.orderCount) ?? [0]),
  );
  const nothingRecorded =
    data !== null &&
    data.completion.assignedStops === 0 &&
    data.totals.orderCount === 0 &&
    data.totals.noOrderCount === 0;

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
        <View style={{ gap: 2 }}>
          <Text style={{ fontSize: 13, color: MUTED }}>
            {data?.period.label ?? ' '}
          </Text>
          <Text style={{ fontSize: 28, fontWeight: '700', color: INK }}>
            My totals
          </Text>
        </View>

        {/* The period tabs. Board 1.6's `.seg` is the same control board 1.5
            uses — 38 tall, radius 10, weight 700 — but with no counts. */}
        <View
          style={{
            flexDirection: 'row',
            gap: 4,
            padding: 4,
            borderRadius: 12,
            backgroundColor: TAB_TRACK,
          }}
        >
          {PERIOD_TABS.map((tab) => (
            <Segment
              active={period === tab.id}
              key={tab.id}
              label={tab.label}
              onPress={() => setPeriod(tab.id)}
            />
          ))}
        </View>

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
              {waiting} submission{waiting === 1 ? '' : 's'} waiting to sync.{' '}
              {waiting === 1 ? 'It is' : 'They are'} not counted in these
              figures yet.
            </Text>
          </View>
        ) : null}

        {staleNote ? (
          <Text style={{ fontSize: 13, color: LABEL }}>{staleNote}</Text>
        ) : null}
      </View>

      {/* main — board: padding 0 20px, column, gap 14.
          The page scrolls so every brand is reachable (FR-015). */}
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: 84 + insets.bottom + 16,
          gap: 14,
        }}
        refreshControl={
          <RefreshControl
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            refreshing={refreshing}
          />
        }
        style={{ flexGrow: 1 }}
      >
        {loading && !data ? (
          <View style={{ paddingVertical: 48, alignItems: 'center' }}>
            <ActivityIndicator color={BLUE} />
          </View>
        ) : null}

        {error && !data ? (
          <Text
            style={{
              fontSize: 14,
              lineHeight: 21,
              color: LABEL,
              paddingVertical: 48,
              textAlign: 'center',
            }}
          >
            {error}
          </Text>
        ) : null}

        {data ? (
          <>
            {nothingRecorded ? (
              <Text style={{ fontSize: 13, lineHeight: 19, color: LABEL }}>
                You have not recorded anything in this period yet. Your figures
                will appear here as you work.
              </Text>
            ) : null}

            {/* Beat completion */}
            <View
              style={{
                backgroundColor: BLUE,
                borderRadius: 18,
                padding: 16,
                gap: 10,
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                }}
              >
                <Text style={{ fontSize: 13, color: ON_BLUE_MUTED }}>
                  Beat completion
                </Text>
                <Text
                  style={{
                    fontSize: COMPLETION_RATE_SIZE,
                    fontWeight: '700',
                    color: '#FFFFFF',
                  }}
                >
                  {/* null, not 0 — a holiday week and a wasted week are
                      different facts and "0%" says the wrong one (FR-010). */}
                  {completion?.completionRate === null
                    ? '—'
                    : `${completion?.completionRate ?? 0}%`}
                </Text>
              </View>
              <View
                style={{
                  height: 8,
                  borderRadius: 999,
                  backgroundColor: BLUE_CHIP,
                  overflow: 'hidden',
                }}
              >
                <View
                  style={{
                    width: `${completion?.completionRate ?? 0}%`,
                    height: 8,
                    borderRadius: 999,
                    backgroundColor: AMBER_ACCENT,
                  }}
                />
              </View>
              <Text style={{ fontSize: 13, color: ON_BLUE_MUTED }}>
                {completion?.completionRate === null
                  ? 'No shops were assigned in this period.'
                  : `${completion?.visitedStops ?? 0} of ${completion?.assignedStops ?? 0} assigned shops visited`}
              </Text>
            </View>

            {/* The three tiles */}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Tile
                label="Orders"
                tint={BLUE}
                value={formatQuantity(totals?.orderCount ?? 0)}
              />
              <Tile
                label="No order"
                value={formatQuantity(totals?.noOrderCount ?? 0)}
              />
              <Tile
                label="Total qty"
                value={formatQuantity(totals?.totalQuantity ?? 0)}
              />
            </View>

            {/* Quantity by brand */}
            <View style={{ gap: 8 }}>
              <SectionHeading title="Quantity by brand" />
              {brands.length === 0 ? (
                <Text
                  style={{ fontSize: 13, color: LABEL, paddingHorizontal: 2 }}
                >
                  No orders in this period, so there is nothing to break down
                  yet.
                </Text>
              ) : (
                <View
                  style={{
                    backgroundColor: '#FFFFFF',
                    borderWidth: 1,
                    borderColor: BORDER,
                    borderRadius: 16,
                    paddingVertical: 6,
                    paddingHorizontal: 14,
                  }}
                >
                  {brands.map((brand, index) => (
                    <BrandRow
                      brand={brand}
                      key={brand.brandId}
                      largest={largestBrand}
                      last={index === brands.length - 1}
                    />
                  ))}
                </View>
              )}
            </View>

            {/* Orders per day · this week */}
            <View style={{ gap: 8 }}>
              <SectionHeading title="Orders per day · this week" />
              <View
                style={{
                  backgroundColor: '#FFFFFF',
                  borderWidth: 1,
                  borderColor: BORDER,
                  borderRadius: 16,
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  height: CHART_CARD_HEIGHT,
                  flexDirection: 'row',
                  alignItems: 'flex-end',
                  gap: 10,
                }}
              >
                {data.week.days.map((day) => (
                  <DayColumn
                    busiest={busiestDay}
                    day={day}
                    key={day.businessDate}
                  />
                ))}
              </View>
            </View>
          </>
        ) : null}
      </ScrollView>

      <ExecutiveBottomNav
        active="MyTotals"
        bottomInset={insets.bottom}
        onMyTotalsPress={() => undefined}
        onMyVisitsPress={() => navigation.navigate('MyVisits')}
        onTodayPress={() => navigation.navigate('TodaysBeat')}
      />
    </View>
  );
}

/** `.seg` on board 1.6 — identical to board 1.5's: 38 tall, radius 10, weight 700. */
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

/** `.sec` — 12/700, 0.06em, uppercase. */
function SectionHeading({ title }: { title: string }) {
  return (
    <Text
      style={{
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 0.72,
        textTransform: 'uppercase',
        color: MUTED,
      }}
    >
      {title}
    </Text>
  );
}

/** One of the three stat tiles. Only Orders is tinted blue on the board. */
function Tile({
  label,
  value,
  tint = INK,
}: {
  label: string;
  value: string;
  tint?: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 14,
        paddingVertical: 10,
        paddingHorizontal: 12,
        gap: 2,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: '600', color: MUTED }}>
        {label}
      </Text>
      <Text style={{ fontSize: 24, fontWeight: '700', color: tint }}>
        {value}
      </Text>
    </View>
  );
}

/**
 * One brand row. The bar is measured against the **largest brand in the
 * list**, not the period total, so the comparison stays legible when one
 * brand dominates.
 */
function BrandRow({
  brand,
  largest,
  last,
}: {
  brand: BrandTotal;
  largest: number;
  last: boolean;
}) {
  const width = largest > 0 ? Math.round((brand.quantity / largest) * 100) : 0;
  return (
    <View
      style={{
        gap: 6,
        paddingVertical: 10,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: ROW_SEPARATOR,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <Text
          numberOfLines={1}
          style={{ fontSize: 14, fontWeight: '600', color: INK, flexShrink: 1 }}
        >
          {brand.label}
        </Text>
        <Text
          style={{
            fontFamily: 'monospace',
            fontSize: 14,
            fontWeight: '700',
            color: INK,
          }}
        >
          {formatQuantity(brand.quantity)}
        </Text>
      </View>
      <View
        style={{
          height: 8,
          borderRadius: 999,
          backgroundColor: ROW_SEPARATOR,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${width}%`,
            height: 8,
            borderRadius: 999,
            backgroundColor: BLUE,
          }}
        />
      </View>
    </View>
  );
}

/**
 * One column of the weekly chart.
 *
 * The bar is measured against the **busiest day of that week**. A day with
 * no orders still renders its column, with the count `0` and no bar height —
 * omitting it would collapse the shape of the week, which is the only thing
 * this chart is for (FR-019).
 */
function DayColumn({ day, busiest }: { day: DayTotal; busiest: number }) {
  const height = Math.round((day.orderCount / busiest) * CHART_BAR_MAX_HEIGHT);
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
      <Text
        style={{
          fontFamily: 'monospace',
          fontSize: 11,
          fontWeight: '700',
          color: LABEL,
        }}
      >
        {day.orderCount}
      </Text>
      <View
        style={{
          width: '100%',
          height,
          borderTopLeftRadius: 6,
          borderTopRightRadius: 6,
          borderBottomLeftRadius: 2,
          borderBottomRightRadius: 2,
          backgroundColor: day.isToday ? BLUE : CHART_BAR_INACTIVE,
        }}
      />
      <Text style={{ fontSize: 11, fontWeight: '600', color: MUTED }}>
        {day.label}
      </Text>
    </View>
  );
}
