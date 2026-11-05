import { useEffect, useRef, useState } from 'react';
import type { RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  createShopSchema,
  updateShopSchema,
  type LocationSource,
} from '@field-sales/shared';

import {
  ApiError,
  apiRequest,
  generateIdempotencyKey,
  resolveFileUrl,
} from '../../api/client';
import {
  OutlineIcon,
  type IconShape,
} from '../../components/icons/OutlineIcon';
import { GOOGLE_MAPS_API_KEY } from '../../config';
import { getCurrentPosition, locationFailureMessage } from '../../lib/location';
import {
  cameraPermissionMessage,
  ensureCameraPermission,
} from '../../lib/permissions';
import type { AdminStackParamList } from '../../navigation/RootNavigator';
import { BG, BLUE, BORDER, INK, LABEL, MUTED } from './adminDesign';
import type { ShopSummaryForEdit } from './ShopsListScreen';

/**
 * PRD §4 screen 4.9 ("New shop"). Layout/colors/icons below are taken
 * verbatim from `docs/ui-design/Field_Sales_Beat_App.html` §4.9 — see that
 * board for the source of every hex value and SVG path here. There is no
 * separate "edit shop" board — per the feature spec, editing opens this
 * same screen pre-filled, titled "Edit shop" instead of "New shop" (FR-013).
 *
 * "Beat plan" (003-beat-plans-crud follow-up) is read-only here: it shows
 * every plan this shop is currently on, but assignment itself only ever
 * happens from the beat plan's own form — tapping it explains why rather
 * than opening a selector.
 *
 * Location is a real `react-native-maps` `MapView` (research.md §2), with
 * three ways to set the pin: tap or drag it, search an address via the
 * Google Geocoding API using the same `GOOGLE_MAPS_API_KEY` the Android
 * manifest already carries, or take the device's own position with the
 * locate button on the map — for the admin standing in front of the shop,
 * which is the case neither of the other two serves well. Map tiles won't
 * render without a real key configured for the active build flavor; the
 * rest of this screen, the locate button included, still works regardless.
 */

type ShopFormNavigationProp = NativeStackNavigationProp<
  AdminStackParamList,
  'ShopForm'
>;
type ShopFormRouteProp = RouteProp<AdminStackParamList, 'ShopForm'>;

interface LocationState {
  latitude: number;
  longitude: number;
  source: LocationSource;
  label: string | null;
  /** Only a `GPS` point has one — a searched or dragged pin is as precise as the map, which has no error figure to report. */
  accuracyMeters: number | null;
}

interface PendingPhoto {
  uri: string;
  name: string;
  type: string;
}

/** The subset of the Google Geocoding API's response shape this screen reads. */
interface GeocodeResponse {
  results?: Array<{
    formatted_address?: string;
    geometry: { location: { lat: number; lng: number } };
  }>;
}

const MAX_PHOTOS = 3;

const ICON_CLOSE: IconShape[] = [{ d: 'M6 6l12 12M18 6L6 18' }];
const ICON_BACK: IconShape[] = [{ d: 'M15 18l-6-6 6-6' }];
const ICON_CHEVRON_DOWN: IconShape[] = [{ d: 'M6 9l6 6 6-6' }];
const ICON_CHECK: IconShape[] = [{ d: 'M20 6L9 17l-5-5' }];
const ICON_REMOVE: IconShape[] = [{ d: 'M6 6l12 12M18 6L6 18' }];
const ICON_CAMERA: IconShape[] = [
  { d: 'M4 8h3l2-3h6l2 3h3v11H4z' },
  { circle: [12, 13, 3.5] },
];
const ICON_GALLERY: IconShape[] = [
  { rect: [3, 5, 18, 14, 2] },
  { d: 'M3 16l5-5 4 4 3-3 6 6' },
  { circle: [9, 9, 1.5] },
];
const ICON_SEARCH: IconShape[] = [
  { circle: [11, 11, 7] },
  { d: 'M20 20l-4-4' },
];
/** The conventional "my location" crosshair: ring, centre dot, four ticks. Board 4.9 has no such control, so this follows the board's icon system (24-unit box, 2px round-cap outline, #5A6474) rather than inventing a style. */
const ICON_LOCATE: IconShape[] = [
  { circle: [12, 12, 7] },
  { circle: [12, 12, 2] },
  { d: 'M12 1v3M12 20v3M1 12h3M20 12h3' },
];

/** Default map center when a shop has no pin yet and nothing has been searched/dragged — central India, a neutral country-level view. */
const DEFAULT_REGION = {
  latitude: 20.5937,
  longitude: 78.9629,
  latitudeDelta: 8,
  longitudeDelta: 8,
};

const APPROVED_REGION_DELTA = { latitudeDelta: 0.01, longitudeDelta: 0.01 };

/** Board 4.9's caption spells the source in plain words, not the enum. A lookup rather than a ternary: there are three sources now, and a ternary silently labelled anything that was not `MAP_SEARCH` as "manual drag". */
const SOURCE_LABEL: Record<LocationSource, string> = {
  MAP_SEARCH: 'map search',
  MANUAL_DRAG: 'manual drag',
  GPS: 'current location',
};

function errorMessageFor(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'DUPLICATE_SHOP_CODE':
        return 'That shop code is already in use in this company.';
      case 'VALIDATION_FAILED':
        return error.message || 'Please check the fields and try again.';
      case 'NETWORK_ERROR':
        return 'No internet connection. Check your signal and try again.';
      case 'NOT_FOUND':
        return 'This shop could not be found.';
      default:
        return 'Something went wrong at our end. Try again in a moment.';
    }
  }
  return 'Something went wrong at our end. Try again in a moment.';
}

function Group({ children }: { children: React.ReactNode }) {
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
      {children}
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      style={{
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        color: MUTED,
      }}
    >
      {children}
    </Text>
  );
}

function FieldLabel({ children }: { children: string }) {
  return (
    <Text
      style={{ fontSize: 13, fontWeight: '600', color: LABEL, marginBottom: 6 }}
    >
      {children}
    </Text>
  );
}

const INPUT_STYLE = {
  height: 48,
  borderWidth: 1.5,
  borderColor: '#CBD2DD',
  borderRadius: 12,
  paddingHorizontal: 12,
  fontSize: 15,
  fontWeight: '500' as const,
  color: INK,
  backgroundColor: '#FFFFFF',
};

function Checkbox({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <Pressable
      onPress={onToggle}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: 32,
      }}
      testID="shop-form-skip-checkbox"
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 4,
          borderWidth: 1.5,
          borderColor: checked ? BLUE : '#AEB7C5',
          backgroundColor: checked ? BLUE : '#FFFFFF',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? (
          <OutlineIcon
            color="#FFFFFF"
            shapes={ICON_CHECK}
            size={13}
            strokeWidth={2.5}
          />
        ) : null}
      </View>
      <Text style={{ fontSize: 14, color: INK, flexShrink: 1, lineHeight: 19 }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function ShopFormScreen() {
  const navigation = useNavigation<ShopFormNavigationProp>();
  const route = useRoute<ShopFormRouteProp>();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);

  const editingShop = route.params?.shop;
  const isEditing = Boolean(editingShop);
  // Read-only display — see the "Beat plan" field below; never editable
  // from this screen (research.md §1, carried into the beat-plans follow-up).
  const beatPlanNames = editingShop?.beatPlanNames ?? [];

  const [shopCode, setShopCode] = useState(editingShop?.shopCode ?? '');
  const [isActive, setIsActive] = useState(editingShop?.isActive ?? true);
  const [name, setName] = useState(editingShop?.name ?? '');
  const [ownerName, setOwnerName] = useState(editingShop?.ownerName ?? '');
  const [phone, setPhone] = useState(editingShop?.phone ?? '');
  const [addressLine1, setAddressLine1] = useState(
    editingShop?.addressLine1 ?? '',
  );
  const [addressLine2, setAddressLine2] = useState(
    editingShop?.addressLine2 ?? '',
  );
  const [city, setCity] = useState(editingShop?.city ?? '');
  const [state, setState] = useState(editingShop?.state ?? '');
  const [postalCode, setPostalCode] = useState(editingShop?.postalCode ?? '');
  const [radius, setRadius] = useState(
    editingShop?.verificationRadiusMeters != null
      ? String(editingShop.verificationRadiusMeters)
      : '',
  );

  const [existingPhotos, setExistingPhotos] = useState(
    editingShop?.photos ?? [],
  );
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const totalPhotoCount = existingPhotos.length + pendingPhotos.length;

  const [location, setLocation] = useState<LocationState | null>(
    editingShop?.pinStatus === 'APPROVED' &&
      editingShop.latitude !== null &&
      editingShop.longitude !== null
      ? {
          latitude: editingShop.latitude,
          longitude: editingShop.longitude,
          source: editingShop.locationSource ?? 'MANUAL_DRAG',
          label: null,
          // A saved shop's accuracy is not carried on the list row, and it
          // describes the reading that produced the pin rather than the pin
          // itself — so there is nothing honest to show until this session
          // takes its own fix.
          accuracyMeters: null,
        }
      : null,
  );
  const [skip, setSkip] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function pickPhoto(source: 'camera' | 'gallery'): Promise<void> {
    // The launch-time ask (App.tsx) usually means this is already granted,
    // but it can be declined there or revoked from Settings afterwards —
    // and image-picker will not open the camera without it, it just returns
    // an error. Gallery needs nothing: Android 13+ hands back a photo the
    // user picked themselves.
    if (source === 'camera') {
      const permission = await ensureCameraPermission();
      if (permission !== 'GRANTED') {
        Alert.alert('Camera unavailable', cameraPermissionMessage(permission));
        return;
      }
    }

    const result =
      source === 'camera'
        ? await launchCamera({ mediaType: 'photo', quality: 0.8 })
        : await launchImageLibrary({ mediaType: 'photo', quality: 0.8 });

    if (result.didCancel) {
      return;
    }
    // Surfaced, not swallowed. Dropping this is what made a blocked camera
    // look like a dead button.
    if (result.errorCode) {
      Alert.alert(
        source === 'camera'
          ? 'Could not open the camera'
          : 'Could not open photos',
        result.errorMessage ?? 'Something went wrong. Please try again.',
      );
      return;
    }

    const asset = result.assets?.[0];
    if (!asset?.uri) {
      return;
    }
    setPendingPhotos((prev) => [
      ...prev,
      {
        uri: asset.uri as string,
        name: asset.fileName ?? 'photo.jpg',
        type: asset.type ?? 'image/jpeg',
      },
    ]);
  }

  async function removeExistingPhoto(photoId: string): Promise<void> {
    if (!editingShop) {
      return;
    }
    try {
      await apiRequest(`/shops/${editingShop.id}/photos/${photoId}`, {
        method: 'DELETE',
        idempotencyKey: generateIdempotencyKey(),
      });
      setExistingPhotos((prev) => prev.filter((p) => p.id !== photoId));
    } catch (error) {
      setSubmitError(errorMessageFor(error));
    }
  }

  function removePendingPhoto(index: number): void {
    setPendingPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  async function runSearch(): Promise<void> {
    const query = searchQuery.trim();
    if (!query) {
      return;
    }
    if (!GOOGLE_MAPS_API_KEY) {
      Alert.alert(
        'Map search unavailable',
        'This build has no Google Maps API key configured yet. Ask your administrator.',
      );
      return;
    }
    setSearching(true);
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${GOOGLE_MAPS_API_KEY}`;
      const response = await fetch(url);
      const data = (await response.json()) as GeocodeResponse;
      const first = data.results?.[0];
      const lat = first?.geometry.location.lat;
      const lng = first?.geometry.location.lng;
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        Alert.alert('No results', 'Could not find that address.');
        return;
      }
      setSkip(false);
      setLocation({
        latitude: lat,
        longitude: lng,
        source: 'MAP_SEARCH',
        label: first?.formatted_address ?? query,
        accuracyMeters: null,
      });
      mapRef.current?.animateToRegion(
        { latitude: lat, longitude: lng, ...APPROVED_REGION_DELTA },
        400,
      );
    } catch {
      Alert.alert('No connection', 'Could not reach the map search service.');
    } finally {
      setSearching(false);
    }
  }

  /**
   * The third way to set the pin, for the admin who is standing at the
   * shop: take the device's own position instead of describing it.
   *
   * `'fresh'` precision, the same mode the executive's pin-capture screen
   * uses, and for a stronger reason. `POST /shops` AUTO-APPROVES whatever
   * location it is given (`shops.service.ts`: "a direct capture here"),
   * with no server-side accuracy gate to catch a bad one — so a 500 m
   * cell-tower fix saved here would silently become the fixed point every
   * future visit to this shop is measured against. `'fresh'` refuses a
   * cached reading and does not fall back to a coarse provider: it either
   * gets a real GPS fix or says it could not, which is the honest answer
   * when there is nothing downstream to catch the difference.
   *
   * The reading's accuracy is shown in the caption rather than enforced
   * here. Nothing in the contract gates it on this endpoint, and inventing
   * a client-only threshold would be a rule the server does not share —
   * the admin can see the figure and drag the pin if it looks wrong.
   */
  async function useCurrentLocation(): Promise<void> {
    setLocating(true);
    try {
      const fix = await getCurrentPosition('fresh');
      if (!fix.ok) {
        Alert.alert(
          'Location unavailable',
          locationFailureMessage(fix.failure, 'the locate button'),
        );
        return;
      }
      setSkip(false);
      setLocation({
        latitude: fix.position.latitude,
        longitude: fix.position.longitude,
        source: 'GPS',
        // The searched address, if there was one, described a different
        // point — keeping it next to these coordinates would caption the
        // pin with somewhere it no longer is.
        label: null,
        accuracyMeters: fix.position.accuracyMeters,
      });
      mapRef.current?.animateToRegion(
        {
          latitude: fix.position.latitude,
          longitude: fix.position.longitude,
          ...APPROVED_REGION_DELTA,
        },
        400,
      );
    } finally {
      setLocating(false);
    }
  }

  function onMapInteraction(latitude: number, longitude: number): void {
    setSkip(false);
    setLocation((prev) => ({
      latitude,
      longitude,
      source: 'MANUAL_DRAG',
      label: prev?.label ?? null,
      // Dropped deliberately: a hand-placed point has no measurement error
      // to report, and carrying the last GPS reading's figure over would
      // attach it to coordinates it never described.
      accuracyMeters: null,
    }));
  }

  function toggleSkip(): void {
    setSkip((prev) => {
      const next = !prev;
      if (next) {
        setLocation(null);
      }
      return next;
    });
  }

  async function onSubmit(): Promise<void> {
    setSubmitError(null);

    const trimmedRadius = radius.trim();
    const payload = {
      shopCode: shopCode.trim(),
      name: name.trim(),
      isActive,
      ownerName: ownerName.trim() || undefined,
      phone: phone.trim() || undefined,
      addressLine1: addressLine1.trim() || undefined,
      addressLine2: addressLine2.trim() || undefined,
      city: city.trim() || undefined,
      state: state.trim() || undefined,
      postalCode: postalCode.trim() || undefined,
      verificationRadiusMeters: trimmedRadius
        ? Number(trimmedRadius)
        : undefined,
      location:
        location && !skip
          ? {
              latitude: location.latitude,
              longitude: location.longitude,
              source: location.source,
            }
          : undefined,
    };

    const schema = isEditing ? updateShopSchema : createShopSchema;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      setSubmitError(parsed.error.issues[0]?.message ?? 'Invalid input.');
      return;
    }

    setSubmitting(true);
    try {
      const shop = isEditing
        ? await apiRequest<ShopSummaryForEdit>(`/shops/${editingShop?.id}`, {
            method: 'PATCH',
            body: parsed.data,
            idempotencyKey: generateIdempotencyKey(),
          })
        : await apiRequest<ShopSummaryForEdit>('/shops', {
            method: 'POST',
            body: parsed.data,
            idempotencyKey: generateIdempotencyKey(),
          });

      for (const photo of pendingPhotos) {
        const formData = new FormData();
        // SAFETY: same RN FormData file-descriptor shape UserFormScreen.tsx's
        // pickAndUploadPhoto uses — no RN-specific FormData type package in
        // this project to type this more precisely against.
        formData.append('photo', {
          uri: photo.uri,
          name: photo.name,
          type: photo.type,
        });
        await apiRequest(`/shops/${shop.id}/photos`, {
          method: 'POST',
          body: formData,
          idempotencyKey: generateIdempotencyKey(),
        });
      }

      // 003-beat-plans-crud, research.md §3: "Create a new shop in this
      // beat" hands the beat-plan form a callback instead of relying on it
      // to read this screen's result some other way — only fires on a
      // genuine create (never an edit), matching that flow's own intent.
      if (!isEditing) {
        route.params?.onCreated?.(shop);
      }

      navigation.goBack();
    } catch (error) {
      setSubmitError(errorMessageFor(error));
    } finally {
      setSubmitting(false);
    }
  }

  const initialRegion = location
    ? {
        latitude: location.latitude,
        longitude: location.longitude,
        ...APPROVED_REGION_DELTA,
      }
    : DEFAULT_REGION;

  /**
   * A new shop opens on `DEFAULT_REGION` — the whole of India — which is
   * useless to someone standing at the shop, and makes the map look broken
   * rather than merely unset. So the view is moved to wherever the device
   * is, once, on open.
   *
   * This moves the CAMERA only. It deliberately does NOT drop the pin:
   * `POST /shops` auto-approves whatever location it is given with no
   * accuracy gate, so an admin adding shops from the office would silently
   * stamp the office's coordinates onto every one of them, and every future
   * visit to those shops would then be measured against the wrong point.
   * Setting the pin stays an explicit act — the button below the map.
   *
   * `'fast'` precision, not `'fresh'`: nothing is being saved, so a cached
   * Wi-Fi fix positions the camera just as usefully as a GPS lock and
   * returns in well under a second instead of up to 15 s.
   *
   * Failure is silent on purpose. The admin never asked for this, so there
   * is nothing to apologise for — they are left on the country view with
   * the search box and the button, exactly as before.
   */
  useEffect(() => {
    // Only for a shop with no pin yet. An existing pin is the better
    // centre, and `initialRegion` is already on it.
    if (location) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const fix = await getCurrentPosition('fast');
      if (cancelled || !fix.ok) {
        return;
      }
      mapRef.current?.animateToRegion(
        {
          latitude: fix.position.latitude,
          longitude: fix.position.longitude,
          ...APPROVED_REGION_DELTA,
        },
        400,
      );
    })();
    return () => {
      cancelled = true;
    };
    // Once, on open. `location` is read above as a guard rather than a
    // dependency: re-running this when the admin sets a pin would yank the
    // camera back off the point they just chose.
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 32,
          gap: 14,
        }}
        style={{ flex: 1 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable
            accessibilityLabel={isEditing ? 'Back' : 'Close'}
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
              shapes={isEditing ? ICON_BACK : ICON_CLOSE}
              size={20}
              strokeWidth={2}
            />
          </Pressable>
          <Text
            style={{ fontSize: 24, fontWeight: '700', color: INK, flexGrow: 1 }}
          >
            {isEditing ? 'Edit shop' : 'New shop'}
          </Text>
        </View>

        <Group>
          <SectionLabel>Shop</SectionLabel>
          <View>
            <FieldLabel>Beat plan</FieldLabel>
            <Pressable
              accessibilityHint="Managed from the beat plan's own shop list"
              onPress={() =>
                Alert.alert(
                  'Beat plan',
                  'A shop’s beat plan is managed from the beat plan itself — open the beat plan and add or remove this shop from its shop list.',
                )
              }
              style={[
                INPUT_STYLE,
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  opacity: 0.7,
                },
              ]}
              testID="shop-form-beat-plan"
            >
              <Text
                style={{
                  fontSize: 15,
                  color: beatPlanNames.length > 0 ? INK : MUTED,
                }}
              >
                {beatPlanNames.length > 0
                  ? beatPlanNames.join(', ')
                  : 'Unassigned'}
              </Text>
              <OutlineIcon
                color={MUTED}
                shapes={ICON_CHEVRON_DOWN}
                size={14}
                strokeWidth={2}
              />
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <FieldLabel>Shop code</FieldLabel>
              <TextInput
                autoCapitalize="characters"
                onChangeText={setShopCode}
                style={[INPUT_STYLE, { fontFamily: 'monospace' }]}
                testID="shop-form-code"
                value={shopCode}
              />
            </View>
            <View style={{ flex: 1 }}>
              <FieldLabel>Status</FieldLabel>
              <Pressable
                onPress={() => setIsActive((prev) => !prev)}
                style={[
                  INPUT_STYLE,
                  {
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  },
                ]}
                testID="shop-form-status"
              >
                <Text style={{ fontSize: 15, color: INK }}>
                  {isActive ? 'Active' : 'Inactive'}
                </Text>
                <OutlineIcon
                  color={INK}
                  shapes={ICON_CHEVRON_DOWN}
                  size={14}
                  strokeWidth={2}
                />
              </Pressable>
            </View>
          </View>
          <View>
            <FieldLabel>Shop name</FieldLabel>
            <TextInput
              onChangeText={setName}
              style={INPUT_STYLE}
              testID="shop-form-name"
              value={name}
            />
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <FieldLabel>Owner name</FieldLabel>
              <TextInput
                onChangeText={setOwnerName}
                style={INPUT_STYLE}
                testID="shop-form-owner"
                value={ownerName}
              />
            </View>
            <View style={{ flex: 1 }}>
              <FieldLabel>Phone</FieldLabel>
              <TextInput
                inputMode="tel"
                onChangeText={setPhone}
                style={[INPUT_STYLE, { fontFamily: 'monospace' }]}
                testID="shop-form-phone"
                value={phone}
              />
            </View>
          </View>
        </Group>

        <Group>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <SectionLabel>Shop photo</SectionLabel>
            <Text style={{ fontSize: 12, color: MUTED }}>
              {totalPhotoCount} of {MAX_PHOTOS} added
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            {existingPhotos.map((photo) => (
              <View
                key={photo.id}
                style={{
                  width: 104,
                  height: 104,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: '#CBD2DD',
                  overflow: 'hidden',
                }}
              >
                <Image
                  source={{ uri: resolveFileUrl(photo.url) }}
                  style={{ width: 104, height: 104 }}
                />
                <Pressable
                  accessibilityLabel="Remove photo"
                  onPress={() => void removeExistingPhoto(photo.id)}
                  style={{
                    position: 'absolute',
                    right: 6,
                    top: 6,
                    width: 26,
                    height: 26,
                    borderRadius: 13,
                    backgroundColor: 'rgba(20,26,38,0.72)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <OutlineIcon
                    color="#FFFFFF"
                    shapes={ICON_REMOVE}
                    size={14}
                    strokeWidth={2.4}
                  />
                </Pressable>
              </View>
            ))}
            {pendingPhotos.map((photo, index) => (
              <View
                key={`pending-${index}`}
                style={{
                  width: 104,
                  height: 104,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: '#CBD2DD',
                  overflow: 'hidden',
                }}
              >
                <Image
                  source={{ uri: photo.uri }}
                  style={{ width: 104, height: 104 }}
                />
                <Pressable
                  accessibilityLabel="Remove photo"
                  onPress={() => removePendingPhoto(index)}
                  style={{
                    position: 'absolute',
                    right: 6,
                    top: 6,
                    width: 26,
                    height: 26,
                    borderRadius: 13,
                    backgroundColor: 'rgba(20,26,38,0.72)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <OutlineIcon
                    color="#FFFFFF"
                    shapes={ICON_REMOVE}
                    size={14}
                    strokeWidth={2.4}
                  />
                </Pressable>
              </View>
            ))}
            {totalPhotoCount < MAX_PHOTOS ? (
              <Pressable
                onPress={() => void pickPhoto('gallery')}
                style={{
                  width: 104,
                  height: 104,
                  borderRadius: 14,
                  borderWidth: 1.5,
                  borderStyle: 'dashed',
                  borderColor: BLUE,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
                testID="shop-form-add-photo"
              >
                <OutlineIcon
                  color={BLUE}
                  shapes={ICON_CAMERA}
                  size={20}
                  strokeWidth={1.8}
                />
                <Text style={{ fontSize: 13, fontWeight: '700', color: BLUE }}>
                  Add photo
                </Text>
              </Pressable>
            ) : null}
          </View>
          {totalPhotoCount < MAX_PHOTOS ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={() => void pickPhoto('camera')}
                style={{
                  flex: 1,
                  height: 48,
                  borderRadius: 12,
                  backgroundColor: BLUE,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
                testID="shop-form-take-photo"
              >
                <OutlineIcon
                  color="#FFFFFF"
                  shapes={ICON_CAMERA}
                  size={16}
                  strokeWidth={1.9}
                />
                <Text
                  style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}
                >
                  Take photo
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void pickPhoto('gallery')}
                style={{
                  flex: 1,
                  height: 48,
                  borderRadius: 12,
                  borderWidth: 1.5,
                  borderColor: '#CBD2DD',
                  backgroundColor: '#FFFFFF',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
                testID="shop-form-gallery"
              >
                <OutlineIcon
                  color={INK}
                  shapes={ICON_GALLERY}
                  size={18}
                  strokeWidth={1.8}
                />
                <Text style={{ fontSize: 15, fontWeight: '600', color: INK }}>
                  Gallery
                </Text>
              </Pressable>
            </View>
          ) : null}
          <Text style={{ fontSize: 12, color: MUTED, lineHeight: 17 }}>
            A clear shot of the shop front helps the executive find it. Up to 3
            photos, JPG or PNG, 5 MB each.
          </Text>
        </Group>

        <Group>
          <SectionLabel>Address</SectionLabel>
          <View>
            <FieldLabel>Line 1</FieldLabel>
            <TextInput
              onChangeText={setAddressLine1}
              style={INPUT_STYLE}
              testID="shop-form-address1"
              value={addressLine1}
            />
          </View>
          <View>
            <FieldLabel>Line 2 (optional)</FieldLabel>
            <TextInput
              onChangeText={setAddressLine2}
              style={INPUT_STYLE}
              testID="shop-form-address2"
              value={addressLine2}
            />
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <FieldLabel>City</FieldLabel>
              <TextInput
                onChangeText={setCity}
                style={INPUT_STYLE}
                testID="shop-form-city"
                value={city}
              />
            </View>
            <View style={{ flex: 1 }}>
              <FieldLabel>State</FieldLabel>
              <TextInput
                onChangeText={setState}
                style={INPUT_STYLE}
                testID="shop-form-state"
                value={state}
              />
            </View>
            <View style={{ flex: 1 }}>
              <FieldLabel>PIN code</FieldLabel>
              <TextInput
                inputMode="numeric"
                onChangeText={setPostalCode}
                style={[INPUT_STYLE, { fontFamily: 'monospace' }]}
                testID="shop-form-postal-code"
                value={postalCode}
              />
            </View>
          </View>
        </Group>

        <Group>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <SectionLabel>Location</SectionLabel>
            <Text style={{ fontSize: 12, color: MUTED }}>Optional now</Text>
          </View>
          <View
            style={{
              borderRadius: 14,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: '#CBD2DD',
              opacity: skip ? 0.5 : 1,
            }}
          >
            <MapView
              initialRegion={initialRegion}
              onPress={(event) => {
                if (skip) {
                  return;
                }
                const { latitude, longitude } = event.nativeEvent.coordinate;
                onMapInteraction(latitude, longitude);
              }}
              pointerEvents={skip ? 'none' : 'auto'}
              ref={mapRef}
              style={{ width: '100%', height: 180 }}
              testID="shop-form-map"
            >
              {location ? (
                <Marker
                  coordinate={{
                    latitude: location.latitude,
                    longitude: location.longitude,
                  }}
                  draggable
                  onDragEnd={(event) => {
                    const { latitude, longitude } =
                      event.nativeEvent.coordinate;
                    onMapInteraction(latitude, longitude);
                  }}
                />
              ) : null}
            </MapView>
            <View
              style={{
                position: 'absolute',
                left: 10,
                right: 10,
                top: 10,
                height: 40,
                borderRadius: 10,
                backgroundColor: '#FFFFFF',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingHorizontal: 10,
                shadowColor: '#141A26',
                shadowOpacity: 0.12,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 2 },
                elevation: 3,
              }}
            >
              <OutlineIcon
                color={MUTED}
                shapes={ICON_SEARCH}
                size={16}
                strokeWidth={2}
              />
              <TextInput
                editable={!skip}
                onChangeText={setSearchQuery}
                onSubmitEditing={() => void runSearch()}
                placeholder="Search an address"
                placeholderTextColor={MUTED}
                returnKeyType="search"
                style={{ flexGrow: 1, fontSize: 14, color: INK }}
                testID="shop-form-location-search"
                value={searchQuery}
              />
              {searching ? <ActivityIndicator size="small" /> : null}
            </View>
          </View>
          {/*
            A labelled button under the map, not an icon floating on it.
            The first attempt was the conventional crosshair overlay in the
            map's corner; on a real build it went unfound — a 40px white
            circle with a thin grey glyph reads as map chrome, not as a
            control, and the native map surface is a bad neighbourhood for
            a small sibling view. Board 4.9 has no locate control to copy,
            so this borrows the board's OWN field treatment (`.inp`: 1.5px
            #CBD2DD, radius 12, white) at button height rather than its
            `.btn`, which is the blue Save shop button and must not have a
            rival.
          */}
          <Pressable
            accessibilityLabel="Use my current location"
            accessibilityRole="button"
            disabled={skip || locating}
            onPress={() => void useCurrentLocation()}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              height: 48,
              borderRadius: 12,
              borderWidth: 1.5,
              borderColor: '#CBD2DD',
              backgroundColor: '#FFFFFF',
              opacity: skip ? 0.5 : 1,
            }}
            testID="shop-form-use-current-location"
          >
            {locating ? (
              <ActivityIndicator size="small" />
            ) : (
              <OutlineIcon
                color={BLUE}
                shapes={ICON_LOCATE}
                size={18}
                strokeWidth={2}
              />
            )}
            <Text style={{ fontSize: 15, fontWeight: '600', color: INK }}>
              {locating ? 'Getting your location…' : 'Use my current location'}
            </Text>
          </Pressable>
          <Text style={{ fontFamily: 'monospace', fontSize: 12, color: MUTED }}>
            {location
              ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)} · source: ${SOURCE_LABEL[location.source]}${location.accuracyMeters !== null ? ` ±${location.accuracyMeters}m` : ''} · drag pin to adjust`
              : 'Tap the map, search an address, or use the button above to set a location'}
          </Text>
          <Checkbox
            checked={skip}
            label="Skip — the executive captures the pin on the first visit"
            onToggle={toggleSkip}
          />
        </Group>

        <Group>
          <SectionLabel>Visit radius</SectionLabel>
          <View>
            <FieldLabel>Override for this shop (metres)</FieldLabel>
            <TextInput
              inputMode="numeric"
              onChangeText={setRadius}
              placeholder="Leave blank for the company default"
              placeholderTextColor={MUTED}
              style={[INPUT_STYLE, { fontFamily: 'monospace' }]}
              testID="shop-form-radius"
              value={radius}
            />
          </View>
          <Text style={{ fontSize: 12, color: MUTED, lineHeight: 17 }}>
            Leave blank to use the company default. Pin changes after save go
            through the correction workflow and are audited.
          </Text>
        </Group>

        {submitError ? (
          <Text style={{ fontSize: 13, color: '#A3261B', textAlign: 'center' }}>
            {submitError}
          </Text>
        ) : null}

        <Pressable
          disabled={submitting}
          onPress={() => void onSubmit()}
          style={{
            height: 54,
            borderRadius: 14,
            backgroundColor: BLUE,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: submitting ? 0.6 : 1,
          }}
          testID="shop-form-save"
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}>
              Save shop
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}
