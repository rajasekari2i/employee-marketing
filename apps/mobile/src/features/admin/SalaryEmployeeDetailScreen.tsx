import { useCallback, useState } from 'react';
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
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, apiRequest } from '../../api/client';
import { API_URL } from '../../config';
import {
  OutlineIcon,
  type IconShape,
} from '../../components/icons/OutlineIcon';
import type { AdminStackParamList } from '../../navigation/RootNavigator';
import { BG, BLUE, BORDER, INK, LABEL, MUTED } from './adminDesign';

/**
 * One employee's month (012-monthly-salary-run, US3).
 *
 * **This screen has NO board.** It is the only screen in the product without
 * a design reference, and FR-047 permits designing it on the user's explicit
 * instruction ("this page is not in the design but follow the same UI").
 *
 * It therefore borrows board 4.13's own shapes rather than inventing a style:
 * the same dark `#141A26` summary card for the total, the same white
 * `#FFFFFF`/`#DFE4EC` card with `#ECEFF4` row separators for each section,
 * the same monospace treatment for figures, the same 44px back tile. Nothing
 * here is a new visual idea.
 *
 * **Read-only by requirement, not by omission** (FR-039): there is
 * deliberately no control that edits attendance, a rate or a figure.
 */

const CARD_INK = '#141A26';
const CARD_SUBTLE = '#C4CBD8';
const ROW_SEPARATOR = '#ECEFF4';
const CHIP_DRAFT_BG = '#EFE9FB';
const CHIP_DRAFT_FG = '#5B2FA6';
const CHIP_FINAL_BG = '#E3EBFC';
const CHIP_FINAL_FG = '#1E3A8A';
const NOTICE_BG = '#FCEFD9';
const NOTICE_FG = '#6B3904';
const PAID_FG = '#1E6F3C';

const ICON_BACK: IconShape[] = [{ d: 'M15 18l-6-6 6-6' }];
const ICON_DOWNLOAD: IconShape[] = [{ d: 'M12 3v12M7 10l5 5 5-5M4 21h16' }];

interface BreakdownEntry {
  from: string;
  to: string;
  units: string;
  rate: string | null;
  amount: string;
}

interface LineDetail {
  employeeName: string;
  period: { year: number; month: number; label: string };
  run: { id: string; status: 'DRAFT' | 'FINALISED'; version: number };
  payableUnits: string;
  amount: string;
  breakdown: BreakdownEntry[];
  unpaidSessions: Array<{
    businessDate: string;
    session: string;
    status: string;
  }>;
  paidNonWorking: Array<{
    businessDate: string;
    session: string;
    status: string;
  }>;
  lateSessions: Array<{
    businessDate: string;
    session: string;
    latenessFlag: string;
  }>;
  unmarkedSessions: Array<{ businessDate: string; session: string }>;
  payslipUrl: string;
}

function formatAmount(decimalString: string): string {
  const whole = decimalString.split('.')[0] ?? '0';
  const negative = whole.startsWith('-');
  const digits = negative ? whole.slice(1) : whole;
  if (digits.length <= 3) return `${negative ? '-' : ''}₹${digits}`;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  return `${negative ? '-' : ''}₹${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
}

function formatUnits(value: string): string {
  return value.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

const SESSION_LABEL: Record<string, string> = {
  MORNING: 'Morning',
  EVENING: 'Evening',
};

const STATUS_LABEL: Record<string, string> = {
  ABSENT: 'Absent',
  LEAVE: 'Leave',
  HOLIDAY: 'Holiday',
  WEEKLY_OFF: 'Weekly off',
  PRESENT: 'Present',
};

const LATENESS_LABEL: Record<string, string> = {
  DELAY_1H: 'about an hour late',
  DELAY_2H: 'about two hours late',
  ON_TIME: 'on time',
};

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text
        style={{
          fontSize: 12,
          fontWeight: '700',
          letterSpacing: 0.72,
          color: MUTED,
        }}
      >
        {title.toUpperCase()}
      </Text>
      {subtitle ? (
        <Text style={{ fontSize: 12, color: LABEL }}>{subtitle}</Text>
      ) : null}
      <View
        style={{
          backgroundColor: '#FFFFFF',
          borderWidth: 1,
          borderColor: BORDER,
          borderRadius: 16,
          overflow: 'hidden',
        }}
      >
        {children}
      </View>
    </View>
  );
}

function Row({
  left,
  right,
  rightColor,
  last,
}: {
  left: string;
  right: string;
  rightColor?: string;
  last: boolean;
}) {
  return (
    <View
      style={{
        paddingVertical: 11,
        paddingHorizontal: 14,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: ROW_SEPARATOR,
      }}
    >
      <Text style={{ fontSize: 14, color: INK, flexShrink: 1 }}>{left}</Text>
      <Text
        style={{
          fontSize: 13,
          fontWeight: '600',
          color: rightColor ?? LABEL,
          fontFamily: 'monospace',
        }}
      >
        {right}
      </Text>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <View style={{ paddingVertical: 11, paddingHorizontal: 14 }}>
      <Text style={{ fontSize: 13, color: LABEL }}>{text}</Text>
    </View>
  );
}

export function SalaryEmployeeDetailScreen() {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<
      NativeStackNavigationProp<AdminStackParamList, 'SalaryEmployeeDetail'>
    >();
  const route =
    useRoute<RouteProp<AdminStackParamList, 'SalaryEmployeeDetail'>>();
  const { runId, userId } = route.params;

  const [detail, setDetail] = useState<LineDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        try {
          const next = await apiRequest<LineDetail>(
            `/salary-runs/${runId}/lines/${userId}`,
          );
          if (!cancelled) {
            setDetail(next);
            setError(null);
          }
        } catch (err) {
          if (!cancelled) {
            setError(
              err instanceof ApiError
                ? err.message
                : 'Could not load this employee.',
            );
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [runId, userId]),
  );

  /**
   * Opens the payslip with the OS, not in the app.
   *
   * **No new dependency on purpose**: `react-native-fs` and
   * `react-native-share` would each mean another Android rebuild, and the
   * server already serves the PDF behind a signed token precisely so a plain
   * browser can fetch it without an `Authorization` header.
   */
  async function openPayslip(): Promise<void> {
    if (!detail) return;
    // `payslipUrl` is server-relative; `API_URL` ends with `/api/v1`, which
    // the path already carries, so trim it rather than doubling it.
    const origin = API_URL.replace(/\/api\/v1\/?$/, '');
    const url = `${origin}${detail.payslipUrl}`;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(
        'Could not open the payslip',
        'Nothing on this device could open the PDF.',
      );
    }
  }

  const isFinalised = detail?.run.status === 'FINALISED';

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
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
          accessibilityLabel="Back to the salary run"
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
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, color: MUTED }}>
            {detail?.period.label ?? 'Salary'}
          </Text>
          <Text
            numberOfLines={1}
            style={{ fontSize: 22, fontWeight: '700', color: INK }}
          >
            {detail?.employeeName ?? ''}
          </Text>
        </View>
        {detail ? (
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
              {isFinalised ? 'Finalised' : 'Draft'} · v{detail.run.version}
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
        {loading && !detail ? (
          <View style={{ paddingVertical: 48, alignItems: 'center' }}>
            <ActivityIndicator color={BLUE} />
          </View>
        ) : null}
        {error ? (
          <Text style={{ fontSize: 13, color: NOTICE_FG }}>{error}</Text>
        ) : null}

        {detail ? (
          <>
            <View
              style={{
                backgroundColor: CARD_INK,
                borderRadius: 18,
                padding: 16,
                gap: 6,
              }}
            >
              <Text style={{ fontSize: 13, color: CARD_SUBTLE }}>
                {formatUnits(detail.payableUnits)} payable half-days
              </Text>
              <Text
                style={{ fontSize: 34, fontWeight: '700', color: '#FFFFFF' }}
              >
                {formatAmount(detail.amount)}
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

            {/* FR-037: the rate ranges, summing to the total. */}
            <Section title="How this was worked out">
              {detail.breakdown.map((entry, index) => (
                <Row
                  key={`${entry.from}-${index}`}
                  last={index === detail.breakdown.length - 1}
                  left={
                    entry.rate === null
                      ? `${entry.from} – ${entry.to} · ${formatUnits(entry.units)} half-days · no rate on file`
                      : `${entry.from} – ${entry.to} · ${formatUnits(entry.units)} × ${formatAmount(entry.rate)}`
                  }
                  right={
                    entry.rate === null
                      ? 'unpriced'
                      : formatAmount(entry.amount)
                  }
                  rightColor={entry.rate === null ? NOTICE_FG : INK}
                />
              ))}
            </Section>

            {/* FR-034. */}
            <Section title="Unpaid sessions">
              {detail.unpaidSessions.length === 0 ? (
                <Empty text="None — every marked session was payable." />
              ) : (
                detail.unpaidSessions.map((row, index) => (
                  <Row
                    key={`${row.businessDate}-${row.session}`}
                    last={index === detail.unpaidSessions.length - 1}
                    left={`${row.businessDate} · ${SESSION_LABEL[row.session] ?? row.session}`}
                    right={STATUS_LABEL[row.status] ?? row.status}
                    rightColor={NOTICE_FG}
                  />
                ))
              )}
            </Section>

            {/* FR-035: shown explicitly as PAID, so a holiday is visibly
                accounted for rather than looking like a gap in the month. */}
            <Section title="Paid non-working days">
              {detail.paidNonWorking.length === 0 ? (
                <Empty text="None this month." />
              ) : (
                detail.paidNonWorking.map((row, index) => (
                  <Row
                    key={`${row.businessDate}-${row.session}`}
                    last={index === detail.paidNonWorking.length - 1}
                    left={`${row.businessDate} · ${SESSION_LABEL[row.session] ?? row.session}`}
                    right={`${STATUS_LABEL[row.status] ?? row.status} · paid`}
                    rightColor={PAID_FG}
                  />
                ))
              )}
            </Section>

            {/* FR-038: listed, never invisible — a forgotten session costs
                money and must be visible where the money is explained. */}
            <Section title="Not marked">
              {detail.unmarkedSessions.length === 0 ? (
                <Empty text="Every session this month was marked." />
              ) : (
                detail.unmarkedSessions.map((row, index) => (
                  <Row
                    key={`${row.businessDate}-${row.session}`}
                    last={index === detail.unmarkedSessions.length - 1}
                    left={`${row.businessDate} · ${SESSION_LABEL[row.session] ?? row.session}`}
                    right="counts as unpaid"
                    rightColor={NOTICE_FG}
                  />
                ))
              )}
            </Section>

            {/* FR-036 + FR-018. The statement is LOAD-BEARING: this is where
                an admin would otherwise infer a deduction from seeing a
                lateness flag beside a pay figure (BUS-18, OD-01). */}
            <Section
              title="Late arrivals"
              subtitle="Lateness is recorded for review. It does not reduce pay."
            >
              {detail.lateSessions.length === 0 ? (
                <Empty text="No late arrivals this month." />
              ) : (
                detail.lateSessions.map((row, index) => (
                  <Row
                    key={`${row.businessDate}-${row.session}`}
                    last={index === detail.lateSessions.length - 1}
                    left={`${row.businessDate} · ${SESSION_LABEL[row.session] ?? row.session}`}
                    right={LATENESS_LABEL[row.latenessFlag] ?? row.latenessFlag}
                    rightColor={NOTICE_FG}
                  />
                ))
              )}
            </Section>

            {!isFinalised ? (
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
                <Text
                  style={{
                    flex: 1,
                    fontSize: 13,
                    lineHeight: 19,
                    color: NOTICE_FG,
                  }}
                >
                  This month is still a draft (v{detail.run.version}). The
                  figures above are from that run; the attendance beneath them
                  is as it stands now.
                </Text>
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      {detail ? (
        <View
          style={{
            paddingTop: 12,
            paddingHorizontal: 20,
            paddingBottom: insets.bottom + 18,
            backgroundColor: '#FFFFFF',
            borderTopWidth: 1,
            borderTopColor: BORDER,
          }}
        >
          <Pressable
            accessibilityLabel="Download payslip"
            onPress={() => void openPayslip()}
            style={{
              height: 52,
              borderRadius: 14,
              backgroundColor: BLUE,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <OutlineIcon
              color="#FFFFFF"
              shapes={ICON_DOWNLOAD}
              size={18}
              strokeWidth={1.8}
            />
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>
              Payslip PDF
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
