import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolveFileUrl } from '../../api/client';
import {
  OutlineIcon,
  type IconShape,
} from '../../components/icons/OutlineIcon';

/**
 * The shop-photos bottom sheet and its full-screen viewer, from
 * `claude design/Shop Photos UX.html` — boards "Shop photos bottom sheet"
 * ("Popup alternative · bottom sheet") and "Full-screen shop photo viewer".
 *
 * Every hex, radius, size and stroke width below is taken verbatim from
 * those two boards' decoded markup, per CLAUDE.md's standing rule that a
 * screen matches its board exactly rather than approximately.
 *
 * Two things the boards show that this cannot, because the data does not
 * exist rather than because it was skipped:
 *
 *   * **Per-photo labels** ("Storefront", "Inside the shop", "Display
 *     racks"). `ShopPhoto` has no kind/label column — those are the board's
 *     sample captions. The caption reads "Photo N of M" instead, which is
 *     true. Giving every photo the word "Storefront" would be a caption
 *     that lies.
 *   * **A real image in the viewer's placeholder tiles.** The boards draw
 *     flat colour blocks with a picture glyph because they had no photo to
 *     show; here the actual photo is rendered in that frame, and the glyph
 *     is kept only as the fallback for a photo that fails to load.
 */

const ICON_CLOSE: IconShape[] = [{ d: 'M6 6l12 12M18 6L6 18' }];
const ICON_EXPAND: IconShape[] = [
  { d: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5' },
];
const ICON_PREV: IconShape[] = [{ d: 'M15 6l-6 6 6 6' }];
const ICON_NEXT: IconShape[] = [{ d: 'M9 6l6 6-6 6' }];
const ICON_PLUS: IconShape[] = [{ d: 'M12 5v14M5 12h14' }];
/** The boards' picture glyph — the placeholder behind a photo that will not load. */
const ICON_PICTURE: IconShape[] = [
  { rect: [3, 4, 18, 16, 2] },
  { circle: [9, 10, 2] },
  { d: 'M21 16l-5-5-9 9' },
];

export interface ShopPhoto {
  id: string;
  /** `?thumb=1` — the 64px strip. */
  url: string;
  /** Full size — the pager and the full-screen viewer. */
  fullUrl: string;
  createdAt: string;
}

/** The board's "Added 12 Nov 2026". */
function formatAddedOn(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return `Added ${date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;
}

/**
 * The photo frame used by both the sheet's pager and the viewer: the real
 * image, with the board's flat block + picture glyph behind it as the
 * fallback for a signed URL that fails (expired token, pruned file, no
 * connection).
 */
function PhotoFrame({
  uri,
  height,
  radius,
  background,
}: {
  uri: string;
  height: number;
  radius: number;
  background: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);

  return (
    <View
      style={{
        width: '100%',
        height,
        borderRadius: radius,
        backgroundColor: background,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {failed ? (
        <View style={{ alignItems: 'center', gap: 8 }}>
          <OutlineIcon
            color="#1F2937"
            shapes={ICON_PICTURE}
            size={48}
            strokeWidth={1.5}
          />
          <Text style={{ fontSize: 15, fontWeight: '600', color: '#1F2937' }}>
            Photo unavailable
          </Text>
        </View>
      ) : (
        <Image
          onError={() => setFailed(true)}
          resizeMode="cover"
          source={{ uri }}
          style={{ width: '100%', height: '100%' }}
        />
      )}
    </View>
  );
}

/** A 64x64 strip thumbnail. `active` draws the board's ring. */
function StripThumb({
  photo,
  active,
  activeRingColor,
  onPress,
  index,
}: {
  photo: ShopPhoto;
  active: boolean;
  /** #1D4ED8 in the sheet (on white), #FFFFFF in the viewer (on black). */
  activeRingColor: string;
  onPress: () => void;
  index: number;
}) {
  return (
    <Pressable
      accessibilityLabel={`Show photo ${index + 1}`}
      onPress={onPress}
      style={{
        width: 64,
        height: 64,
        borderRadius: 10,
        borderWidth: 2,
        borderColor: active ? activeRingColor : 'transparent',
        // The viewer board dims every thumbnail but the current one.
        opacity: active ? 1 : 0.55,
        overflow: 'hidden',
        backgroundColor: '#CBD5E1',
      }}
      testID={`shop-photos-thumb-${index}`}
    >
      <Image
        resizeMode="cover"
        source={{ uri: resolveFileUrl(photo.url) }}
        style={{ width: '100%', height: '100%' }}
      />
    </Pressable>
  );
}

/**
 * Board "Full-screen shop photo viewer". Opened from the sheet's expand
 * control, which is why it lives here rather than as its own screen — it is
 * a layer over the sheet, and closing it returns to the sheet underneath.
 */
function FullScreenViewer({
  shopName,
  shopCode,
  photos,
  index,
  onIndexChange,
  onClose,
}: {
  shopName: string;
  shopCode: string;
  photos: ShopPhoto[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const current = photos[index];

  return (
    <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View
        style={{
          flex: 1,
          backgroundColor: '#0B0B0F',
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingTop: 12,
            paddingHorizontal: 8,
            paddingBottom: 8,
          }}
        >
          <Pressable
            accessibilityLabel="Close photos"
            onPress={onClose}
            style={{
              width: 44,
              height: 44,
              borderRadius: 999,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            testID="shop-photos-viewer-close"
          >
            <OutlineIcon
              color="#FFFFFF"
              shapes={ICON_CLOSE}
              size={24}
              strokeWidth={2.2}
            />
          </Pressable>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text
              numberOfLines={1}
              style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}
            >
              {shopName}
            </Text>
            <Text style={{ fontSize: 13, color: '#C9CDD4' }}>
              {shopCode} · Photo {index + 1} of {photos.length}
            </Text>
          </View>
        </View>

        <View
          style={{
            flex: 1,
            minHeight: 0,
            justifyContent: 'center',
          }}
        >
          {current ? (
            <PhotoFrame
              background="#0B0B0F"
              height={440}
              radius={0}
              uri={resolveFileUrl(current.fullUrl)}
            />
          ) : null}
          {index > 0 ? (
            <Pressable
              accessibilityLabel="Previous photo"
              onPress={() => onIndexChange(index - 1)}
              style={{
                position: 'absolute',
                left: 10,
                width: 44,
                height: 44,
                borderRadius: 999,
                backgroundColor: 'rgba(17, 24, 39, 0.6)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <OutlineIcon
                color="#FFFFFF"
                shapes={ICON_PREV}
                size={22}
                strokeWidth={2.4}
              />
            </Pressable>
          ) : null}
          {index < photos.length - 1 ? (
            <Pressable
              accessibilityLabel="Next photo"
              onPress={() => onIndexChange(index + 1)}
              style={{
                position: 'absolute',
                right: 10,
                width: 44,
                height: 44,
                borderRadius: 999,
                backgroundColor: 'rgba(17, 24, 39, 0.6)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <OutlineIcon
                color="#FFFFFF"
                shapes={ICON_NEXT}
                size={22}
                strokeWidth={2.4}
              />
            </Pressable>
          ) : null}
        </View>

        <View
          style={{
            paddingTop: 14,
            paddingHorizontal: 20,
            paddingBottom: 4,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'baseline',
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}>
            Photo {index + 1} of {photos.length}
          </Text>
          <Text style={{ fontSize: 13, color: '#C9CDD4' }}>
            {current ? formatAddedOn(current.createdAt) : ''}
          </Text>
        </View>

        {/* The board hides the strip for a single photo and leaves a 40px gap. */}
        {photos.length > 1 ? (
          <View
            style={{
              paddingTop: 12,
              paddingHorizontal: 20,
              paddingBottom: 28,
              flexDirection: 'row',
              gap: 10,
            }}
          >
            {photos.map((photo, i) => (
              <StripThumb
                active={i === index}
                activeRingColor="#FFFFFF"
                index={i}
                key={photo.id}
                onPress={() => onIndexChange(i)}
                photo={photo}
              />
            ))}
          </View>
        ) : (
          <View style={{ height: 40 }} />
        )}
      </View>
    </Modal>
  );
}

/**
 * Board "Shop photos bottom sheet": a scrim over the list, a 640px-tall
 * white sheet with a grab handle, a horizontally paged photo carousel, page
 * dots, a caption row and a 64px thumbnail strip ending in "add photo".
 */
export function ShopPhotosSheet({
  visible,
  shopName,
  shopCode,
  photos,
  onClose,
  onAddPhoto,
  canAddPhoto,
}: {
  visible: boolean;
  shopName: string;
  shopCode: string;
  photos: ShopPhoto[];
  onClose: () => void;
  onAddPhoto: () => void;
  /** False once the shop is at the `MAX_SHOP_PHOTOS` cap — the board's add tile is then not drawn. */
  canAddPhoto: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);

  // Reopening on a different shop must start at its first photo, and a
  // deleted photo must not leave the pager pointing past the end.
  useEffect(() => {
    if (visible) {
      setIndex(0);
    }
  }, [visible, shopCode]);
  useEffect(() => {
    setIndex((prev) => Math.min(prev, Math.max(0, photos.length - 1)));
  }, [photos.length]);

  const current = photos[index];
  /** Board: slide 320 wide + 10 gap, inside 20px side padding. */
  const slideWidth = 320;
  const slideGap = 10;

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      {/* Scrim — tapping it closes, the usual bottom-sheet affordance. */}
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(11, 11, 15, 0.55)' }}
        testID="shop-photos-scrim"
      />
      <View
        accessibilityLabel="Shop photos"
        accessibilityRole="none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 640 + insets.bottom,
          paddingBottom: insets.bottom,
          backgroundColor: '#FFFFFF',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: -8 },
          shadowOpacity: 0.18,
          shadowRadius: 24,
          elevation: 24,
        }}
        testID="shop-photos-sheet"
      >
        <View style={{ alignItems: 'center', paddingTop: 10 }}>
          <View
            style={{
              width: 40,
              height: 5,
              borderRadius: 999,
              backgroundColor: '#D1D5DB',
            }}
          />
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingTop: 10,
            paddingRight: 8,
            paddingBottom: 12,
            paddingLeft: 20,
          }}
        >
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text
              numberOfLines={1}
              style={{ fontSize: 18, fontWeight: '700', color: '#111827' }}
            >
              {shopName}
            </Text>
            <Text style={{ fontSize: 13, color: '#4B5563' }}>
              {shopCode} · {photos.length}{' '}
              {photos.length === 1 ? 'photo' : 'photos'}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Close photos"
            onPress={onClose}
            style={{
              width: 44,
              height: 44,
              borderRadius: 999,
              backgroundColor: '#F3F4F6',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            testID="shop-photos-close"
          >
            <OutlineIcon
              color="#111827"
              shapes={ICON_CLOSE}
              size={20}
              strokeWidth={2.2}
            />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, gap: slideGap }}
          decelerationRate="fast"
          horizontal
          onMomentumScrollEnd={(event) => {
            // Keep the dots and the caption in step with a swipe, not only
            // with a thumbnail tap.
            const x = event.nativeEvent.contentOffset.x;
            setIndex(
              Math.max(
                0,
                Math.min(
                  photos.length - 1,
                  Math.round(x / (slideWidth + slideGap)),
                ),
              ),
            );
          }}
          showsHorizontalScrollIndicator={false}
          // Snap to a slide + its gap, so a swipe always lands on a photo.
          snapToInterval={slideWidth + slideGap}
        >
          {photos.map((photo, i) => (
            <View key={photo.id} style={{ width: slideWidth }}>
              <PhotoFrame
                background="#CBD5E1"
                height={300}
                radius={16}
                uri={resolveFileUrl(photo.fullUrl)}
              />
              <View
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  paddingVertical: 4,
                  paddingHorizontal: 10,
                  borderRadius: 999,
                  backgroundColor: 'rgba(17, 24, 39, 0.75)',
                }}
              >
                <Text
                  style={{ fontSize: 12, fontWeight: '700', color: '#FFFFFF' }}
                >
                  {i + 1} / {photos.length}
                </Text>
              </View>
              <Pressable
                accessibilityLabel="View full screen"
                onPress={() => {
                  setIndex(i);
                  setViewerOpen(true);
                }}
                style={{
                  position: 'absolute',
                  bottom: 10,
                  right: 10,
                  width: 44,
                  height: 44,
                  borderRadius: 999,
                  backgroundColor: 'rgba(17, 24, 39, 0.75)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                testID={`shop-photos-expand-${i}`}
              >
                <OutlineIcon
                  color="#FFFFFF"
                  shapes={ICON_EXPAND}
                  size={20}
                  strokeWidth={2.2}
                />
              </Pressable>
            </View>
          ))}
        </ScrollView>

        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 6,
            paddingTop: 14,
            paddingBottom: 6,
          }}
        >
          {photos.map((photo, i) => (
            <View
              key={photo.id}
              style={{
                width: i === index ? 18 : 6,
                height: 6,
                borderRadius: 999,
                backgroundColor: i === index ? '#1D4ED8' : '#CBD5E1',
              }}
            />
          ))}
        </View>

        <View
          style={{
            paddingTop: 6,
            paddingHorizontal: 20,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'baseline',
          }}
        >
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#111827' }}>
            Photo {index + 1} of {photos.length}
          </Text>
          <Text style={{ fontSize: 13, color: '#4B5563' }}>
            {current ? formatAddedOn(current.createdAt) : ''}
          </Text>
        </View>

        <View
          style={{
            paddingTop: 14,
            paddingHorizontal: 20,
            flexDirection: 'row',
            gap: 10,
          }}
        >
          {photos.map((photo, i) => (
            <StripThumb
              active={i === index}
              activeRingColor="#1D4ED8"
              index={i}
              key={photo.id}
              onPress={() => setIndex(i)}
              photo={photo}
            />
          ))}
          {canAddPhoto ? (
            <Pressable
              accessibilityLabel="Add photo"
              onPress={onAddPhoto}
              style={{
                width: 64,
                height: 64,
                borderRadius: 10,
                borderWidth: 1.5,
                borderStyle: 'dashed',
                borderColor: '#9CA3AF',
                backgroundColor: '#FFFFFF',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              testID="shop-photos-add"
            >
              <OutlineIcon
                color="#374151"
                shapes={ICON_PLUS}
                size={22}
                strokeWidth={2}
              />
            </Pressable>
          ) : null}
        </View>
      </View>

      {viewerOpen && photos.length > 0 ? (
        <FullScreenViewer
          index={index}
          onClose={() => setViewerOpen(false)}
          onIndexChange={setIndex}
          photos={photos}
          shopCode={shopCode}
          shopName={shopName}
        />
      ) : null}
    </Modal>
  );
}

/**
 * The list card's photo control — board "Shop card photo icon states".
 *
 * Two states, each a 32px pill inside a 44px tap target (the board's own
 * sizing: the pill is what you see, the 44px button is what you can hit):
 *   * **Has photos** — filled #EEF2FF/#1D4ED8, camera glyph, the count.
 *   * **No photos** — 1.5px dashed #9CA3AF outline, plus glyph, "Photo".
 *
 * The board's third state ("Uploading (offline queue)", amber #FFF7ED with
 * an upload glyph) is NOT rendered: shop photos have no offline queue —
 * `outbox.ts` holds visits, extra stops, pins and beat start/end, and a
 * photo upload is a direct multipart POST. There is no pending count to
 * show, so drawing that state would be inventing a status.
 */
const ICON_CAMERA: IconShape[] = [
  {
    d: 'M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z',
  },
  { circle: [12, 13.5, 3.5] },
];

export function ShopPhotoPill({
  count,
  shopName,
  onPress,
}: {
  count: number;
  shopName: string;
  onPress: () => void;
}) {
  const hasPhotos = count > 0;

  return (
    <Pressable
      accessibilityLabel={
        hasPhotos
          ? `View ${count} ${count === 1 ? 'photo' : 'photos'} of ${shopName}`
          : 'Add shop photos'
      }
      hitSlop={4}
      onPress={onPress}
      style={{
        flexShrink: 0,
        height: 44,
        paddingHorizontal: 8,
        justifyContent: 'center',
      }}
      testID={hasPhotos ? 'shop-photo-pill' : 'shop-photo-pill-empty'}
    >
      <View
        style={{
          height: 32,
          // The board sets 12px for the filled pill and 11px for the dashed
          // one, so both render the same outer width despite the border.
          paddingHorizontal: hasPhotos ? 12 : 11,
          borderRadius: 999,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          ...(hasPhotos
            ? { backgroundColor: '#EEF2FF' }
            : {
                borderWidth: 1.5,
                borderStyle: 'dashed' as const,
                borderColor: '#9CA3AF',
              }),
        }}
      >
        <OutlineIcon
          color={hasPhotos ? '#1D4ED8' : '#374151'}
          shapes={hasPhotos ? ICON_CAMERA : ICON_PLUS}
          size={16}
          strokeWidth={2}
        />
        <Text
          style={{
            fontSize: 13,
            fontWeight: hasPhotos ? '700' : '600',
            color: hasPhotos ? '#1D4ED8' : '#374151',
          }}
        >
          {hasPhotos ? String(count) : 'Photo'}
        </Text>
      </View>
    </Pressable>
  );
}
