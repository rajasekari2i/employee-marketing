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

import { apiRequest, generateIdempotencyKey } from '../../api/client';
import { ExecutiveBottomNav } from '../../components/ExecutiveBottomNav';
import type { ExecutiveStackParamList } from '../../navigation/RootNavigator';
import { DashedAction } from './DashedAction';
import {
  OutlineIcon,
  type IconShape,
} from '../../components/icons/OutlineIcon';
import { getCurrentPosition, locationFailureMessage } from '../../lib/location';
import {
  startOutboxSync,
  subscribeOutbox,
  sync as syncOutbox,
  type HeldSubmission,
} from '../../lib/outbox';
import { clearSession, getSession } from '../../lib/secureSession';

import {
  AMBER_ACCENT,
  BG,
  BLUE,
  BLUE_CHIP,
  BORDER,
  CHIP_NEUTRAL_BG,
  CHIP_PENDING_BG,
  CHIP_PENDING_FG,
  CHIP_PIN_MISSING_BG,
  CHIP_PIN_MISSING_FG,
  CHIP_PIN_OK_BG,
  CHIP_PIN_OK_FG,
  CHIP_VIOLET_BG,
  CHIP_VIOLET_FG,
  CONFIRM_BG,
  CONFIRM_BORDER,
  CONFIRM_INK,
  DANGER,
  ENDED_BG,
  ENDED_CHIP,
  ENDED_MUTED,
  INK,
  LOCKED_BG,
  LOCKED_INK,
  MUTED,
  ON_BLUE_MUTED,
  ROW_SEPARATOR,
  RUNNING_BG,
  RUNNING_BORDER,
  RUNNING_INK,
  TAB_TRACK,
  formatClock,
  formatDuration,
  formatHeaderDate,
  greetingFor,
} from './executiveDesign';

/**
 * PRD §4 screen 1.3 ("Today's beat"). Every hex value, dimension, radius and
 * SVG path below is taken verbatim from
 * `docs/ui-design/Field_Sales_Beat_App.html` board 1.3 (decode it with the
 * recipe in CLAUDE.md; uuid `20463df0-5cdd-44a1-bce2-f24ff89bf4c6`) — not
 * approximated from the NativeWind/Tailwind scale.
 *
 * The board drives all four states from one enum, and so does this screen:
 * not started → running → ending (an inline confirmation in the same card,
 * never a separate screen) → ended.
 *
 * Three parts of the board depend on features that do not exist yet and are
 * rendered with their honest empty value rather than hidden (research.md §8),
 * so the cards keep their shape when those features land: each row's history
 * chip reads "First visit"; the Revisit and Extra counts read zero; and the
 * closed card's Orders and No-order totals read zero.
 */

const ICON_REFRESH: IconShape[] = [
  { d: 'M20 11a8 8 0 1 0-2.3 5.7' },
  { d: 'M20 4v7h-7' },
];
const ICON_PLAY: IconShape[] = [
  { circle: [12, 12, 9] },
  { d: 'M10 8.5l6 3.5-6 3.5z' },
];
const ICON_STOP: IconShape[] = [{ rect: [7, 7, 10, 10, 2] }];
const ICON_LOCK: IconShape[] = [
  { rect: [5, 11, 14, 10, 2] },
  { d: 'M8 11V8a4 4 0 0 1 8 0v3' },
];
const ICON_WARN: IconShape[] = [
  { d: 'M12 3l10 18H2L12 3z' },
  { d: 'M12 10v5M12 18h.01' },
];
const ICON_CHEVRON: IconShape[] = [{ d: 'M6 9l6 6 6-6' }];

type BeatState = 'NOT_STARTED' | 'RUNNING' | 'ENDED';
type Tab = 'todo' | 'done' | 'all';

interface Stop {
  id: string;
  sequence: number;
  source: 'PLAN' | 'EXEC_EXTRA' | 'MANAGER_EXTRA';
  status: 'PENDING' | 'COMPLETED' | 'SKIPPED' | 'REVISIT';
  shop: {
    id: string;
    name: string;
    addressLine: string | null;
    // 006-visit-outcomes widened LocationStatus with PENDING_VERIFICATION —
    // the server has been able to return it since then and this type still
    // omitted it. 007-extra-shops makes it reachable for the first time: a
    // shop an executive created from the field waits for the Company
    // Admin's confirmation unless the company auto-approves. The routing
    // below already does the right thing with it (anything but APPROVED
    // goes to capture), so this is the type catching up with the server.
    pinStatus: 'NONE' | 'PENDING_VERIFICATION' | 'APPROVED';
  };
  previousOutcome: string | null;
}

interface Assignment {
  id: string;
  businessDate: string;
  beatPlanName: string | null;
  state: BeatState;
  startedAt: string | null;
  endedAt: string | null;
  nearestShopName: string | null;
  counts: {
    total: number;
    pending: number;
    completed: number;
    revisit: number;
    extra: number;
    visited: number;
    orders: number;
    noOrder: number;
    notVisited: number;
  };
  stops: Stop[];
}

interface TodayResponse {
  assignment: Assignment | null;
  noBeatReason: 'NO_BEAT_PLAN' | 'NOT_A_WORKING_DAY' | null;
}

/** Only the field this screen needs from `GET /me` — the header greeting. */
interface MeResponse {
  name: string;
}

export function TodaysBeatScreen() {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<
      NativeStackNavigationProp<ExecutiveStackParamList, 'TodaysBeat'>
    >();

  // 006-visit-outcomes: submissions held on the device waiting for a
  // connection. Shown so the executive can tell at a glance that work is
  // saved but not yet sent (FR-039).
  const [held, setHeld] = useState<HeldSubmission[]>([]);
  useEffect(() => subscribeOutbox(setHeld), []);
  useEffect(() => startOutboxSync(), []);

  const [data, setData] = useState<TodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('todo');
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [name, setName] = useState<string | undefined>(undefined);

  // Ticks once a minute so the elapsed time stays current. The value itself
  // is always derived from `startedAt`, never counted up — so backgrounding
  // the app and returning cannot drift it (SC-009).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // The stored session carries only the tokens and the role, so the
    // display name comes from /me — the same source the admin home uses.
    void apiRequest<MeResponse>('/me')
      .then((me) => setName(me.name))
      .catch(() => {
        // Best-effort: the greeting degrades to the time of day without a
        // name rather than blocking the screen.
      });
  }, []);

  // Whether a day is already on screen, read through a ref so `load` keeps a
  // stable identity. Deriving this from `data` instead would make `load`
  // change on every successful fetch, and `useFocusEffect` would then re-run
  // on each one — a fetch loop.
  const hasDataRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const result = await apiRequest<TodayResponse>('/assignments/today');
      setData(result);
      hasDataRef.current = true;
      setError(null);
      // A successful request is the only real evidence of a connection
      // (research.md §2) — so it is also the best moment to drain the queue.
      void syncOutbox();
    } catch (err) {
      // Keep whatever is already on screen. Stale data is never silently
      // presented as fresh — the message says the refresh failed — but it
      // beats blanking a day the executive is working from (FR-025).
      setError(
        hasDataRef.current
          ? 'Could not refresh. Showing the last loaded day.'
          : messageFor(err),
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const assignment = data?.assignment ?? null;
  const state: BeatState = assignment?.state ?? 'NOT_STARTED';
  const startedAt = assignment?.startedAt
    ? new Date(assignment.startedAt)
    : null;
  const endedAt = assignment?.endedAt ? new Date(assignment.endedAt) : null;

  async function runCommand(path: string): Promise<void> {
    if (!assignment) {
      return;
    }
    setBusy(true);
    const fix = await getCurrentPosition();
    if (!fix.ok) {
      setError(locationFailureMessage(fix.failure));
      setBusy(false);
      return;
    }
    try {
      const updated = await apiRequest<Assignment>(
        `/assignments/${assignment.id}/${path}`,
        {
          method: 'POST',
          body: fix.position,
          idempotencyKey: generateIdempotencyKey(),
        },
      );
      setData({ assignment: updated, noBeatReason: null });
      setConfirmingEnd(false);
      setError(null);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  /** Mirrors the admin home's logout: revoke server-side, then clear locally regardless. */
  async function handleLogout(): Promise<void> {
    // FR-041: logging out would strand submissions the executive believes
    // are saved, so the session is KEPT and they are told why.
    if (held.length > 0) {
      setError(
        `${held.length} submission${held.length === 1 ? '' : 's'} still waiting to sync. Reconnect so they can be sent before logging out.`,
      );
      return;
    }

    try {
      const session = await getSession();
      if (session) {
        await apiRequest('/auth/logout', {
          method: 'POST',
          body: { refreshToken: session.refreshToken },
        });
      }
    } catch {
      // Clear regardless — never strand the user looking logged in because
      // of a network error.
    } finally {
      await clearSession();
    }
  }

  const visible = (assignment?.stops ?? []).filter((stop) => {
    if (tab === 'all') return true;
    if (tab === 'done') return stop.status === 'COMPLETED';
    return stop.status !== 'COMPLETED';
  });

  const counts = assignment?.counts;
  const todoCount = counts ? counts.total - counts.completed : 0;
  const pendingNames = (assignment?.stops ?? [])
    .filter((s) => s.status === 'PENDING')
    .map((s) => s.shop.name);

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 84 + insets.bottom + 20 }}
        refreshControl={
          <RefreshControl
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            refreshing={refreshing}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            paddingTop: insets.top + 16,
            paddingHorizontal: 20,
            paddingBottom: 16,
            gap: 14,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
            }}
          >
            <View style={{ gap: 2, flexShrink: 1 }}>
              <Text style={{ fontSize: 14, color: MUTED, fontWeight: '500' }}>
                {formatHeaderDate(now)} · {greetingFor(now, name)}
              </Text>
              <Text style={{ fontSize: 30, fontWeight: '700', color: INK }}>
                Today&apos;s beat
              </Text>
            </View>

            <View
              style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}
            >
              <Pressable
                accessibilityLabel="Refresh assignment"
                onPress={() => void load()}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: BORDER,
                  backgroundColor: '#FFFFFF',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <OutlineIcon color={INK} shapes={ICON_REFRESH} size={20} />
              </Pressable>

              <Pressable
                accessibilityLabel={`Account menu — ${name ?? ''}`}
                onPress={() => setMenuOpen((open) => !open)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  height: 48,
                  paddingLeft: 2,
                  paddingRight: 8,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: BORDER,
                  backgroundColor: '#FFFFFF',
                }}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    backgroundColor: INK,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: '700',
                      color: '#FFFFFF',
                    }}
                  >
                    {initials(name)}
                  </Text>
                </View>
                <OutlineIcon
                  color="#3A4353"
                  shapes={ICON_CHEVRON}
                  size={18}
                  strokeWidth={2.2}
                />
              </Pressable>
            </View>
          </View>

          {menuOpen ? (
            <View
              style={{
                alignSelf: 'flex-end',
                width: 200,
                backgroundColor: '#FFFFFF',
                borderWidth: 1,
                borderColor: BORDER,
                borderRadius: 16,
                padding: 6,
              }}
            >
              <View
                style={{
                  paddingHorizontal: 12,
                  paddingTop: 10,
                  paddingBottom: 8,
                  borderBottomWidth: 1,
                  borderBottomColor: ROW_SEPARATOR,
                  marginBottom: 4,
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: INK }}>
                  {name ?? ''}
                </Text>
                <Text style={{ fontSize: 12, color: MUTED }}>
                  Marketing Executive
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  setMenuOpen(false);
                  void handleLogout();
                }}
                style={{
                  height: 44,
                  justifyContent: 'center',
                  paddingHorizontal: 12,
                }}
              >
                <Text
                  style={{ fontSize: 15, fontWeight: '600', color: DANGER }}
                >
                  Log out
                </Text>
              </Pressable>
            </View>
          ) : null}

          {loading && !data ? null : assignment === null ? (
            <NoBeatCard reason={data?.noBeatReason ?? null} />
          ) : state === 'ENDED' ? (
            <EndedCard
              assignment={assignment}
              endedAt={endedAt}
              startedAt={startedAt}
            />
          ) : (
            <>
              {state === 'NOT_STARTED' ? (
                <NotStartedCard
                  assignment={assignment}
                  busy={busy}
                  onStart={() => void runCommand('start')}
                />
              ) : (
                <RunningCard assignment={assignment} />
              )}

              {state === 'RUNNING' && !confirmingEnd ? (
                <RunningStrip
                  nearestShopName={assignment.nearestShopName}
                  now={now}
                  onEnd={() => setConfirmingEnd(true)}
                  startedAt={startedAt}
                />
              ) : null}

              {state === 'RUNNING' && confirmingEnd ? (
                <EndConfirmation
                  busy={busy}
                  now={now}
                  onCancel={() => setConfirmingEnd(false)}
                  onConfirm={() => void runCommand('end')}
                  pendingNames={pendingNames}
                />
              ) : null}
            </>
          )}

          {assignment ? (
            <View
              style={{
                flexDirection: 'row',
                gap: 4,
                padding: 4,
                borderRadius: 12,
                backgroundColor: TAB_TRACK,
              }}
            >
              <FilterTab
                active={tab === 'todo'}
                label={`To do · ${todoCount}`}
                onPress={() => setTab('todo')}
              />
              <FilterTab
                active={tab === 'done'}
                label={`Done · ${counts?.completed ?? 0}`}
                onPress={() => setTab('done')}
              />
              <FilterTab
                active={tab === 'all'}
                label={`All · ${counts?.total ?? 0}`}
                onPress={() => setTab('all')}
              />
            </View>
          ) : null}
        </View>

        <View style={{ paddingHorizontal: 20, gap: 10 }}>
          {error ? (
            <Text style={{ fontSize: 13, color: DANGER, paddingHorizontal: 4 }}>
              {error}
            </Text>
          ) : null}

          {loading && !data ? (
            <View style={{ paddingVertical: 60, alignItems: 'center' }}>
              <ActivityIndicator testID="todays-beat-loading" />
            </View>
          ) : null}

          {held.length > 0 ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingVertical: 11,
                paddingHorizontal: 14,
                borderRadius: 14,
                backgroundColor: RUNNING_BG,
                borderWidth: 1,
                borderColor: RUNNING_BORDER,
              }}
            >
              <Text style={{ fontSize: 13, color: RUNNING_INK, flexShrink: 1 }}>
                {held.filter((item) => item.permanentlyRejected).length > 0
                  ? `${held.filter((i) => i.permanentlyRejected).length} submission${held.filter((i) => i.permanentlyRejected).length === 1 ? '' : 's'} could not be saved — ${held.find((i) => i.permanentlyRejected)?.lastError ?? ''}`
                  : waitingLabel(held)}
              </Text>
            </View>
          ) : null}

          {assignment && state === 'NOT_STARTED' ? (
            <LockedStrip text="Start the beat to record visits and add extra shops." />
          ) : null}

          {/*
            007-extra-shops, FR-001. Board 1.3 draws this under
            `<sc-if value="{{active}}">` in exactly this slot — the one that
            holds the locked strip for NOT_STARTED and ENDED — NOT beside
            "End beat" in the running strip. The RUNNING case rendered
            nothing here before; this is the gap the slice fills.
          */}
          {assignment && state === 'RUNNING' ? (
            <DashedAction
              label="Add extra shop to today"
              onPress={() =>
                navigation.navigate('AddExtraShop', {
                  assignmentId: assignment.id,
                  beatPlanName: assignment.beatPlanName,
                  totalStopsToday: assignment.counts.total,
                })
              }
            />
          ) : null}

          {assignment && state === 'ENDED' ? (
            <LockedStrip text="Beat ended for today. Your list starts again tomorrow morning." />
          ) : null}

          {assignment && visible.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <Text style={{ fontSize: 14, color: MUTED }}>
                {tab === 'done' ? 'Nothing completed yet.' : 'Nothing here.'}
              </Text>
            </View>
          ) : null}

          {visible.map((stop) => (
            <StopRow
              key={stop.id}
              locked={state !== 'RUNNING'}
              onPress={() => {
                if (state !== 'RUNNING') {
                  return;
                }
                // FR-001: a shop with no saved location goes to capture, not
                // to the outcome path — recording there is impossible until
                // the pin exists.
                if (stop.shop.pinStatus === 'APPROVED') {
                  navigation.navigate('ShopVisit', { stopId: stop.id });
                } else {
                  navigation.navigate('CaptureShopPin', {
                    stopId: stop.id,
                    shopId: stop.shop.id,
                    shopName: stop.shop.name,
                    shopCode: stop.shop.id.slice(0, 8),
                    addressLine: stop.shop.addressLine,
                    maxAccuracyMeters: 20,
                  });
                }
              }}
              stop={stop}
            />
          ))}
        </View>
      </ScrollView>

      <ExecutiveBottomNav
        active="Today"
        bottomInset={insets.bottom}
        // 008-my-visits: board 1.5 is built, so this tab navigates instead
        // of raising the "coming in a later update" alert.
        onMyVisitsPress={() => navigation.navigate('MyVisits')}
        onTodayPress={() => void load()}
      />
    </View>
  );
}

function NotStartedCard({
  assignment,
  busy,
  onStart,
}: {
  assignment: Assignment;
  busy: boolean;
  onStart: () => void;
}) {
  const { counts } = assignment;
  const planned = counts.total - counts.extra;
  return (
    <View
      style={{
        backgroundColor: BLUE,
        borderRadius: 18,
        padding: 16,
        gap: 14,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 10,
        }}
      >
        <View style={{ gap: 2, flexShrink: 1 }}>
          <Text style={{ fontSize: 13, color: ON_BLUE_MUTED }}>Beat plan</Text>
          <Text style={{ fontSize: 19, fontWeight: '700', color: '#FFFFFF' }}>
            {assignment.beatPlanName ?? 'Today'}
          </Text>
          <Text style={{ fontSize: 12, color: ON_BLUE_MUTED }}>
            {counts.total} stops today · {planned} planned + {counts.extra}{' '}
            extra
          </Text>
        </View>
        <Chip bg={BLUE_CHIP} fg="#FFFFFF" label="Not started" />
      </View>

      <Pressable
        accessibilityLabel="Start beat"
        disabled={busy}
        onPress={onStart}
        style={{
          height: 54,
          borderRadius: 14,
          backgroundColor: '#FFFFFF',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          opacity: busy ? 0.6 : 1,
        }}
      >
        <OutlineIcon
          color={BLUE}
          shapes={ICON_PLAY}
          size={20}
          strokeWidth={2}
        />
        <Text style={{ fontSize: 17, fontWeight: '700', color: BLUE }}>
          {busy ? 'Starting…' : 'Start beat'}
        </Text>
      </Pressable>

      <Text style={{ fontSize: 12, color: ON_BLUE_MUTED, lineHeight: 17 }}>
        Your location and the time are saved when you start. Visits can be
        recorded only after the beat starts.
      </Text>
    </View>
  );
}

function RunningCard({ assignment }: { assignment: Assignment }) {
  const { counts } = assignment;
  const planned = counts.total - counts.extra;
  const pct = counts.total === 0 ? 0 : (counts.completed / counts.total) * 100;
  return (
    <View
      style={{ backgroundColor: BLUE, borderRadius: 18, padding: 16, gap: 12 }}
    >
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}
      >
        <View style={{ gap: 2, flexShrink: 1 }}>
          <Text style={{ fontSize: 13, color: ON_BLUE_MUTED }}>Beat plan</Text>
          <Text style={{ fontSize: 19, fontWeight: '700', color: '#FFFFFF' }}>
            {assignment.beatPlanName ?? 'Today'}
          </Text>
          <Text
            style={{ fontSize: 12, color: AMBER_ACCENT, fontWeight: '600' }}
          >
            {planned} planned + {counts.extra} extra
          </Text>
        </View>
        <Text style={{ fontSize: 28, fontWeight: '700', color: '#FFFFFF' }}>
          {counts.completed}
          <Text style={{ fontSize: 16, color: ON_BLUE_MUTED }}>
            /{counts.total}
          </Text>
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
            width: `${pct}%`,
            height: 8,
            backgroundColor: AMBER_ACCENT,
            borderRadius: 999,
          }}
        />
      </View>

      <View style={{ flexDirection: 'row', gap: 6 }}>
        <Stat label="Pending" value={counts.pending} />
        <Stat label="Completed" value={counts.completed} />
        <Stat label="Revisit" value={counts.revisit} />
        <Stat label="Extra" value={counts.extra} />
      </View>
    </View>
  );
}

function RunningStrip({
  startedAt,
  now,
  nearestShopName,
  onEnd,
}: {
  startedAt: Date | null;
  now: Date;
  nearestShopName: string | null;
  onEnd: () => void;
}) {
  const elapsed = startedAt
    ? formatDuration(now.getTime() - startedAt.getTime())
    : '';
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 8,
        paddingLeft: 14,
        paddingRight: 10,
        borderRadius: 14,
        backgroundColor: RUNNING_BG,
        borderWidth: 1,
        borderColor: RUNNING_BORDER,
      }}
    >
      <View
        style={{
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: BLUE,
        }}
      />
      <View style={{ flexGrow: 1, flexShrink: 1 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: RUNNING_INK }}>
          Beat running ·{' '}
          <Text style={{ fontFamily: 'monospace' }}>{elapsed}</Text>
        </Text>
        <Text style={{ fontSize: 12, color: '#3A4353' }}>
          Started{' '}
          <Text style={{ fontFamily: 'monospace' }}>
            {startedAt ? formatClock(startedAt) : '--:--'}
          </Text>
          {nearestShopName ? ` at ${nearestShopName}` : ''}
        </Text>
      </View>
      <Pressable
        accessibilityLabel="End beat"
        onPress={onEnd}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          height: 40,
          paddingHorizontal: 14,
          borderRadius: 10,
          borderWidth: 1.5,
          borderColor: INK,
          backgroundColor: '#FFFFFF',
        }}
      >
        <OutlineIcon color={INK} shapes={ICON_STOP} size={16} strokeWidth={2} />
        <Text style={{ fontSize: 14, fontWeight: '700', color: INK }}>
          End beat
        </Text>
      </Pressable>
    </View>
  );
}

/** FR-018: the confirmation lives inline in the same card, never on a separate screen. */
function EndConfirmation({
  now,
  pendingNames,
  busy,
  onCancel,
  onConfirm,
}: {
  now: Date;
  pendingNames: string[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const named = pendingNames.slice(0, 3).join(', ');
  const extra =
    pendingNames.length > 3 ? ` and ${pendingNames.length - 3} more` : '';
  return (
    <View
      style={{
        gap: 10,
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: 14,
        backgroundColor: CONFIRM_BG,
        borderWidth: 1,
        borderColor: CONFIRM_BORDER,
      }}
    >
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <OutlineIcon color={CONFIRM_INK} shapes={ICON_WARN} size={20} />
        <Text
          style={{
            fontSize: 13,
            lineHeight: 20,
            color: CONFIRM_INK,
            flexShrink: 1,
          }}
        >
          End the beat at{' '}
          <Text style={{ fontFamily: 'monospace' }}>{formatClock(now)}</Text>?
          {pendingNames.length > 0 ? (
            <Text>
              {' '}
              <Text style={{ fontWeight: '700' }}>
                {pendingNames.length} shop
                {pendingNames.length === 1 ? ' is' : 's are'} still pending
              </Text>{' '}
              — {named}
              {extra} will be recorded as not visited today.
            </Text>
          ) : null}{' '}
          No more visits can be added.
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable
          disabled={busy}
          onPress={onCancel}
          style={{
            flex: 1,
            height: 44,
            borderRadius: 11,
            borderWidth: 1.5,
            borderColor: '#CBD2DD',
            backgroundColor: '#FFFFFF',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 15, fontWeight: '600', color: INK }}>
            Keep going
          </Text>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={onConfirm}
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
            height: 44,
            borderRadius: 11,
            backgroundColor: INK,
            opacity: busy ? 0.6 : 1,
          }}
        >
          <OutlineIcon
            color="#FFFFFF"
            shapes={ICON_STOP}
            size={16}
            strokeWidth={2}
          />
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>
            {busy ? 'Ending…' : 'End beat'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function EndedCard({
  assignment,
  startedAt,
  endedAt,
}: {
  assignment: Assignment;
  startedAt: Date | null;
  endedAt: Date | null;
}) {
  const { counts } = assignment;
  const duration =
    startedAt && endedAt
      ? formatDuration(endedAt.getTime() - startedAt.getTime())
      : '';
  return (
    <View
      style={{
        backgroundColor: ENDED_BG,
        borderRadius: 18,
        padding: 16,
        gap: 12,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 10,
        }}
      >
        <View style={{ gap: 2, flexShrink: 1 }}>
          <Text style={{ fontSize: 13, color: ENDED_MUTED }}>
            {assignment.beatPlanName ?? 'Today'}
          </Text>
          <Text style={{ fontSize: 20, fontWeight: '700', color: '#FFFFFF' }}>
            Beat ended
          </Text>
          <Text
            style={{
              fontFamily: 'monospace',
              fontSize: 12,
              color: ENDED_MUTED,
            }}
          >
            {startedAt ? formatClock(startedAt) : '--:--'} →{' '}
            {endedAt ? formatClock(endedAt) : '--:--'} · {duration}
          </Text>
        </View>
        <Chip bg={ENDED_CHIP} fg="#FFFFFF" label="Closed" />
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <Stat label="Visited" muted={ENDED_MUTED} value={counts.visited} />
        <Stat label="Orders" muted={ENDED_MUTED} value={counts.orders} />
        <Stat label="No order" muted={ENDED_MUTED} value={counts.noOrder} />
        <Stat
          label="Not visited"
          muted={ENDED_MUTED}
          value={counts.notVisited}
        />
      </View>
    </View>
  );
}

/** FR-008: the two reasons must be distinguishable — they call for different actions. */
function NoBeatCard({
  reason,
}: {
  reason: 'NO_BEAT_PLAN' | 'NOT_A_WORKING_DAY' | null;
}) {
  const copy =
    reason === 'NOT_A_WORKING_DAY'
      ? {
          title: 'No beat today',
          body: 'Today is not a working day on your beat plan. Your list starts again on your next working day.',
        }
      : {
          title: 'No beat plan yet',
          body: 'You have not been assigned an active beat plan. Ask your administrator to set one up.',
        };
  return (
    <View
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 18,
        padding: 16,
        gap: 6,
        borderWidth: 1,
        borderColor: BORDER,
      }}
    >
      <Text style={{ fontSize: 19, fontWeight: '700', color: INK }}>
        {copy.title}
      </Text>
      <Text style={{ fontSize: 13, color: MUTED, lineHeight: 19 }}>
        {copy.body}
      </Text>
    </View>
  );
}

function StopRow({
  stop,
  locked,
  onPress,
}: {
  stop: Stop;
  locked: boolean;
  onPress: () => void;
}) {
  const isExtra = stop.source !== 'PLAN';
  const statusChip =
    stop.status === 'REVISIT' || isExtra
      ? { bg: CHIP_VIOLET_BG, fg: CHIP_VIOLET_FG }
      : { bg: CHIP_PENDING_BG, fg: CHIP_PENDING_FG };
  const statusLabel = isExtra
    ? 'Extra'
    : stop.status === 'REVISIT'
      ? 'Revisit'
      : stop.status === 'COMPLETED'
        ? 'Done'
        : 'Pending';
  const pinOk = stop.shop.pinStatus === 'APPROVED';

  return (
    <Pressable
      disabled={locked}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        gap: 12,
        padding: 14,
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: BORDER,
        opacity: locked ? 0.75 : 1,
      }}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          backgroundColor: CHIP_NEUTRAL_BG,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 15, fontWeight: '700', color: INK }}>
          {isExtra ? 'EX' : String(stop.sequence + 1).padStart(2, '0')}
        </Text>
      </View>

      <View style={{ flexGrow: 1, flexShrink: 1, gap: 6 }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Text
            numberOfLines={1}
            style={{
              fontSize: 16,
              fontWeight: '700',
              color: INK,
              flexShrink: 1,
            }}
          >
            {stop.shop.name}
          </Text>
          <Chip bg={statusChip.bg} fg={statusChip.fg} label={statusLabel} />
        </View>

        <Text numberOfLines={1} style={{ fontSize: 13, color: MUTED }}>
          {stop.shop.addressLine ?? ''}
        </Text>

        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <Chip
            bg={pinOk ? CHIP_PIN_OK_BG : CHIP_PIN_MISSING_BG}
            fg={pinOk ? CHIP_PIN_OK_FG : CHIP_PIN_MISSING_FG}
            label={pinOk ? 'Pin saved' : 'No pin yet — capture first'}
          />
          {/* Until visit history exists this is always the design's own
              "First visit" wording, which is literally true today. */}
          <Chip
            bg={CHIP_NEUTRAL_BG}
            fg="#3A4353"
            label={stop.previousOutcome ?? 'First visit'}
          />
        </View>
      </View>
    </Pressable>
  );
}

/**
 * The waiting-to-sync strip's copy.
 *
 * 007-extra-shops: the queue can now hold an extra-shop add as well as a
 * visit and a pin, so the strip names what is actually waiting. A queued add
 * matters to the executive for a reason a queued visit does not — the stop
 * does not exist on today's list yet and cannot be opened until it syncs,
 * because the id a visit is recorded against is the server's (FR-023/FR-024,
 * research.md §9). Saying "N visits" when a shop is waiting would hide that.
 */
function waitingLabel(held: HeldSubmission[]): string {
  const shops = held.filter((item) => item.kind === 'STOP').length;
  const others = held.length - shops;
  const parts: string[] = [];
  if (others > 0) {
    parts.push(`${others} visit${others === 1 ? '' : 's'}`);
  }
  if (shops > 0) {
    parts.push(`${shops} extra shop${shops === 1 ? '' : 's'}`);
  }
  const subject = parts.join(' and ');
  const tail =
    shops > 0
      ? ' They are saved on your phone. An extra shop can be opened once it has synced.'
      : ' They are saved on your phone.';
  return `${subject} waiting to sync.${tail}`;
}

function LockedStrip({ text }: { text: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 11,
        paddingHorizontal: 14,
        borderRadius: 14,
        backgroundColor: LOCKED_BG,
      }}
    >
      <OutlineIcon color={LOCKED_INK} shapes={ICON_LOCK} size={18} />
      <Text
        style={{
          fontSize: 13,
          lineHeight: 18,
          color: LOCKED_INK,
          flexShrink: 1,
        }}
      >
        {text}
      </Text>
    </View>
  );
}

function FilterTab({
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
        height: 38,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? '#FFFFFF' : 'transparent',
      }}
    >
      <Text
        style={{ fontSize: 14, fontWeight: '600', color: active ? INK : MUTED }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Stat({
  value,
  label,
  muted = ON_BLUE_MUTED,
}: {
  value: number;
  label: string;
  muted?: string;
}) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>
        {value}
      </Text>
      <Text style={{ fontSize: 12, color: muted }}>{label}</Text>
    </View>
  );
}

function Chip({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
        backgroundColor: bg,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: '600', color: fg }}>
        {label}
      </Text>
    </View>
  );
}

function initials(name: string | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]?.charAt(0) ?? '';
  const last =
    words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? '') : '';
  return (first + last).toUpperCase();
}

function messageFor(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return 'Something went wrong at our end. Try again in a moment.';
}
