import { useEffect, useState } from 'react';
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

import { ApiError, apiRequest } from '../../api/client';
import {
  OutlineIcon,
  type IconShape,
} from '../../components/icons/OutlineIcon';
import {
  getCurrentPosition,
  locationFailureMessage,
  type Position,
} from '../../lib/location';
import { enqueue, sync } from '../../lib/outbox';
import type { ExecutiveStackParamList } from '../../navigation/RootNavigator';
import {
  BG,
  BLUE,
  BORDER,
  DANGER,
  FIELD_BORDER,
  INK,
  LABEL,
  MUTED,
  PRIMARY_BUTTON_HEIGHT,
} from './executiveDesign';

/**
 * The shop form reached from board 1.4's "Shop not listed — create new"
 * (007-extra-shops, FR-016 … FR-018). The board's action links to
 * `../admin/ShopForm.dc.html`, which is board 4.9 ("New shop", uuid
 * `2351e584-c956-48ec-b48f-57b41a441d18`) — so every token here is board
 * 4.9's: `.grp` (white, 1px #DFE4EC, radius 18, padding 14, gap 12), `.sec`
 * (12/700, 0.06em, uppercase, #5A6474), `.lbl` (13/600 #3A4353, 6px below),
 * `.inp` (48 tall, 1.5px #CBD2DD, radius 12, 500/15) and `.btn` (54 tall,
 * radius 14, 700/16 on #1D4ED8).
 *
 * **Why this is not `features/admin/ShopFormScreen.tsx`**: that screen is
 * Company-Admin-only in role (`ShopsController` is class-level
 * `@Roles('COMPANY_ADMIN')` — an executive gets 403), in its endpoint
 * (`POST /shops`, which auto-approves the location) and in its design
 * tokens. Reusing it would mean putting two very different trust models
 * through one screen (research.md §6).
 *
 * **Which of board 4.9's controls appear, and why the rest do not.** This
 * form carries exactly the fields `addExtraStopSchema`'s `newShop` accepts,
 * which is the contract's own answer to what an executive may set:
 *
 *   * **Shop code** is absent *by requirement* — the server generates it and
 *     retries on collision, because asking someone standing in front of a
 *     shop to invent a unique code is a bad field interaction and a
 *     collision waiting to happen (FR-016, quickstart Scenario 10 step 5).
 *     The Company Admin renames it during review.
 *   * **Beat plan, Status, Visit radius override, the pin-skip checkbox and
 *     shop photos** are Company Admin master-data controls. An executive has
 *     neither the permission nor a contract field for any of them, and
 *     `.strict()` would reject them if sent. They belong to the admin's own
 *     board, which is unchanged.
 *   * **The location** is not chosen here: it is the executive's own
 *     position, read on mount and shown read-only, exactly as FR-016
 *     requires ("the shop form opens with the current position already set
 *     as the shop's location").
 *
 * The shop and its stop are created in ONE request so they arrive together
 * (FR-017) — the executive never has to find the shop again afterwards.
 */

const ICON_CLOSE: IconShape[] = [{ d: 'M6 6l12 12M18 6L6 18' }];
const ICON_PIN: IconShape[] = [
  { d: 'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z' },
  { circle: [12, 10, 2.6] },
];

export function CreateShopFromFieldScreen() {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<
      NativeStackNavigationProp<ExecutiveStackParamList, 'CreateShopFromField'>
    >();
  const route =
    useRoute<RouteProp<ExecutiveStackParamList, 'CreateShopFromField'>>();
  const { assignmentId } = route.params;

  const [name, setName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [city, setCity] = useState('');

  const [position, setPosition] = useState<Position | null>(null);
  const [positionError, setPositionError] = useState<string | null>(null);
  const [reading, setReading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // FR-016: the position is already filled in when the form opens.
  useEffect(() => {
    let cancelled = false;
    void getCurrentPosition().then((fix) => {
      if (cancelled) {
        return;
      }
      if (fix.ok) {
        setPosition(fix.position);
      } else {
        setPositionError(locationFailureMessage(fix.failure));
      }
      setReading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const canSave = name.trim().length > 0 && position !== null && !saving;

  async function save(): Promise<void> {
    if (!position || !canSave) {
      return;
    }
    setSaving(true);
    setError(null);

    const trimmed = (value: string) => {
      const next = value.trim();
      return next.length > 0 ? next : undefined;
    };

    const body = {
      newShop: {
        name: name.trim(),
        ownerName: trimmed(ownerName),
        phone: trimmed(phone),
        addressLine1: trimmed(addressLine1),
        city: trimmed(city),
        latitude: position.latitude,
        longitude: position.longitude,
        accuracyMeters: position.accuracyMeters,
        capturedAt: position.capturedAt,
      },
    };

    // Held first, then sent — the same guarantee the picker's add gets. The
    // key is minted here and reused, so a retry creates the shop and its
    // stop exactly once.
    const held = await enqueue(
      'STOP',
      `/assignments/${assignmentId}/stops`,
      body,
    );

    try {
      await apiRequest(`/assignments/${assignmentId}/stops`, {
        method: 'POST',
        body,
        idempotencyKey: held.idempotencyKey,
      });
      await sync();
      // Straight back to today's list, where the shop is already a stop —
      // FR-017 means never having to find it again.
      navigation.popTo('TodaysBeat');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NETWORK_ERROR') {
        await sync();
        navigation.popTo('TodaysBeat');
        return;
      }
      await sync();
      setError(
        err instanceof Error
          ? err.message
          : 'Could not create the shop. Try again.',
      );
      setSaving(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 20,
          paddingBottom: Math.max(insets.bottom, 32),
          gap: 14,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable
            accessibilityLabel="Close"
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
              flexShrink: 0,
            }}
          >
            <OutlineIcon
              color={INK}
              shapes={ICON_CLOSE}
              size={20}
              strokeWidth={2}
            />
          </Pressable>
          <Text
            style={{
              fontSize: 24,
              fontWeight: '700',
              color: INK,
              flexGrow: 1,
            }}
          >
            New shop
          </Text>
        </View>

        <Group title="Shop">
          <Field label="Shop name" onChangeText={setName} value={name} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Field
                label="Owner name"
                onChangeText={setOwnerName}
                value={ownerName}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                keyboardType="phone-pad"
                label="Phone"
                mono
                onChangeText={setPhone}
                value={phone}
              />
            </View>
          </View>
          <Text style={{ fontSize: 12, lineHeight: 17.4, color: MUTED }}>
            The shop code is created for you. Your Company Admin confirms this
            shop and its location afterwards.
          </Text>
        </Group>

        <Group title="Address">
          <Field
            label="Line 1"
            onChangeText={setAddressLine1}
            value={addressLine1}
          />
          <Field label="City" onChangeText={setCity} value={city} />
        </Group>

        <Group title="Location">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <OutlineIcon
              color={BLUE}
              shapes={ICON_PIN}
              size={20}
              strokeWidth={1.8}
            />
            {reading ? (
              <Text style={{ fontSize: 14, color: MUTED }}>
                Reading your location…
              </Text>
            ) : position ? (
              <Text
                style={{
                  fontFamily: 'monospace',
                  fontSize: 12,
                  color: MUTED,
                  flexShrink: 1,
                }}
              >
                {position.latitude.toFixed(5)}, {position.longitude.toFixed(5)}{' '}
                · source: GPS · ±{position.accuracyMeters} m
              </Text>
            ) : (
              <Text style={{ fontSize: 13, color: DANGER, flexShrink: 1 }}>
                {positionError ?? 'Could not read your location.'}
              </Text>
            )}
          </View>
          <Text style={{ fontSize: 12, lineHeight: 17.4, color: MUTED }}>
            Where you are standing now becomes this shop&rsquo;s location. Stand
            at the shop entrance before saving.
          </Text>
        </Group>

        {error ? (
          <Text style={{ fontSize: 13, color: DANGER }}>{error}</Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={!canSave}
          onPress={() => void save()}
          style={{
            marginTop: 4,
            height: PRIMARY_BUTTON_HEIGHT,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: canSave ? BLUE : FIELD_BORDER,
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
              Save shop
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

/** `.grp` + its `.sec` heading, board 4.9. */
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
        gap: 12,
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

/** `.lbl` + `.inp`, board 4.9. */
function Field({
  label,
  value,
  onChangeText,
  mono = false,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  mono?: boolean;
  keyboardType?: 'phone-pad';
}) {
  return (
    <View>
      <Text
        style={{
          fontSize: 13,
          fontWeight: '600',
          color: LABEL,
          marginBottom: 6,
        }}
      >
        {label}
      </Text>
      <TextInput
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        style={{
          width: '100%',
          height: 48,
          borderWidth: 1.5,
          borderColor: FIELD_BORDER,
          borderRadius: 12,
          paddingHorizontal: 12,
          fontSize: 15,
          fontWeight: '500',
          color: INK,
          backgroundColor: '#FFFFFF',
          ...(mono ? { fontFamily: 'monospace' } : {}),
        }}
        value={value}
      />
    </View>
  );
}
