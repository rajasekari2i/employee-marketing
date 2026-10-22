import { useCallback, useEffect, useState } from 'react';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import MapView, { Circle, Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { apiRequest } from '../../api/client';
import {
  OutlineIcon,
  type IconShape,
} from '../../components/icons/OutlineIcon';
import { getCurrentPosition, locationFailureMessage } from '../../lib/location';
import { enqueue, sync } from '../../lib/outbox';
import type { ExecutiveStackParamList } from '../../navigation/RootNavigator';
import {
  BG,
  BLUE,
  BORDER,
  CHIP_PIN_MISSING_BG,
  CHIP_PIN_MISSING_FG,
  CHIP_PIN_OK_BG,
  CHIP_PIN_OK_FG,
  CONFIRM_BG,
  CONFIRM_BORDER,
  CONFIRM_INK,
  DANGER,
  INK,
  MUTED,
} from './executiveDesign';

/**
 * PRD §4 screen 1.8 ("Capture shop location"), board uuid
 * `0af91c90-f23c-47b5-b344-72a43a604743`.
 *
 * **Known limitation**: the dev build's `GOOGLE_MAPS_API_KEY` is empty, so
 * map tiles render blank (research.md §9). Everything else here — the
 * position read, the accuracy verdict, the save gate — works regardless.
 * The same key gap affects the admin's shop form.
 *
 * This is the ONE screen in the product where accuracy blocks rather than
 * merely flags: a bad pin becomes the fixed point every future visit at this
 * shop is measured against, so one sloppy capture would silently corrupt
 * every later distance. The server enforces the same gate — this is the
 * friendly half, not the only one.
 */

const ICON_BACK: IconShape[] = [{ d: 'M15 18l-6-6 6-6' }];
const ICON_RETRY: IconShape[] = [
  { d: 'M20 11a8 8 0 1 0-2.3 5.7' },
  { d: 'M20 4v7h-7' },
];

type Source = 'GPS' | 'MAP_SEARCH' | 'MANUAL_DRAG';

export function CaptureShopPinScreen() {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<
      NativeStackNavigationProp<ExecutiveStackParamList, 'CaptureShopPin'>
    >();
  const route =
    useRoute<RouteProp<ExecutiveStackParamList, 'CaptureShopPin'>>();
  const { stopId, shopId, shopName, shopCode, addressLine, maxAccuracyMeters } =
    route.params;

  const [point, setPoint] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [source, setSource] = useState<Source>('GPS');
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readPosition = useCallback(async () => {
    setReading(true);
    setError(null);
    // `fresh`, not the default: the server REFUSES a pin coarser than the
    // company's limit, so a cached reading that already failed the gate is
    // worthless here — and handing it back is what made Retry GPS look
    // broken. This asks the hardware every time.
    const fix = await getCurrentPosition('fresh');
    if (!fix.ok) {
      setError(locationFailureMessage(fix.failure, 'Retry GPS'));
      setReading(false);
      return;
    }
    setPoint({
      latitude: fix.position.latitude,
      longitude: fix.position.longitude,
    });
    setAccuracy(fix.position.accuracyMeters);
    setCapturedAt(fix.position.capturedAt);
    setSource('GPS');
    setReading(false);
  }, []);

  useEffect(() => {
    void readPosition();
  }, [readPosition]);

  const accurateEnough = accuracy !== null && accuracy <= maxAccuracyMeters;

  async function save(): Promise<void> {
    if (!point || accuracy === null || !capturedAt) {
      return;
    }
    setSaving(true);
    const body = {
      latitude: point.latitude,
      longitude: point.longitude,
      accuracyMeters: accuracy,
      capturedAt,
      source,
    };

    // Held first, like a visit — and because it is enqueued before any visit
    // at this shop, FIFO ordering guarantees the pin arrives first (FR-042).
    const held = await enqueue('PIN', `/shops/${shopId}/pin`, body);

    try {
      const result = await apiRequest<{
        pinStatus: 'APPROVED' | 'PENDING_VERIFICATION';
        canRecordOutcome: boolean;
      }>(`/shops/${shopId}/pin`, {
        method: 'POST',
        body,
        idempotencyKey: held.idempotencyKey,
      });
      await sync();

      if (result.canRecordOutcome) {
        navigation.replace('ShopVisit', { stopId });
      } else {
        setError(
          "Location saved. It needs a manager's approval before an outcome can be recorded here.",
        );
      }
    } catch (err) {
      // Queued — but unlike a visit, the executive cannot proceed to record
      // an outcome until the server has actually accepted the pin, so this
      // says so plainly rather than pretending the shop is ready.
      setError(
        err instanceof Error
          ? `${err.message} The location is saved on your phone and will sync.`
          : 'Saved on your phone and will sync.',
      );
    } finally {
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
          accessibilityLabel="Back to today"
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
            <Text style={{ fontFamily: 'monospace' }}>{shopCode}</Text>
          </Text>
          <Text style={{ fontSize: 22, fontWeight: '700', color: INK }}>
            {shopName}
          </Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: 20, gap: 12, flexGrow: 1 }}>
        <View
          style={{
            flexDirection: 'row',
            gap: 10,
            padding: 12,
            borderRadius: 14,
            backgroundColor: CONFIRM_BG,
            borderWidth: 1,
            borderColor: CONFIRM_BORDER,
          }}
        >
          <Text
            style={{
              fontSize: 13,
              lineHeight: 19,
              color: CONFIRM_INK,
              flexShrink: 1,
            }}
          >
            This shop has no saved location. Stand at the shop entrance and save
            its pin before recording the first order or no-order.
          </Text>
        </View>

        {addressLine ? (
          <Text style={{ fontSize: 13, color: MUTED }}>{addressLine}</Text>
        ) : null}

        <View
          style={{
            flexGrow: 1,
            minHeight: 220,
            borderRadius: 16,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: BORDER,
            backgroundColor: '#FFFFFF',
          }}
        >
          {point ? (
            <MapView
              region={{
                latitude: point.latitude,
                longitude: point.longitude,
                latitudeDelta: 0.002,
                longitudeDelta: 0.002,
              }}
              style={{ flex: 1 }}
            >
              <Marker
                coordinate={point}
                draggable
                onDragEnd={(event) => {
                  setPoint(event.nativeEvent.coordinate);
                  // Dragged by hand — the source changes, and the recorded
                  // accuracy no longer describes this point, so the reading
                  // is kept but the source tells the truth about how it was
                  // set.
                  setSource('MANUAL_DRAG');
                }}
              />
              {accuracy !== null ? (
                <Circle
                  center={point}
                  fillColor="rgba(29,78,216,0.12)"
                  radius={accuracy}
                  strokeColor="rgba(29,78,216,0.45)"
                />
              ) : null}
            </MapView>
          ) : (
            <View
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ActivityIndicator testID="capture-pin-loading" />
            </View>
          )}
        </View>

        <Text style={{ fontSize: 12, color: MUTED }}>
          Drag the pin to the shop door
        </Text>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <View>
            <Text style={{ fontSize: 12, color: MUTED }}>GPS accuracy</Text>
            <Text style={{ fontSize: 20, fontWeight: '700', color: INK }}>
              ±{accuracy ?? '—'} m
            </Text>
          </View>
          <View
            style={{
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 999,
              backgroundColor: accurateEnough
                ? CHIP_PIN_OK_BG
                : CHIP_PIN_MISSING_BG,
            }}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: '600',
                color: accurateEnough ? CHIP_PIN_OK_FG : CHIP_PIN_MISSING_FG,
              }}
            >
              {accuracy === null
                ? 'Reading…'
                : accurateEnough
                  ? 'Good enough to save'
                  : 'Too low — retry'}
            </Text>
          </View>
        </View>

        {point && capturedAt ? (
          <Text style={{ fontSize: 12, color: MUTED, fontFamily: 'monospace' }}>
            {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)} · {source}{' '}
            · captured {new Date(capturedAt).toLocaleTimeString()}
          </Text>
        ) : null}

        {!accurateEnough && accuracy !== null ? (
          <Text
            style={{ fontSize: 12, color: CHIP_PIN_MISSING_FG, lineHeight: 17 }}
          >
            Accuracy must be {maxAccuracyMeters} m or better to save a pin. Step
            outside, away from tall walls, and retry.
          </Text>
        ) : null}

        {error ? (
          <Text style={{ fontSize: 13, color: DANGER }}>{error}</Text>
        ) : null}
      </View>

      <View
        style={{
          paddingTop: 14,
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 16,
          backgroundColor: '#FFFFFF',
          borderTopWidth: 1,
          borderTopColor: BORDER,
          flexDirection: 'row',
          gap: 10,
        }}
      >
        <Pressable
          accessibilityLabel="Retry GPS"
          disabled={reading}
          onPress={() => void readPosition()}
          style={{
            height: 54,
            paddingHorizontal: 18,
            borderRadius: 14,
            borderWidth: 1.5,
            borderColor: INK,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            opacity: reading ? 0.6 : 1,
          }}
        >
          <OutlineIcon color={INK} shapes={ICON_RETRY} size={18} />
          <Text style={{ fontSize: 15, fontWeight: '700', color: INK }}>
            Retry GPS
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Save shop pin"
          disabled={!accurateEnough || saving}
          onPress={() => void save()}
          style={{
            flexGrow: 1,
            height: 54,
            borderRadius: 14,
            backgroundColor: BLUE,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: !accurateEnough || saving ? 0.45 : 1,
          }}
        >
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>
            {saving ? 'Saving…' : 'Save shop pin'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
