import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, apiRequest, generateIdempotencyKey } from '../../api/client';
import {
  OutlineIcon,
  type IconShape,
} from '../../components/icons/OutlineIcon';
import type { AdminStackParamList } from '../../navigation/RootNavigator';
import { BG, BLUE, BORDER, INK, LABEL, MUTED } from './adminDesign';

/**
 * PRD §4 screen 4.13 ("Monthly salary run"), board uuid
 * `1f09a706-a34a-4b97-af17-7242955c3743` (012-monthly-salary-run).
 *
 * Every hex, radius, size and weight below is taken verbatim from that board.
 *
 * **The device computes no money.** Every figure arrives from the server as a
 * decimal STRING and is rendered as given: a float round-trip through
 * `JSON.parse` is exactly what SC-004 and SC-005 cannot tolerate, and the
 * server is the only thing allowed to know what a salary is (Constitution
 * rule 1).
 */

/** Board 4.13's own palette, beyond the shared admin tokens. */
const CARD_INK = '#141A26';
const CARD_SUBTLE = '#C4CBD8';
const ROW_SEPARATOR = '#ECEFF4';
const CHIP_DRAFT_BG = '#EFE9FB';
const CHIP_DRAFT_FG = '#5B2FA6';
const CHIP_FINAL_BG = '#E3EBFC';
const CHIP_FINAL_FG = '#1E3A8A';
const NOTICE_BG = '#FCEFD9';
const NOTICE_FG = '#6B3904';

const ICON_BACK: IconShape[] = [{ d: 'M15 18l-6-6 6-6' }];
// Board 4.13's own lock: <rect x=5 y=11 w=14 h=10 rx=2> + the shackle path.
const ICON_LOCK: IconShape[] = [
  { rect: [5, 11, 14, 10, 2] },
  { d: 'M8 11V8a4 4 0 0 1 8 0v3' },
];
const ICON_CSV: IconShape[] = [{ d: 'M12 3v12M7 10l5 5 5-5M4 21h16' }];
// Re-run. A circular arrow: the same "do it again" gesture the rest of the
// app uses for pull-to-refresh, drawn as an explicit control because a
// salary run is a command rather than a read.
const ICON_RERUN: IconShape[] = [
  { d: 'M20 11a8 8 0 1 0-2.3 5.7' },
  { d: 'M20 5v6h-6' },
];

interface BreakdownEntry {
  from: string;
  to: string;
  units: string;
  rate: string | null;
  amount: string;
}

interface SalaryLine {
  userId: string;
  employeeName: string;
  payableUnits: string;
  amount: string;
  breakdown: BreakdownEntry[];
}

interface SalaryRunResponse {
  period: { year: number; month: number; label: string };
  run: {
    id: string;
    status: 'DRAFT' | 'FINALISED';
    version: number;
    grossTotal: string;
    employeeCount: number;
    generatedAt: string;
    generatedByName: string | null;
    finalisedAt: string | null;
    finalisedByName: string | null;
    lines: SalaryLine[];
  } | null;
  unmarkedSessionCount: number;
  canFinalise: boolean;
}

/** `81700.00` → `81,700` — Indian grouping, display only. */
function formatAmount(decimalString: string): string {
  const whole = decimalString.split('.')[0] ?? '0';
  const negative = whole.startsWith('-');
  const digits = negative ? whole.slice(1) : whole;
  if (digits.length <= 3) return `${negative ? '-' : ''}₹${digits}`;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}₹${grouped},${last3}`;
}

/** `8.00` → `8`, `7.50` → `7.5` — trailing zeros read as noise on a half-day count. */
function formatUnits(decimalString: string): string {
  return decimalString.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

/** Board 4.13's sub-line, e.g. `1–10 Aug · 20 × ₹400 = ₹8,000`. */
function describeEntry(entry: BreakdownEntry): string {
  const units = formatUnits(entry.units);
  if (entry.rate === null) {
    // FR-021: the units are shown and visibly unpriced. Never "₹0", which
    // would read as a computed answer rather than a missing rate.
    return `${entry.from} – ${entry.to} · ${units} half-days · no rate on file`;
  }
  return `${entry.from} – ${entry.to} · ${units} × ${formatAmount(entry.rate)} = ${formatAmount(entry.amount)}`;
}

export function SalaryRunScreen() {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<
      NativeStackNavigationProp<AdminStackParamList, 'SalaryRun'>
    >();

  const [data, setData] = useState<SalaryRunResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleNote, setStaleNote] = useState<string | null>(null);

  /**
   * Read in the catch to tell "a refresh failed over a run already on
   * screen" from "the first load failed". A ref rather than the state,
   * because `load` must not be recreated when `data` changes — it is called
   * from `useFocusEffect`, and a changing identity there would re-fetch on
   * every render. The same reason `visitsListShared.tsx` keeps its own
   * `loadedCount` ref.
   */
  const hasData = useRef(false);

  const load = useCallback(async () => {
    try {
      const next = await apiRequest<SalaryRunResponse>('/salary-runs');
      setData(next);
      hasData.current = true;
      setError(null);
      setStaleNote(null);
    } catch (err) {
      // Keep whatever is on screen and say it is not fresh; only a first
      // load with nothing to show becomes an error (Constitution rule 7).
      if (hasData.current) {
        setStaleNote('Showing saved data — could not refresh.');
      } else {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Could not load the salary run.',
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const run = data?.run ?? null;
  const periodLabel = data?.period.label ?? '';
  const monthName = periodLabel.split(' ')[0] ?? 'this month';

  async function generate(): Promise<void> {
    if (!data || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await apiRequest<SalaryRunResponse>('/salary-runs', {
        method: 'POST',
        body: { year: data.period.year, month: data.period.month },
        idempotencyKey: generateIdempotencyKey(),
      });
      setData(next);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not run the salary.',
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * FR-026: the confirmation states what will be locked — and FR-025 puts the
   * unmarked-session count in front of the admin first, because finalising
   * over a forgotten day costs an employee money silently and this is the
   * last moment anyone would notice.
   */
  function confirmFinalise(): void {
    if (!run || !data) return;
    const unmarked = data.unmarkedSessionCount;
    const warning =
      unmarked > 0
        ? `\n\n${unmarked} session${unmarked === 1 ? '' : 's'} in ${monthName} ${unmarked === 1 ? 'was' : 'were'} never marked and ${unmarked === 1 ? 'counts' : 'count'} as unpaid. You can still finalise.`
        : '';
    Alert.alert(
      `Finalize ${monthName}?`,
      `This locks ${periodLabel} at ${formatAmount(run.grossTotal)}. Later attendance corrections create a new version; v${run.version} stays on record.${warning}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Finalize', style: 'default', onPress: () => void finalise() },
      ],
    );
  }

  async function finalise(): Promise<void> {
    if (!run || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await apiRequest<SalaryRunResponse>(
        `/salary-runs/${run.id}/finalise`,
        {
          method: 'POST',
          body: {},
          idempotencyKey: generateIdempotencyKey(),
        },
      );
      setData(next);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not finalise the run.',
      );
    } finally {
      setBusy(false);
    }
  }

  const isFinalised = run?.status === 'FINALISED';

  /**
   * Whether the footer is carrying three controls instead of the board's two.
   *
   * Board 4.13 draws CSV and the primary action as equal halves, and that is
   * what ships whenever there are only two. Adding the re-run button made
   * three share 350dp, which left the primary ~139dp — not enough for
   * "Finalize September…" at 15px/700, so it wrapped to two lines and lost
   * its centring. In the three-control state CSV therefore takes only the
   * width its own label needs and the primary keeps the rest.
   */
  const hasRerun = run !== null && !isFinalised;

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      {/* Header — board 4.13: 52px top padding, 44px back tile, 13px
          subtitle over a 22px/700 title, status chip on the right. */}
      <View
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 20,
          paddingBottom: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Pressable
          accessibilityLabel="Back"
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
          }}
        >
          <OutlineIcon
            color={INK}
            shapes={ICON_BACK}
            size={20}
            strokeWidth={2}
          />
        </Pressable>
        <View style={{ flex: 1, flexShrink: 1 }}>
          <Text style={{ fontSize: 13, color: MUTED }}>Salary run</Text>
          <Text
            numberOfLines={1}
            style={{ fontSize: 22, fontWeight: '700', color: INK }}
          >
            {periodLabel || 'Salary run'}
          </Text>
        </View>
        {run ? (
          <View
            style={{
              height: 24,
              paddingHorizontal: 9,
              borderRadius: 999,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: isFinalised ? CHIP_FINAL_BG : CHIP_DRAFT_BG,
            }}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: '700',
                color: isFinalised ? CHIP_FINAL_FG : CHIP_DRAFT_FG,
              }}
            >
              {isFinalised ? 'Finalised' : 'Draft'} · v{run.version}
            </Text>
          </View>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: 24,
          gap: 14,
        }}
      >
        {loading && !data ? (
          <View style={{ paddingVertical: 48, alignItems: 'center' }}>
            <ActivityIndicator color={BLUE} />
          </View>
        ) : null}

        {staleNote ? (
          <Text style={{ fontSize: 12, color: MUTED }}>{staleNote}</Text>
        ) : null}
        {error ? (
          <Text style={{ fontSize: 13, color: NOTICE_FG }}>{error}</Text>
        ) : null}

        {run ? (
          <>
            {/* The dark summary card — #141A26, radius 18, padding 16. */}
            <View
              style={{
                backgroundColor: CARD_INK,
                borderRadius: 18,
                padding: 16,
                gap: 6,
              }}
            >
              <Text style={{ fontSize: 13, color: CARD_SUBTLE }}>
                Gross attendance salary · {run.employeeCount}{' '}
                {run.employeeCount === 1 ? 'employee' : 'employees'}
              </Text>
              <Text
                style={{ fontSize: 34, fontWeight: '700', color: '#FFFFFF' }}
              >
                {formatAmount(run.grossTotal)}
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  color: CARD_SUBTLE,
                  fontFamily: 'monospace',
                }}
              >
                salary = payable half-days × half-day rate
              </Text>
            </View>

            <View style={{ gap: 8 }}>
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: '700',
                  letterSpacing: 0.72,
                  color: MUTED,
                }}
              >
                BY EMPLOYEE
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
                {run.lines.map((line, index) => (
                  <Pressable
                    key={line.userId}
                    onPress={() =>
                      navigation.navigate('SalaryEmployeeDetail', {
                        runId: run.id,
                        userId: line.userId,
                      })
                    }
                    style={{
                      paddingVertical: 12,
                      paddingHorizontal: 14,
                      gap: 4,
                      borderBottomWidth: index === run.lines.length - 1 ? 0 : 1,
                      borderBottomColor: ROW_SEPARATOR,
                    }}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                      }}
                    >
                      <Text
                        style={{ fontSize: 15, fontWeight: '700', color: INK }}
                      >
                        {line.employeeName}
                      </Text>
                      <Text
                        style={{
                          fontSize: 15,
                          fontWeight: '700',
                          color: INK,
                          fontFamily: 'monospace',
                        }}
                      >
                        {formatAmount(line.amount)}
                      </Text>
                    </View>
                    {line.breakdown.map((entry, entryIndex) => (
                      <Text
                        key={`${entry.from}-${entryIndex}`}
                        style={{
                          fontSize: 12,
                          color: entry.rate === null ? NOTICE_FG : LABEL,
                          fontFamily: 'monospace',
                        }}
                      >
                        {describeEntry(entry)}
                      </Text>
                    ))}
                  </Pressable>
                ))}
              </View>
            </View>

            {/* The amber lock notice. Board 4.13's wording is written for the
                DRAFT state; the finalised wording is new copy in the same
                register, because the board carries no finalised variant. */}
            <View
              style={{
                flexDirection: 'row',
                gap: 10,
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderRadius: 14,
                backgroundColor: NOTICE_BG,
              }}
            >
              <OutlineIcon
                color={NOTICE_FG}
                shapes={ICON_LOCK}
                size={20}
                strokeWidth={1.8}
              />
              <Text
                style={{
                  flex: 1,
                  fontSize: 13,
                  lineHeight: 19,
                  color: NOTICE_FG,
                }}
              >
                {isFinalised
                  ? `${monthName} is locked at v${run.version}. Attendance can still be corrected; a correction needs a new version, and v${run.version} stays on record.`
                  : `Finalizing locks ${monthName}. Later attendance corrections create a new version (v${run.version + 1}); v${run.version} stays on record.`}
              </Text>
            </View>

            {data && data.unmarkedSessionCount > 0 && !isFinalised ? (
              <Text style={{ fontSize: 12, color: NOTICE_FG }}>
                {data.unmarkedSessionCount} session
                {data.unmarkedSessionCount === 1 ? '' : 's'} not marked — these
                count as unpaid.
              </Text>
            ) : null}
          </>
        ) : null}

        {!loading && !run && !error ? (
          <View style={{ paddingVertical: 32, gap: 12 }}>
            <Text style={{ fontSize: 14, lineHeight: 21, color: LABEL }}>
              No salary run for {periodLabel} yet. Running it reads the
              attendance the managers recorded and works out what each person is
              owed.
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Footer — white, 1px top border, two 52px buttons. */}
      <View
        style={{
          paddingTop: 12,
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 18,
          backgroundColor: '#FFFFFF',
          borderTopWidth: 1,
          borderTopColor: BORDER,
          flexDirection: 'row',
          gap: 10,
        }}
      >
        <Pressable
          accessibilityLabel="Export CSV"
          onPress={() =>
            // Rendered exactly as board 4.13 designs it, and deliberately not
            // wired: CSV export belongs with the slice that carries the
            // audit-trail requirement for exports. The "coming in a later
            // update" alert is this app's own convention for a
            // designed-but-unbuilt affordance (AdminBottomNav did the same
            // for three tabs), and it leaves ONE call site for that slice to
            // replace. Omitting the button would diverge from the board.
            Alert.alert('CSV export', 'CSV export is coming in a later update.')
          }
          style={{
            ...(hasRerun ? { paddingHorizontal: 18 } : { flex: 1 }),
            height: 52,
            borderRadius: 14,
            borderWidth: 1.5,
            borderColor: CARD_INK,
            backgroundColor: '#FFFFFF',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <OutlineIcon
            color={CARD_INK}
            shapes={ICON_CSV}
            size={18}
            strokeWidth={1.8}
          />
          <Text style={{ fontSize: 15, fontWeight: '600', color: CARD_INK }}>
            CSV
          </Text>
        </Pressable>

        {/*
          Re-run, and ONLY while the run is a draft.

          A draft is working material: its figures can still be wrong for
          reasons outside this screen — a rate that was never set, a day
          sheet filled in after the run — and without this the only way
          forward from a bad draft was to FINALISE it, which is the one
          action that cannot be undone.

          It disappears the moment the month is finalised, deliberately. A
          locked month is not refreshable, and a control that looks like a
          refresh must never be the thing that quietly creates a new
          version — that stays an explicit, labelled button (FR-030).

          In the footer rather than the header because every other run-level
          command is here, and because board 4.13's header is already full
          at 390px: a third control there would ellipsize "September 2026".
        */}
        {run && !isFinalised ? (
          <Pressable
            accessibilityLabel={`Re-run ${monthName}`}
            disabled={busy}
            onPress={() => void generate()}
            style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              borderWidth: 1.5,
              borderColor: CARD_INK,
              backgroundColor: '#FFFFFF',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: busy ? 0.5 : 1,
            }}
          >
            {busy ? (
              <ActivityIndicator color={CARD_INK} size="small" />
            ) : (
              <OutlineIcon
                color={CARD_INK}
                shapes={ICON_RERUN}
                size={20}
                strokeWidth={1.8}
              />
            )}
          </Pressable>
        ) : null}

        <Pressable
          accessibilityLabel={
            run && !isFinalised ? `Finalize ${monthName}` : `Run ${monthName}`
          }
          disabled={busy}
          onPress={() =>
            run && !isFinalised ? confirmFinalise() : void generate()
          }
          style={{
            flex: 1,
            height: 52,
            borderRadius: 14,
            backgroundColor: BLUE,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 8,
            opacity: busy ? 0.6 : 1,
          }}
        >
          {/*
            `numberOfLines` and `textAlign` together, not either alone: a
            wrapped label here was ALSO left-aligned, because the wrap
            happens inside the Text and the parent's `alignItems` centres
            the box rather than the lines within it. Both are needed for
            the label to stay one centred line at every footer width.
          */}
          <Text
            numberOfLines={1}
            style={{
              fontSize: 15,
              fontWeight: '700',
              color: '#FFFFFF',
              textAlign: 'center',
            }}
          >
            {busy
              ? 'Working…'
              : !run
                ? `Run ${monthName}`
                : isFinalised
                  ? // FR-030: only finalisation creates a version boundary,
                    // so this reads as a NEW VERSION rather than a re-run.
                    `New version (v${run.version + 1})`
                  : `Finalize ${monthName}…`}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
