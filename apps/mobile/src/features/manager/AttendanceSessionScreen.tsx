import { useCallback, useEffect, useState } from 'react';
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

import { ApiError, apiRequest, generateIdempotencyKey } from '../../api/client';
import {
  OutlineIcon,
  type IconShape,
} from '../../components/icons/OutlineIcon';
import type { ManagerStackParamList } from '../../navigation/RootNavigator';
import { latenessLabel, statusLabel, type Cell } from './AttendanceDayScreen';
import { BG, BLUE, BORDER, DANGER, INK, LABEL, MUTED } from './managerDesign';
import { describeFailure } from './loadState';

/**
 * PRD §4 screen 3.8 ("Session edit + amendment"), board uuid
 * `8f1020a5-3275-4f54-84b9-f10edb256cfe` (010-manager-app).
 *
 * **Saving over an existing record creates an AMENDMENT**, which keeps the
 * original readable (FR-037). The board says so in words and so does this
 * screen — a manager should never be surprised by what saving does.
 *
 * **Lateness is shown, never chosen.** The field reads "Derived
 * automatically" because the company's session start time decides it, not
 * the manager (FR-035).
 */

const ICON_BACK: IconShape[] = [{ d: 'M15 18l-6-6 6-6' }];

type Status = 'PRESENT' | 'ABSENT' | 'LEAVE' | 'HOLIDAY' | 'WEEKLY_OFF';
const STATUSES: Status[] = [
  'PRESENT',
  'ABSENT',
  'LEAVE',
  'HOLIDAY',
  'WEEKLY_OFF',
];

interface DaySheet {
  businessDate: string;
  people: Array<{
    userId: string;
    morning: Cell | null;
    evening: Cell | null;
  }>;
}

export function AttendanceSessionScreen() {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<
      NativeStackNavigationProp<ManagerStackParamList, 'AttendanceSession'>
    >();
  const route =
    useRoute<RouteProp<ManagerStackParamList, 'AttendanceSession'>>();
  const { userId, name, businessDate, session } = route.params;

  const [existing, setExisting] = useState<Cell | null>(null);
  const [status, setStatus] = useState<Status>('PRESENT');
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Set when the pre-fill read failed. Saving stays blocked while it is
   * true: the editor would not know whether this session is already marked,
   * so it could not ask for the change reason an amendment owes (rule 4),
   * and the manager would be writing over a record they were never shown.
   */
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const day = await apiRequest<DaySheet>(
        `/attendance?date=${businessDate}`,
      );
      const person = day.people.find((p) => p.userId === userId);
      const cell = session === 'MORNING' ? person?.morning : person?.evening;
      setExisting(cell ?? null);
      if (cell) {
        setStatus(cell.status);
        setTime(cell.actualTime ? toClock(cell.actualTime) : '');
      }
      setError(null);
      setLoadFailed(false);
    } catch (err) {
      setLoadFailed(true);
      setError(
        describeFailure(err, 'this session', false).error ??
          'Could not load it.',
      );
    } finally {
      setLoading(false);
    }
  }, [businessDate, session, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const needsTime = status === 'PRESENT';
  const canSave =
    !loadFailed &&
    (!needsTime || /^\d{2}:\d{2}$/.test(time)) &&
    (!existing || reason.trim().length >= 3) &&
    !saving;

  async function save(): Promise<void> {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await apiRequest('/attendance', {
        method: 'POST',
        body: {
          userId,
          businessDate,
          session,
          status,
          // Required for PRESENT and forbidden otherwise — the schema
          // enforces both halves.
          ...(needsTime
            ? { actualTime: `${businessDate}T${time}:00.000Z` }
            : {}),
          ...(existing ? { changeReason: reason.trim() } : {}),
        },
        idempotencyKey: generateIdempotencyKey(),
      });
      navigation.goBack();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'ATTENDANCE_VERSION_CONFLICT'
          ? 'This record changed while you were editing it. Go back and reopen it.'
          : err instanceof Error
            ? err.message
            : 'Could not save.',
      );
      setSaving(false);
    }
  }

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
        <View style={{ flexShrink: 1 }}>
          <Text style={{ fontSize: 13, color: MUTED }}>
            {formatDay(businessDate)} ·{' '}
            {session === 'MORNING' ? 'Morning' : 'Evening'} session
          </Text>
          <Text style={{ fontSize: 22, fontWeight: '700', color: INK }}>
            {name}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 24,
          gap: 14,
        }}
      >
        {loading ? (
          <View style={{ paddingVertical: 48, alignItems: 'center' }}>
            <ActivityIndicator color={BLUE} />
          </View>
        ) : (
          <>
            <Group title="Status">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {STATUSES.map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => setStatus(s)}
                    style={{
                      paddingVertical: 10,
                      paddingHorizontal: 14,
                      borderRadius: 12,
                      borderWidth: status === s ? 2 : 1.5,
                      borderColor: status === s ? BLUE : BORDER,
                      backgroundColor: status === s ? '#E3EBFC' : '#FFFFFF',
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 14,
                        fontWeight: status === s ? '700' : '500',
                        color: status === s ? BLUE : INK,
                      }}
                    >
                      {statusLabel(s)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </Group>

            {needsTime ? (
              <Group title="Arrival time">
                <TextInput
                  keyboardType="numbers-and-punctuation"
                  onChangeText={setTime}
                  placeholder="HH:MM"
                  placeholderTextColor={MUTED}
                  style={{
                    height: 48,
                    borderWidth: 1.5,
                    borderColor: BORDER,
                    borderRadius: 12,
                    paddingHorizontal: 12,
                    fontSize: 15,
                    fontFamily: 'monospace',
                    color: INK,
                    backgroundColor: '#FFFFFF',
                  }}
                  value={time}
                />
                <Text style={{ fontSize: 12, color: MUTED }}>
                  Derived automatically:{' '}
                  {existing ? latenessLabel(existing.latenessFlag) : '—'}
                </Text>
              </Group>
            ) : null}

            {/* The amendment block — board 3.8's own copy. */}
            {existing ? (
              <View
                style={{
                  backgroundColor: '#FFFFFF',
                  borderWidth: 1,
                  borderColor: BORDER,
                  borderRadius: 14,
                  padding: 14,
                  gap: 10,
                }}
              >
                <Text style={{ fontSize: 13, lineHeight: 19, color: LABEL }}>
                  Already recorded
                  {existing.actualTime
                    ? ` at ${toClock(existing.actualTime)}`
                    : ''}{' '}
                  as{' '}
                  <Text style={{ fontWeight: '700' }}>
                    {statusLabel(existing.status)}
                  </Text>
                  {existing.recordedByName
                    ? ` by ${existing.recordedByName}`
                    : ''}
                  . Saving creates an amendment; the original stays in the audit
                  trail.
                </Text>
                <View>
                  <Text
                    style={{
                      fontSize: 13,
                      fontWeight: '600',
                      color: LABEL,
                      marginBottom: 6,
                    }}
                  >
                    Reason for change (required)
                  </Text>
                  <TextInput
                    multiline
                    onChangeText={setReason}
                    placeholder="Why is this changing?"
                    placeholderTextColor={MUTED}
                    style={{
                      minHeight: 72,
                      borderWidth: 1.5,
                      borderColor: BORDER,
                      borderRadius: 12,
                      padding: 12,
                      fontSize: 15,
                      color: INK,
                      backgroundColor: '#FFFFFF',
                      textAlignVertical: 'top',
                    }}
                    value={reason}
                  />
                </View>
              </View>
            ) : null}

            <Text style={{ fontSize: 12, lineHeight: 17, color: MUTED }}>
              Late flags are reported separately and don&rsquo;t change payable
              half-days unless your company sets a policy.
            </Text>

            {error ? (
              <Text style={{ fontSize: 13, color: DANGER }}>{error}</Text>
            ) : null}

            <Pressable
              disabled={!canSave}
              onPress={() => void save()}
              style={{
                height: 54,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: canSave ? BLUE : BORDER,
              }}
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: '700',
                    color: canSave ? '#FFFFFF' : MUTED,
                  }}
                >
                  {existing ? 'Save amendment' : 'Save'}
                </Text>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 18,
        padding: 14,
        gap: 10,
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
        {title}
      </Text>
      {children}
    </View>
  );
}

function toClock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function formatDay(businessDate: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${businessDate}T00:00:00.000Z`));
}
