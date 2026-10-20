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

import { apiRequest } from '../../api/client';
import { AccountMenu } from '../../components/AccountMenu';
import { ManagerBottomNav } from '../../components/ManagerBottomNav';
import {
  OutlineIcon,
  type IconShape,
} from '../../components/icons/OutlineIcon';
import { clearSession, getSession } from '../../lib/secureSession';
import type { ManagerStackParamList } from '../../navigation/RootNavigator';
import {
  ACTION_BAR_BG,
  ACTION_BAR_INK,
  BG,
  BLUE,
  BORDER,
  INK,
  LABEL,
  MUTED,
  OUT_OF_RANGE_INK,
  RANGE_EXCEEDED,
  RANGE_NOT_VISITED,
  RANGE_WITHIN,
  ROLE_LABELS,
  ROW_SEPARATOR,
} from './managerDesign';
import { describeFailure, LoadNotice } from './loadState';

/**
 * PRD §4 screen 3.1 ("Manager · Previous-day report"), board uuid
 * `58a86d8e-eea6-41ac-a569-0a9265881f6c` (010-manager-app).
 *
 * **The first manager screen in the product.** Until this slice a manager
 * signed in and was told their screens were coming in a later update.
 *
 * It is also the first screen anywhere to show the measured distance and
 * the range verdict. That is deliberate (FR-046) and is the whole point of
 * the manager's app — and it does not weaken the rule for executives
 * (FR-047), whose screens are untouched by this feature.
 */

const ICON_PLUS: IconShape[] = [{ d: 'M12 5v14M5 12h14' }];
const ICON_CHEVRON_RIGHT: IconShape[] = [{ d: 'M9 6l6 6-6 6' }];

interface Report {
  period: { businessDate: string; label: string };
  counts: {
    assigned: number;
    visited: number;
    pending: number;
    order: number;
    noOrder: number;
    outOfRange: number;
  };
  range: {
    within: number;
    exceeded: number;
    notVisited: number;
    withinPercent: number | null;
  };
  outOfRangeVisits: Array<{
    visitId: string;
    shopName: string;
    executiveName: string;
    flag: string;
    distanceMeters: number;
  }>;
  executives: Array<{
    executiveId: string;
    name: string;
    beatPlanName: string | null;
    startedAt: string | null;
    endedAt: string | null;
    dayState: 'NOT_STARTED' | 'RUNNING' | 'ENDED' | 'AUTO_CLOSED';
  }>;
}

export function PreviousDayReportScreen() {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<
      NativeStackNavigationProp<ManagerStackParamList, 'PreviousDayReport'>
    >();

  const [data, setData] = useState<Report | null>(null);
  const [name, setName] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [staleNote, setStaleNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const dataRef = useRef<Report | null>(null);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    void apiRequest<{ name: string }>('/me')
      .then((me) => setName(me.name))
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const next = await apiRequest<Report>('/reports/previous-day');
      setData(next);
      setStaleNote(null);
    } catch (err) {
      // Keep what is on screen when there is something to keep; never fall
      // back to a screen of zeroes, which here would read as "nothing
      // happened yesterday" (FR-051). `describeFailure` decides which.
      const failure = describeFailure(
        err,
        'the figures',
        dataRef.current !== null,
      );
      setStaleNote(failure.staleNote);
      setError(failure.error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function handleLogout(): Promise<void> {
    setLoggingOut(true);
    try {
      const session = await getSession();
      if (session) {
        await apiRequest('/auth/logout', {
          method: 'POST',
          body: { refreshToken: session.refreshToken },
        });
      }
    } catch {
      // Clear regardless — never strand someone looking logged in.
    } finally {
      await clearSession();
      setLoggingOut(false);
    }
  }

  const counts = data?.counts;
  const range = data?.range;
  const total = range ? range.within + range.exceeded + range.notVisited : 0;
  const nothingRecorded = data !== null && data.counts.assigned === 0;

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
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
          }}
        >
          <View style={{ gap: 2, flexShrink: 1 }}>
            <Text style={{ fontSize: 13, color: MUTED }}>
              {data ? `${data.period.label} · all beats` : ' '}
            </Text>
            <Text style={{ fontSize: 28, fontWeight: '700', color: INK }}>
              Yesterday&rsquo;s beats
            </Text>
          </View>
          <AccountMenu
            loggingOut={loggingOut}
            name={name}
            onLogoutPress={() => void handleLogout()}
            onProfilePress={() => navigation.navigate('Profile')}
            roleLabel={ROLE_LABELS.MANAGER}
            testIDPrefix="manager"
          />
        </View>

        {/* The violet action bar — board 3.1's own copy (FR-012). */}
        <Pressable
          onPress={() => navigation.navigate('AddShopToToday')}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingVertical: 12,
            paddingHorizontal: 14,
            borderRadius: 14,
            backgroundColor: ACTION_BAR_BG,
          }}
        >
          <OutlineIcon
            color={ACTION_BAR_INK}
            shapes={ICON_PLUS}
            size={18}
            strokeWidth={2.2}
          />
          <View style={{ flexShrink: 1 }}>
            <Text
              style={{ fontSize: 14, fontWeight: '700', color: ACTION_BAR_INK }}
            >
              Add extra shop to today
            </Text>
            <Text style={{ fontSize: 12, color: ACTION_BAR_INK }}>
              One executive, today only · beat plan unchanged
            </Text>
          </View>
        </Pressable>

        <LoadNotice staleNote={staleNote} />
      </View>

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

        {data && counts && range ? (
          <>
            {nothingRecorded ? (
              <Text style={{ fontSize: 13, lineHeight: 19, color: LABEL }}>
                Nothing was assigned on this day, so there is nothing to report.
              </Text>
            ) : null}

            {/* Six KPI tiles, each drilling into the visits list (FR-007). */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Tile
                label="Assigned"
                onPress={() => navigation.navigate('ManagerVisits', {})}
                value={counts.assigned}
              />
              <Tile
                label="Visited"
                onPress={() => navigation.navigate('ManagerVisits', {})}
                value={counts.visited}
              />
              <Tile
                label="Pending"
                onPress={() => navigation.navigate('ManagerVisits', {})}
                value={counts.pending}
              />
              <Tile
                label="Order"
                onPress={() =>
                  navigation.navigate('ManagerVisits', { outcome: 'ORDER' })
                }
                tint={BLUE}
                value={counts.order}
              />
              <Tile
                label="No order"
                onPress={() =>
                  navigation.navigate('ManagerVisits', { outcome: 'NO_ORDER' })
                }
                value={counts.noOrder}
              />
              <Tile
                label="Out of range"
                onPress={() =>
                  navigation.navigate('ManagerVisits', { outOfRange: true })
                }
                tint={OUT_OF_RANGE_INK}
                value={counts.outOfRange}
              />
            </View>

            {/* The within-range bar — three segments, a legend, a percentage. */}
            <View
              style={{
                backgroundColor: '#FFFFFF',
                borderWidth: 1,
                borderColor: BORDER,
                borderRadius: 16,
                padding: 14,
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
                <Text style={{ fontSize: 13, color: MUTED, flexShrink: 1 }}>
                  Within range {range.within} of {counts.visited} visits
                </Text>
                <Text style={{ fontSize: 20, fontWeight: '700', color: INK }}>
                  {/* null, not 0%, when nothing was visited — a day with no
                      visits and a day with none in range are different. */}
                  {range.withinPercent === null
                    ? '—'
                    : `${range.withinPercent}%`}
                </Text>
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  height: 10,
                  borderRadius: 999,
                  overflow: 'hidden',
                  backgroundColor: RANGE_NOT_VISITED,
                }}
              >
                {total > 0 ? (
                  <>
                    <View
                      style={{
                        flex: range.within,
                        backgroundColor: RANGE_WITHIN,
                      }}
                    />
                    <View
                      style={{
                        flex: range.exceeded,
                        backgroundColor: RANGE_EXCEEDED,
                      }}
                    />
                    <View
                      style={{
                        flex: range.notVisited,
                        backgroundColor: RANGE_NOT_VISITED,
                      }}
                    />
                  </>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', gap: 14 }}>
                <Legend color={RANGE_WITHIN} label="Within" />
                <Legend color={RANGE_EXCEEDED} label="Exceeded" />
                <Legend color={RANGE_NOT_VISITED} label="Not visited" />
              </View>
            </View>

            {/* Out of range — the section the whole screen exists for. */}
            <View style={{ gap: 8 }}>
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
                  Out of range · {counts.outOfRange}
                </Text>
                <Pressable
                  onPress={() =>
                    navigation.navigate('ManagerVisits', { outOfRange: true })
                  }
                >
                  <Text
                    style={{ fontSize: 13, fontWeight: '600', color: BLUE }}
                  >
                    See all visits
                  </Text>
                </Pressable>
              </View>

              {data.outOfRangeVisits.length === 0 ? (
                <Text style={{ fontSize: 13, color: LABEL }}>
                  Every visit was within range.
                </Text>
              ) : (
                <View
                  style={{
                    backgroundColor: '#FFFFFF',
                    borderWidth: 1,
                    borderColor: BORDER,
                    borderRadius: 16,
                    overflow: 'hidden',
                  }}
                >
                  {data.outOfRangeVisits.map((v, index) => (
                    <Pressable
                      key={v.visitId}
                      onPress={() =>
                        navigation.navigate('OutOfRangeVisit', {
                          visitId: v.visitId,
                        })
                      }
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                        paddingVertical: 11,
                        paddingHorizontal: 14,
                        borderBottomWidth:
                          index === data.outOfRangeVisits.length - 1 ? 0 : 1,
                        borderBottomColor: ROW_SEPARATOR,
                      }}
                    >
                      <View style={{ flexGrow: 1, flexShrink: 1, gap: 2 }}>
                        <Text
                          numberOfLines={1}
                          style={{
                            fontSize: 15,
                            fontWeight: '700',
                            color: INK,
                          }}
                        >
                          {v.shopName}
                        </Text>
                        <Text style={{ fontSize: 13, color: LABEL }}>
                          {v.executiveName}
                        </Text>
                      </View>
                      <Text
                        style={{
                          fontFamily: 'monospace',
                          fontSize: 12,
                          fontWeight: '700',
                          color: OUT_OF_RANGE_INK,
                        }}
                      >
                        {v.distanceMeters} m
                      </Text>
                      <OutlineIcon
                        color={MUTED}
                        shapes={ICON_CHEVRON_RIGHT}
                        size={16}
                      />
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            {/* Beat start and end per executive, with the day's state (FR-011). */}
            {data.executives.length > 0 ? (
              <View style={{ gap: 8 }}>
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: '700',
                    letterSpacing: 0.72,
                    textTransform: 'uppercase',
                    color: MUTED,
                  }}
                >
                  Beats
                </Text>
                <View
                  style={{
                    backgroundColor: '#FFFFFF',
                    borderWidth: 1,
                    borderColor: BORDER,
                    borderRadius: 16,
                    overflow: 'hidden',
                  }}
                >
                  {data.executives.map((e, index) => (
                    <View
                      key={e.executiveId}
                      style={{
                        paddingVertical: 11,
                        paddingHorizontal: 14,
                        gap: 2,
                        borderBottomWidth:
                          index === data.executives.length - 1 ? 0 : 1,
                        borderBottomColor: ROW_SEPARATOR,
                      }}
                    >
                      <Text
                        style={{ fontSize: 15, fontWeight: '700', color: INK }}
                      >
                        {e.name}
                      </Text>
                      <Text style={{ fontSize: 13, color: LABEL }}>
                        {e.beatPlanName ?? 'No beat plan'} ·{' '}
                        {dayStateLabel(e.dayState)}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <ManagerBottomNav
        active="Reports"
        bottomInset={insets.bottom}
        onAttendancePress={() => navigation.navigate('AttendanceDay')}
        onReportsPress={() => undefined}
        onVisitsPress={() => navigation.navigate('ManagerVisits', {})}
      />
    </View>
  );
}

/**
 * `AUTO_CLOSED` is rendered because the field can carry it, even though the
 * nightly job that writes it is not built yet — the report reads the state
 * correctly rather than pretending the value cannot occur.
 */
function dayStateLabel(
  state: 'NOT_STARTED' | 'RUNNING' | 'ENDED' | 'AUTO_CLOSED',
): string {
  switch (state) {
    case 'NOT_STARTED':
      return 'Never started';
    case 'RUNNING':
      return 'Still running';
    case 'AUTO_CLOSED':
      return 'Closed automatically';
    case 'ENDED':
      return 'Ended';
  }
}

function Tile({
  label,
  value,
  onPress,
  tint = INK,
}: {
  label: string;
  value: number;
  onPress: () => void;
  tint?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexGrow: 1,
        flexBasis: '30%',
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
    </Pressable>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View
        style={{
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: color,
        }}
      />
      <Text style={{ fontSize: 12, color: MUTED }}>{label}</Text>
    </View>
  );
}
