import { useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, apiRequest, generateIdempotencyKey } from '../../api/client';
import {
  OutlineIcon,
  type IconShape,
} from '../../components/icons/OutlineIcon';
import type { ManagerStackParamList } from '../../navigation/RootNavigator';
import {
  BG,
  BLUE,
  BORDER,
  CHIP_DELIVERED_BG,
  CHIP_DELIVERED_FG,
  CHIP_TO_DELIVER_BG,
  CHIP_TO_DELIVER_FG,
  INK,
  LABEL,
  MUTED,
  ROW_SEPARATOR,
} from './managerDesign';
import {
  Card,
  FactRow,
  formatDateTime,
  formatDay,
  locationVerdict,
  useVisitDetail,
} from './visitDetailShared';
import { LoadNotice } from './loadState';

/**
 * PRD §4 screen 3.4 ("Order visit · mark delivered"), board uuid
 * `ed0bcc77-19fe-47e8-9c6a-195998663d31` (010-manager-app).
 *
 * Reached from the **Order** tab. The same visit reached from the Out of
 * range tab opens the read-only range screen instead — which is why an
 * out-of-range order can still be marked delivered from here (FR-029).
 */

const ICON_BACK: IconShape[] = [{ d: 'M15 18l-6-6 6-6' }];
const ICON_PREV: IconShape[] = [{ d: 'M15 18l-6-6 6-6' }];
const ICON_NEXT: IconShape[] = [{ d: 'M9 6l6 6-6 6' }];

export function OrderVisitScreen() {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<
      NativeStackNavigationProp<ManagerStackParamList, 'OrderVisit'>
    >();
  const route = useRoute<RouteProp<ManagerStackParamList, 'OrderVisit'>>();
  const { visitId } = route.params;

  const [saving, setSaving] = useState(false);
  const { visit, loading, staleNote, error, setError, reload } =
    useVisitDetail(visitId);

  async function markDelivered(): Promise<void> {
    const order = visit?.order;
    if (!order || saving) return;
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/orders/${order.orderId}/deliver`, {
        method: 'POST',
        body: {},
        idempotencyKey: generateIdempotencyKey(),
      });
      await reload();
    } catch (err) {
      // A 409 means someone else got there first. Say so plainly — never
      // pretend it succeeded, which would misattribute the delivery.
      setError(
        err instanceof ApiError && err.code === 'ORDER_ALREADY_DELIVERED'
          ? 'This order was already marked delivered by someone else. Reload to see who.'
          : err instanceof Error
            ? err.message
            : 'Could not mark it delivered.',
      );
    } finally {
      setSaving(false);
    }
  }

  const order = visit?.order;
  const delivered = order?.deliveryStatus === 'DELIVERED';
  const verdict = visit ? locationVerdict(visit.measurement) : null;

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
        <View style={{ flexGrow: 1, flexShrink: 1 }}>
          <Text style={{ fontSize: 13, color: MUTED }}>
            Order{visit ? ` · ${formatDay(visit.businessDate)}` : ''}
          </Text>
          <Text
            numberOfLines={1}
            style={{ fontSize: 22, fontWeight: '700', color: INK }}
          >
            {visit?.shopName ?? ''}
          </Text>
        </View>
        {/* Board 3.4's prev/next. Unavailable at the ends rather than
            wrapping (FR-025) — disabled because this slice opens one visit
            at a time rather than carrying the filtered set through. */}
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <StepButton disabled icon={ICON_PREV} label="Previous order" />
          <StepButton disabled icon={ICON_NEXT} label="Next order" />
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

        {visit && order ? (
          <>
            {/* The delivery status card, in its two states. */}
            <View
              style={{
                backgroundColor: delivered
                  ? CHIP_DELIVERED_BG
                  : CHIP_TO_DELIVER_BG,
                borderRadius: 16,
                padding: 14,
                gap: 2,
              }}
            >
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: '700',
                  color: delivered ? CHIP_DELIVERED_FG : CHIP_TO_DELIVER_FG,
                }}
              >
                {delivered ? 'Delivered' : 'Waiting for delivery'}
              </Text>
              <Text
                style={{
                  fontSize: 13,
                  color: delivered ? CHIP_DELIVERED_FG : CHIP_TO_DELIVER_FG,
                }}
              >
                {delivered
                  ? `Marked ${order.deliveredAt ? formatDateTime(order.deliveredAt) : ''}${order.deliveredByName ? ` by ${order.deliveredByName}` : ''}`
                  : `Ordered ${formatDateTime(visit.occurredAt)}`}
              </Text>
            </View>

            <Card title="Order lines">
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  paddingVertical: 8,
                  borderBottomWidth: 1,
                  borderBottomColor: ROW_SEPARATOR,
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: '700', color: MUTED }}>
                  Brand
                </Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: MUTED }}>
                  Qty
                </Text>
              </View>
              {order.lines.map((line, index) => (
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
                  {order.totalQuantity}
                </Text>
              </View>
            </Card>

            <Card title="Visit">
              <FactRow
                label="Executive"
                value={`${visit.executiveName} · ${formatDateTime(visit.occurredAt)}`}
              />
              <FactRow label="Beat" value={visit.beatPlanName ?? '—'} />
              <FactRow
                label="Sample shown"
                value={visit.sampleShown ? 'Yes' : 'No'}
              />
              <FactRow
                label="Location"
                last
                tint={verdict?.tint}
                value={verdict?.text ?? ''}
              />
            </Card>

            {!delivered ? (
              <Pressable
                disabled={saving}
                onPress={() => void markDelivered()}
                style={{
                  height: 54,
                  borderRadius: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: BLUE,
                }}
              >
                {saving ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: '700',
                      color: '#FFFFFF',
                    }}
                  >
                    Mark as delivered
                  </Text>
                )}
              </Pressable>
            ) : (
              <Text style={{ fontSize: 13, color: LABEL, textAlign: 'center' }}>
                This order has been delivered. It cannot be marked again.
              </Text>
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function StepButton({
  icon,
  label,
  disabled,
}: {
  icon: IconShape[];
  label: string;
  disabled: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      disabled={disabled}
      style={{
        width: 36,
        height: 36,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: BORDER,
        backgroundColor: '#FFFFFF',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <OutlineIcon color={INK} shapes={icon} size={16} strokeWidth={2} />
    </Pressable>
  );
}
