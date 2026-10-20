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
  View,
} from 'react-native';
import MapView, { Circle, Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  OutlineIcon,
  type IconShape,
} from '../../components/icons/OutlineIcon';
import type { ManagerStackParamList } from '../../navigation/RootNavigator';
import {
  BG,
  BLUE,
  BORDER,
  INK,
  LABEL,
  OUT_OF_RANGE_INK,
  ROW_SEPARATOR,
} from './managerDesign';
import {
  Card,
  FactRow,
  formatDateTime,
  useVisitDetail,
} from './visitDetailShared';
import { LoadNotice } from './loadState';

/**
 * PRD §4 screen 3.6 ("Out-of-range visit · distance"), board uuid
 * `3a9dd747-c459-426e-b830-0060de3036f7` (010-manager-app).
 *
 * **Read-only.** There is no Mark as delivered here even for an order — the
 * manager reaches this screen from the Out of range tab, and the same order
 * opened from the Order tab gets board 3.4 with the action (FR-029).
 *
 * **Known limitation, not a defect**: the dev build's `GOOGLE_MAPS_API_KEY`
 * is empty, so map TILES render blank — the same gap that already affects
 * the executive's pin-capture screen and the admin's shop form. The pin, the
 * radius ring, the submitted point and every number on this screen are
 * correct regardless, and the tiles appear the moment a key is configured.
 *
 * Every value the map draws is the one FROZEN ON THE VISIT, never the
 * shop's current row (FR-030) — so correcting a shop's pin later can never
 * rewrite what a visit was judged against.
 */

const ICON_BACK: IconShape[] = [{ d: 'M15 18l-6-6 6-6' }];

export function OutOfRangeVisitScreen() {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<
      NativeStackNavigationProp<ManagerStackParamList, 'OutOfRangeVisit'>
    >();
  const route = useRoute<RouteProp<ManagerStackParamList, 'OutOfRangeVisit'>>();
  const { visitId } = route.params;

  const { visit, loading, staleNote, error } = useVisitDetail(visitId);

  const loc = visit?.location;
  const hasShopPin = loc?.shopLatitude != null && loc?.shopLongitude != null;

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
          <Text style={{ fontSize: 13, color: OUT_OF_RANGE_INK }}>
            {visit ? `Out of range · ${visit.executiveName}` : 'Out of range'}
          </Text>
          <Text
            numberOfLines={1}
            style={{ fontSize: 22, fontWeight: '700', color: INK }}
          >
            {visit?.shopName ?? ''}
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
        {loading && !visit ? (
          <View style={{ paddingVertical: 48, alignItems: 'center' }}>
            <ActivityIndicator color={BLUE} />
          </View>
        ) : null}
        <LoadNotice error={error} staleNote={staleNote} />

        {visit && loc ? (
          <>
            <View
              style={{
                height: 220,
                borderRadius: 16,
                overflow: 'hidden',
                borderWidth: 1,
                borderColor: BORDER,
                backgroundColor: '#FFFFFF',
              }}
            >
              <MapView
                region={{
                  latitude: hasShopPin
                    ? loc.shopLatitude!
                    : loc.capturedLatitude,
                  longitude: hasShopPin
                    ? loc.shopLongitude!
                    : loc.capturedLongitude,
                  latitudeDelta: 0.004,
                  longitudeDelta: 0.004,
                }}
                scrollEnabled={false}
                style={{ flex: 1 }}
                zoomEnabled={false}
              >
                {hasShopPin ? (
                  <>
                    <Marker
                      coordinate={{
                        latitude: loc.shopLatitude!,
                        longitude: loc.shopLongitude!,
                      }}
                      pinColor={BLUE}
                      title="Shop pin"
                    />
                    {/* The radius IN FORCE WHEN THE VISIT WAS RECORDED. */}
                    <Circle
                      center={{
                        latitude: loc.shopLatitude!,
                        longitude: loc.shopLongitude!,
                      }}
                      fillColor="rgba(29,78,216,0.14)"
                      radius={visit.measurement.effectiveRadiusMeters}
                      strokeColor={BLUE}
                      strokeWidth={1.2}
                    />
                  </>
                ) : null}
                <Marker
                  coordinate={{
                    latitude: loc.capturedLatitude,
                    longitude: loc.capturedLongitude,
                  }}
                  pinColor={OUT_OF_RANGE_INK}
                  title="Submitted from"
                />
              </MapView>
            </View>

            <Card>
              <FactRow
                label="Distance from shop"
                tint={OUT_OF_RANGE_INK}
                value={`${visit.measurement.distanceMeters} m`}
              />
              <FactRow
                label="Allowed radius"
                value={`${visit.measurement.effectiveRadiusMeters} m`}
              />
              <FactRow
                label="GPS accuracy · submitted"
                last
                value={`±${visit.measurement.accuracyMeters} m · ${formatDateTime(visit.measurement.submittedAt)}`}
              />
            </Card>

            {visit.order ? (
              <Card title="Order">
                {visit.order.lines.map((line, index) => (
                  <View
                    key={`${line.brandLabel}-${index}`}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      gap: 12,
                      paddingVertical: 11,
                      borderBottomWidth: 1,
                      borderBottomColor: ROW_SEPARATOR,
                    }}
                  >
                    <Text
                      numberOfLines={1}
                      style={{ fontSize: 14, color: INK, flexShrink: 1 }}
                    >
                      {line.brandLabel}
                    </Text>
                    <Text
                      style={{
                        fontFamily: 'monospace',
                        fontSize: 14,
                        fontWeight: '700',
                        color: INK,
                      }}
                    >
                      {line.quantity}
                    </Text>
                  </View>
                ))}
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    paddingVertical: 11,
                  }}
                >
                  <Text style={{ fontSize: 14, fontWeight: '700', color: INK }}>
                    Total quantity
                  </Text>
                  <Text
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 14,
                      fontWeight: '700',
                      color: INK,
                    }}
                  >
                    {visit.order.totalQuantity}
                  </Text>
                </View>
              </Card>
            ) : (
              <Card title="No order">
                <FactRow
                  label="Reason"
                  value={visit.noOrder?.reasonLabel ?? '—'}
                />
                <FactRow
                  label="Sample shown"
                  last
                  value={visit.sampleShown ? 'Yes' : 'No'}
                />
              </Card>
            )}

            <Text style={{ fontSize: 12, color: LABEL, textAlign: 'center' }}>
              This view is read-only. Open the visit from the Order tab to mark
              a delivery.
            </Text>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
