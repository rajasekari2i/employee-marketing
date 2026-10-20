import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { apiRequest } from '../../api/client';
import { ManagerBottomNav } from '../../components/ManagerBottomNav';
import {
  OutlineIcon,
  type IconShape,
} from '../../components/icons/OutlineIcon';
import type { ManagerStackParamList } from '../../navigation/RootNavigator';
import {
  ATT_ABSENT_BG,
  ATT_ABSENT_FG,
  ATT_LATE_BG,
  ATT_LATE_FG,
  ATT_NEUTRAL_BG,
  ATT_NEUTRAL_FG,
  ATT_PRESENT_BG,
  ATT_PRESENT_FG,
  ATT_UNMARKED_BG,
  BG,
  BLUE,
  BORDER,
  INK,
  LABEL,
  MUTED,
  ROW_SEPARATOR,
} from './managerDesign';
import { describeFailure, LoadNotice } from './loadState';

/**
 * PRD §4 screen 3.7 ("Attendance · day sheet"), board uuid
 * `71422460-a9d0-432c-bcf8-c0de656d0094` (010-manager-app).
 *
 * **Every cell's state is given by TEXT as well as colour** (FR-039). That
 * is an accessibility requirement, not a preference — a colour-only cell is
 * unreadable to a manager with a colour vision deficiency, and attendance
 * is what pay is computed from.
 *
 * The roster is every active member of staff except the System Admin, so a
 * manager appears on their own sheet (FR-040a).
 */

const ICON_PREV: IconShape[] = [{ d: 'M15 18l-6-6 6-6' }];
const ICON_NEXT: IconShape[] = [{ d: 'M9 6l6 6-6 6' }];

type Status = 'PRESENT' | 'ABSENT' | 'LEAVE' | 'HOLIDAY' | 'WEEKLY_OFF';

export interface Cell {
  status: Status;
  actualTime: string | null;
  latenessFlag: 'ON_TIME' | 'DELAY_1H' | 'DELAY_2H' | null;
  recordedByName: string | null;
  recordedAt: string;
  version: number;
}

interface DaySheet {
  businessDate: string;
  isToday: boolean;
  isFuture: boolean;
  counts: {
    present: number;
    late: number;
    absentOrLeave: number;
    notMarked: number;
  };
  people: Array<{
    userId: string;
    name: string;
    roleLabel: string;
    morning: Cell | null;
    evening: Cell | null;
  }>;
}

export function AttendanceDayScreen() {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<
      NativeStackNavigationProp<ManagerStackParamList, 'AttendanceDay'>
    >();

  const [date, setDate] = useState<string | null>(null);
  const [data, setData] = useState<DaySheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [staleNote, setStaleNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read in the catch, where the state `load` closed over may be stale.
  const sheetRef = useRef<DaySheet | null>(null);
  sheetRef.current = data;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = date ? `?date=${date}` : '';
      const next = await apiRequest<DaySheet>(`/attendance${query}`);
      setData(next);
      setDate(next.businessDate);
      setStaleNote(null);
      setError(null);
    } catch (err) {
      // `data` is only kept when it is still the SAME day. A failed load
      // after stepping to another date must not leave yesterday's marks on
      // screen under today's heading — that sheet is the record a salary
      // run is built from, so a wrong date is worse than no sheet.
      const sameDay = sheetRef.current?.businessDate === date;
      const failure = describeFailure(err, 'the day sheet', sameDay);
      if (!sameDay) {
        setData(null);
      }
      setStaleNote(failure.staleNote);
      setError(failure.error);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function shiftDay(days: number): void {
    if (!data) return;
    const d = new Date(`${data.businessDate}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + days);
    setDate(d.toISOString().slice(0, 10));
  }

  useEffect(() => {
    if (date) void load();
  }, [date]);

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
        <Text style={{ fontSize: 28, fontWeight: '700', color: INK }}>
          Attendance
        </Text>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <StepButton
            icon={ICON_PREV}
            label="Previous day"
            onPress={() => shiftDay(-1)}
          />
          <View style={{ alignItems: 'center', flexGrow: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: INK }}>
              {data ? formatFullDay(data.businessDate) : ' '}
            </Text>
            {data?.isToday ? (
              <Text style={{ fontSize: 12, fontWeight: '700', color: BLUE }}>
                Today
              </Text>
            ) : null}
          </View>
          <StepButton
            icon={ICON_NEXT}
            label="Next day"
            onPress={() => shiftDay(1)}
          />
        </View>

        {data ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Count label="Present" value={data.counts.present} />
            <Count label="Late" value={data.counts.late} />
            <Count label="Absent / leave" value={data.counts.absentOrLeave} />
            <Count label="Not marked" value={data.counts.notMarked} />
          </View>
        ) : null}

        {data?.isFuture ? (
          <Text style={{ fontSize: 13, color: LABEL }}>
            This day has not happened yet, so attendance cannot be recorded.
          </Text>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: 84 + insets.bottom + 16,
          gap: 8,
        }}
      >
        {loading && !data ? (
          <View style={{ paddingVertical: 48, alignItems: 'center' }}>
            <ActivityIndicator color={BLUE} />
          </View>
        ) : null}
        <LoadNotice error={error} staleNote={staleNote} />

        {data ? (
          <View
            style={{
              backgroundColor: '#FFFFFF',
              borderWidth: 1,
              borderColor: BORDER,
              borderRadius: 16,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                paddingVertical: 9,
                paddingHorizontal: 14,
                borderBottomWidth: 1,
                borderBottomColor: ROW_SEPARATOR,
              }}
            >
              <Text
                style={{
                  flex: 2,
                  fontSize: 12,
                  fontWeight: '700',
                  color: MUTED,
                }}
              >
                Employee
              </Text>
              <Text
                style={{
                  flex: 1,
                  fontSize: 12,
                  fontWeight: '700',
                  color: MUTED,
                }}
              >
                Morning
              </Text>
              <Text
                style={{
                  flex: 1,
                  fontSize: 12,
                  fontWeight: '700',
                  color: MUTED,
                }}
              >
                Evening
              </Text>
            </View>

            {data.people.map((person, index) => (
              <View
                key={person.userId}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  gap: 6,
                  borderBottomWidth: index === data.people.length - 1 ? 0 : 1,
                  borderBottomColor: ROW_SEPARATOR,
                }}
              >
                <View style={{ flex: 2, gap: 1 }}>
                  <Text
                    numberOfLines={1}
                    style={{ fontSize: 14, fontWeight: '700', color: INK }}
                  >
                    {person.name}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{ fontSize: 11, color: MUTED }}
                  >
                    {person.roleLabel}
                  </Text>
                </View>
                <CellView
                  cell={person.morning}
                  disabled={data.isFuture}
                  onPress={() =>
                    navigation.navigate('AttendanceSession', {
                      userId: person.userId,
                      name: person.name,
                      businessDate: data.businessDate,
                      session: 'MORNING',
                    })
                  }
                />
                <CellView
                  cell={person.evening}
                  disabled={data.isFuture}
                  onPress={() =>
                    navigation.navigate('AttendanceSession', {
                      userId: person.userId,
                      name: person.name,
                      businessDate: data.businessDate,
                      session: 'EVENING',
                    })
                  }
                />
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <ManagerBottomNav
        active="Attendance"
        bottomInset={insets.bottom}
        onAttendancePress={() => undefined}
        onReportsPress={() => navigation.navigate('PreviousDayReport')}
        onVisitsPress={() => navigation.navigate('ManagerVisits', {})}
      />
    </View>
  );
}

/**
 * One cell. **Colour AND text, always** (FR-039) — the status word is
 * rendered, never implied by the fill.
 */
function CellView({
  cell,
  disabled,
  onPress,
}: {
  cell: Cell | null;
  disabled: boolean;
  onPress: () => void;
}) {
  const late =
    cell?.latenessFlag === 'DELAY_1H' || cell?.latenessFlag === 'DELAY_2H';
  const tone = !cell
    ? { bg: ATT_UNMARKED_BG, fg: MUTED }
    : cell.status === 'PRESENT' && late
      ? { bg: ATT_LATE_BG, fg: ATT_LATE_FG }
      : cell.status === 'PRESENT'
        ? { bg: ATT_PRESENT_BG, fg: ATT_PRESENT_FG }
        : cell.status === 'ABSENT'
          ? { bg: ATT_ABSENT_BG, fg: ATT_ABSENT_FG }
          : { bg: ATT_NEUTRAL_BG, fg: ATT_NEUTRAL_FG };

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 44,
        borderRadius: 10,
        backgroundColor: tone.bg,
        paddingVertical: 6,
        paddingHorizontal: 8,
        justifyContent: 'center',
        gap: 1,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: '700', color: tone.fg }}>
        {cell ? statusLabel(cell.status) : 'Not marked'}
      </Text>
      {cell ? (
        <Text style={{ fontSize: 10, color: tone.fg }}>
          {cell.status === 'PRESENT'
            ? `${formatClock(cell.actualTime)} · ${latenessLabel(cell.latenessFlag)}`
            : `v${cell.version}`}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function statusLabel(status: Status): string {
  switch (status) {
    case 'PRESENT':
      return 'Present';
    case 'ABSENT':
      return 'Absent';
    case 'LEAVE':
      return 'Leave';
    case 'HOLIDAY':
      return 'Holiday';
    case 'WEEKLY_OFF':
      return 'Weekly off';
  }
}

export function latenessLabel(
  flag: 'ON_TIME' | 'DELAY_1H' | 'DELAY_2H' | null,
): string {
  switch (flag) {
    case 'ON_TIME':
      return 'On time';
    case 'DELAY_1H':
      return 'One hour delay';
    case 'DELAY_2H':
      return 'Two hour delay';
    default:
      return '—';
  }
}

function formatClock(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatFullDay(businessDate: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${businessDate}T00:00:00.000Z`));
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 12,
        paddingVertical: 8,
        paddingHorizontal: 8,
      }}
    >
      <Text style={{ fontSize: 18, fontWeight: '700', color: INK }}>
        {value}
      </Text>
      <Text numberOfLines={1} style={{ fontSize: 11, color: MUTED }}>
        {label}
      </Text>
    </View>
  );
}

function StepButton({
  icon,
  label,
  onPress,
}: {
  icon: IconShape[];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        width: 40,
        height: 40,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: BORDER,
        backgroundColor: '#FFFFFF',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <OutlineIcon color={INK} shapes={icon} size={18} strokeWidth={2} />
    </Pressable>
  );
}
