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
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { apiRequest } from '../../api/client';
import {
  OutlineIcon,
  type IconShape,
} from '../../components/icons/OutlineIcon';
import type { ExecutiveStackParamList } from '../../navigation/RootNavigator';
import {
  BG,
  BLUE,
  BORDER,
  CHIP_NEUTRAL_BG,
  CHIP_PIN_OK_BG,
  CHIP_PIN_OK_FG,
  INK,
  LOCKED_BG,
  LOCKED_INK,
  MUTED,
  ROW_SEPARATOR,
} from './executiveDesign';

/**
 * PRD §4 screen 1.7 ("Shop visit"). Values taken verbatim from board 1.7
 * (uuid `88f67d75-52bd-4ff1-ad03-e774bf6cc96c`).
 *
 * **One deliberate divergence from the board**: the "Visit radius 25 m" chip
 * is NOT rendered (FR-019). The board draws it between "Pin verified" and
 * "Owner: …"; the user asked that the executive not be shown range
 * information, and the radius is the threshold every range verdict is
 * measured against. The server never sends it to this role either, so there
 * is nothing here to render even if someone tried.
 */

const ICON_BACK: IconShape[] = [{ d: 'M15 18l-6-6 6-6' }];
const ICON_CALL: IconShape[] = [
  {
    d: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
  },
];
const ICON_PIN: IconShape[] = [
  { d: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z' },
  { circle: [12, 10, 2.5] },
];
const ICON_ORDER: IconShape[] = [
  { d: 'M3 4h2l2.4 11h11L21 7H6.2' },
  { circle: [9, 20, 1.4] },
  { circle: [17, 20, 1.4] },
];
const ICON_NO_ORDER: IconShape[] = [
  { circle: [12, 12, 9] },
  { d: 'M6 6l12 12' },
];

export interface StopDetail {
  id: string;
  sequence: number;
  positionLabel: string;
  status: string;
  canRecordOutcome: boolean;
  blockedReason:
    | 'BEAT_NOT_RUNNING'
    | 'ALREADY_COMPLETED'
    | 'PIN_MISSING'
    | 'PIN_PENDING_APPROVAL'
    | null;
  shop: {
    id: string;
    shopCode: string;
    name: string;
    addressLine: string | null;
    ownerName: string | null;
    phone: string | null;
    pinStatus: 'NONE' | 'PENDING_VERIFICATION' | 'APPROVED';
  };
  lastFive: Array<{
    visitedOn: string;
    outcome: 'ORDER' | 'NO_ORDER';
    summary: string;
    recordedBy: string;
  }>;
}

const BLOCKED_COPY: Record<string, string> = {
  BEAT_NOT_RUNNING: 'Start the beat before recording a visit.',
  ALREADY_COMPLETED: 'An outcome is already recorded for this shop today.',
  PIN_MISSING: "This shop's location must be saved first.",
  PIN_PENDING_APPROVAL:
    "This shop's location is waiting for a manager's approval.",
};

export function ShopVisitScreen() {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<
      NativeStackNavigationProp<ExecutiveStackParamList, 'ShopVisit'>
    >();
  const route = useRoute<RouteProp<ExecutiveStackParamList, 'ShopVisit'>>();
  const { stopId } = route.params;

  const [stop, setStop] = useState<StopDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [sampleShown, setSampleShown] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await apiRequest<{ stop: StopDetail }>(`/stops/${stopId}`);
      setStop(result.stop);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the shop.');
    } finally {
      setLoading(false);
    }
  }, [stopId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function openOutcome(outcome: 'ORDER' | 'NO_ORDER'): void {
    if (!stop || sampleShown === null) {
      return;
    }
    const params = { stopId: stop.id, shopName: stop.shop.name, sampleShown };
    navigation.navigate(
      outcome === 'ORDER' ? 'RecordOrder' : 'RecordNoOrder',
      params,
    );
  }

  const canChoose = Boolean(stop?.canRecordOutcome) && sampleShown !== null;

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
          accessibilityLabel="Back to today"
          onPress={() => navigation.goBack()}
          style={iconButton}
        >
          <OutlineIcon
            color={INK}
            shapes={ICON_BACK}
            size={20}
            strokeWidth={2}
          />
        </Pressable>
        <View style={{ flexGrow: 1, flexShrink: 1 }}>
          <Text style={{ fontSize: 13, color: MUTED }}>
            {stop?.positionLabel ?? ''}
            {stop ? ' · ' : ''}
            <Text style={{ fontFamily: 'monospace' }}>
              {stop?.shop.shopCode ?? ''}
            </Text>
          </Text>
          <Text style={{ fontSize: 22, fontWeight: '700', color: INK }}>
            {stop?.shop.name ?? ''}
          </Text>
        </View>
        {stop?.shop.phone ? (
          <Pressable
            accessibilityLabel="Call owner"
            onPress={() => void Linking.openURL(`tel:${stop.shop.phone ?? ''}`)}
            style={iconButton}
          >
            <OutlineIcon color={INK} shapes={ICON_CALL} size={20} />
          </Pressable>
        ) : null}
      </View>

      {loading && !stop ? (
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        >
          <ActivityIndicator testID="shop-visit-loading" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 24 }}
          style={{ paddingHorizontal: 20 }}
        >
          {error ? (
            <Text style={{ fontSize: 13, color: '#A3261B', marginBottom: 10 }}>
              {error}
            </Text>
          ) : null}

          <View style={{ ...card, padding: 14, gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <OutlineIcon color={BLUE} shapes={ICON_PIN} size={18} />
              <Text
                style={{
                  fontSize: 14,
                  lineHeight: 20,
                  flexShrink: 1,
                  color: INK,
                }}
              >
                {stop?.shop.addressLine ?? 'No address recorded'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {stop?.shop.pinStatus === 'APPROVED' ? (
                <Chip
                  bg={CHIP_PIN_OK_BG}
                  fg={CHIP_PIN_OK_FG}
                  label="Pin verified"
                />
              ) : null}
              {/* The board draws a "Visit radius N m" chip here. Deliberately
                  omitted — FR-019. */}
              {stop?.shop.ownerName ? (
                <Chip
                  bg={CHIP_NEUTRAL_BG}
                  fg="#3A4353"
                  label={`Owner: ${stop.shop.ownerName}`}
                />
              ) : null}
            </View>
          </View>

          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginTop: 16,
              marginBottom: 8,
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: '700', color: INK }}>
              Last 5 visits
            </Text>
            <Text style={{ fontSize: 12, color: MUTED }}>Newest first</Text>
          </View>

          <View style={card}>
            {(stop?.lastFive ?? []).length === 0 ? (
              <Text
                style={{
                  fontSize: 13,
                  color: MUTED,
                  padding: 14,
                  textAlign: 'center',
                }}
              >
                No visits recorded at this shop yet.
              </Text>
            ) : (
              (stop?.lastFive ?? []).map((visit, index) => {
                const date = new Date(`${visit.visitedOn}T00:00:00.000Z`);
                return (
                  <View
                    key={`${visit.visitedOn}-${index}`}
                    style={{
                      flexDirection: 'row',
                      gap: 12,
                      alignItems: 'center',
                      paddingVertical: 10,
                      paddingHorizontal: 14,
                      borderBottomWidth:
                        index === (stop?.lastFive.length ?? 0) - 1 ? 0 : 1,
                      borderBottomColor: ROW_SEPARATOR,
                    }}
                  >
                    <View style={{ width: 44, alignItems: 'center' }}>
                      <Text
                        style={{ fontSize: 17, fontWeight: '700', color: INK }}
                      >
                        {String(date.getUTCDate()).padStart(2, '0')}
                      </Text>
                      <Text
                        style={{
                          fontSize: 11,
                          color: MUTED,
                          fontWeight: '600',
                        }}
                      >
                        {date.toLocaleString(undefined, {
                          month: 'short',
                          timeZone: 'UTC',
                        })}
                      </Text>
                    </View>
                    <View style={{ flexGrow: 1, flexShrink: 1, gap: 2 }}>
                      <Text
                        style={{ fontSize: 14, fontWeight: '600', color: INK }}
                      >
                        {visit.summary}
                      </Text>
                      <Text style={{ fontSize: 12, color: MUTED }}>
                        {visit.recordedBy}
                      </Text>
                    </View>
                    <Chip
                      bg={
                        visit.outcome === 'ORDER'
                          ? CHIP_PIN_OK_BG
                          : CHIP_NEUTRAL_BG
                      }
                      fg={
                        visit.outcome === 'ORDER' ? CHIP_PIN_OK_FG : '#3A4353'
                      }
                      label={visit.outcome === 'ORDER' ? 'Order' : 'No order'}
                    />
                  </View>
                );
              })
            )}
          </View>

          <Text
            style={{
              fontSize: 14,
              fontWeight: '700',
              color: INK,
              marginTop: 16,
              marginBottom: 8,
            }}
          >
            Sample shown?
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <SampleButton
              label="Yes"
              onPress={() => setSampleShown(true)}
              selected={sampleShown === true}
            />
            <SampleButton
              label="No"
              onPress={() => setSampleShown(false)}
              selected={sampleShown === false}
            />
          </View>

          {stop && !stop.canRecordOutcome ? (
            <View
              style={{
                marginTop: 16,
                flexDirection: 'row',
                gap: 10,
                alignItems: 'center',
                paddingVertical: 11,
                paddingHorizontal: 14,
                borderRadius: 14,
                backgroundColor: LOCKED_BG,
              }}
            >
              <Text style={{ fontSize: 13, color: LOCKED_INK, flexShrink: 1 }}>
                {BLOCKED_COPY[stop.blockedReason ?? ''] ??
                  'An outcome cannot be recorded here.'}
              </Text>
            </View>
          ) : null}
        </ScrollView>
      )}

      <View
        style={{
          paddingTop: 14,
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 16,
          backgroundColor: '#FFFFFF',
          borderTopWidth: 1,
          borderTopColor: BORDER,
          gap: 10,
        }}
      >
        <Text style={{ fontSize: 14, fontWeight: '700', color: INK }}>
          Record outcome
        </Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <OutcomeButton
            disabled={!canChoose}
            icon={ICON_ORDER}
            label="Order"
            onPress={() => openOutcome('ORDER')}
            primary
          />
          <OutcomeButton
            disabled={!canChoose}
            icon={ICON_NO_ORDER}
            label="No order"
            onPress={() => openOutcome('NO_ORDER')}
          />
        </View>
      </View>
    </View>
  );
}

const iconButton = {
  width: 44,
  height: 44,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: BORDER,
  backgroundColor: '#FFFFFF',
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};

const card = {
  backgroundColor: '#FFFFFF',
  borderWidth: 1,
  borderColor: BORDER,
  borderRadius: 16,
  overflow: 'hidden' as const,
};

function SampleButton({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        flex: 1,
        height: 48,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: selected ? 2 : 1.5,
        borderColor: selected ? BLUE : '#CBD2DD',
        backgroundColor: selected ? CHIP_PIN_OK_BG : '#FFFFFF',
      }}
    >
      <Text
        style={{
          fontSize: 15,
          fontWeight: '600',
          color: selected ? CHIP_PIN_OK_FG : INK,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function OutcomeButton({
  label,
  icon,
  primary = false,
  disabled,
  onPress,
}: {
  label: string;
  icon: IconShape[];
  primary?: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{
        flex: 1,
        height: 56,
        borderRadius: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: primary ? BLUE : '#FFFFFF',
        borderWidth: primary ? 0 : 1.5,
        borderColor: INK,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <OutlineIcon color={primary ? '#FFFFFF' : INK} shapes={icon} size={24} />
      <Text
        style={{
          fontSize: 16,
          fontWeight: '700',
          color: primary ? '#FFFFFF' : INK,
        }}
      >
        {label}
      </Text>
    </Pressable>
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
