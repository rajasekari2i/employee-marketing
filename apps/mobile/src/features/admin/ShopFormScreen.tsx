import { useRef, useState } from 'react';
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
import type { AdminStackParamList } from '../../navigation/RootNavigator';
import { BG, BLUE, BORDER, INK, LABEL, MUTED } from './adminDesign';

/**
 * PRD §4 screen 4.9 ("New shop"). Layout/colors/icons below are taken
 * verbatim from `docs/ui-design/Field_Sales_Beat_App.html` §4.9 — see that
 * board for the source of every hex value and SVG path here. There is no
 * separate "edit shop" board — per the feature spec, editing opens this
 * same screen pre-filled, titled "Edit shop" instead of "New shop" (FR-013).
 *
 * "Beat plan" is rendered exactly as the design shows it but disabled —
 * `BeatPlan` doesn't exist yet (research.md §1, 002-shops-crud).
 *
 * Location is a real `react-native-maps` `MapView` (research.md §2): tap
 * or drag to place the pin, or search an address via the Google Geocoding
 * API using the same `GOOGLE_MAPS_API_KEY` the Android manifest already
 * carries. Map tiles won't render without a real key configured for the
 * active build flavor — the rest of this screen still works regardless.
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

/** Default map center when a shop has no pin yet and nothing has been searched/dragged — central India, a neutral country-level view. */
const DEFAULT_REGION = {
  latitude: 20.5937,
  longitude: 78.9629,
  latitudeDelta: 8,
  longitudeDelta: 8,
};

const APPROVED_REGION_DELTA = { latitudeDelta: 0.01, longitudeDelta: 0.01 };

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
        }
      : null,
  );
  const [skip, setSkip] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function pickPhoto(source: 'camera' | 'gallery'): Promise<void> {
    const result =
      source === 'camera'
        ? await launchCamera({ mediaType: 'photo', quality: 0.8 })
        : await launchImageLibrary({ mediaType: 'photo', quality: 0.8 });
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

  function onMapInteraction(latitude: number, longitude: number): void {
    setSkip(false);
    setLocation((prev) => ({
      latitude,
      longitude,
      source: 'MANUAL_DRAG',
      label: prev?.label ?? null,
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
        ? await apiRequest<{ id: string }>(`/shops/${editingShop?.id}`, {
            method: 'PATCH',
            body: parsed.data,
            idempotencyKey: generateIdempotencyKey(),
          })
        : await apiRequest<{ id: string }>('/shops', {
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
              accessibilityHint="Available once beat plans are set up"
              onPress={() =>
                Alert.alert(
                  'Beat plans',
                  'Assigning a beat plan is available once beat plans are set up.',
                )
              }
              style={[
                INPUT_STYLE,
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  opacity: 0.5,
                },
              ]}
              testID="shop-form-beat-plan"
            >
              <Text style={{ fontSize: 15, color: MUTED }}>Unassigned</Text>
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
          <Text style={{ fontFamily: 'monospace', fontSize: 12, color: MUTED }}>
            {location
              ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)} · source: ${location.source === 'MAP_SEARCH' ? 'map search' : 'manual drag'} · drag pin to adjust`
              : 'Tap the map or search an address to set a location'}
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
