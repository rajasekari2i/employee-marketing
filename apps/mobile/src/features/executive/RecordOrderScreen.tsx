import { useEffect, useState } from 'react';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { apiRequest } from '../../api/client';
import {
  OutlineIcon,
  type IconShape,
} from '../../components/icons/OutlineIcon';
import type { ExecutiveStackParamList } from '../../navigation/RootNavigator';
import { ConfirmSubmitSheet } from './ConfirmSubmitSheet';
import {
  BG,
  BLUE,
  BORDER,
  CHIP_NEUTRAL_BG,
  DANGER,
  INK,
  MUTED,
  ROW_SEPARATOR,
} from './executiveDesign';

/**
 * PRD §4 screen 2.1 ("Record order"), board uuid
 * `58127a13-a46f-474a-80fc-fa6c72b5eb26`.
 *
 * Brands come from `GET /brands`, which returns **active brands only** to an
 * executive and in the admin's display order — so a retired brand cannot be
 * offered here at all. Submission rejects one regardless; this is the second
 * line of the same defence, not the only one.
 */

const ICON_BACK: IconShape[] = [{ d: 'M15 18l-6-6 6-6' }];
const ICON_PLUS: IconShape[] = [{ d: 'M12 5v14M5 12h14' }];
const ICON_MINUS: IconShape[] = [{ d: 'M5 12h14' }];
const ICON_TRASH: IconShape[] = [
  { d: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3' },
];

interface Brand {
  id: string;
  label: string;
}

interface Line {
  key: string;
  brandId: string | null;
  quantity: number;
}

export function RecordOrderScreen() {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<
      NativeStackNavigationProp<ExecutiveStackParamList, 'RecordOrder'>
    >();
  const route = useRoute<RouteProp<ExecutiveStackParamList, 'RecordOrder'>>();
  const { stopId, shopName, sampleShown } = route.params;

  const [brands, setBrands] = useState<Brand[]>([]);
  const [lines, setLines] = useState<Line[]>([
    { key: 'l0', brandId: null, quantity: 1 },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  useEffect(() => {
    void apiRequest<{ items: Brand[] }>('/brands')
      .then((result) => setBrands(result.items))
      .catch(() => setError('Could not load brands.'));
  }, []);

  const chosen = lines.filter((line) => line.brandId !== null);
  const totalQuantity = chosen.reduce((sum, line) => sum + line.quantity, 0);
  const brandCount = chosen.length;

  function updateLine(key: string, patch: Partial<Line>): void {
    setLines((prev) =>
      prev.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  /** Each rule gets its own message rather than one generic failure. */
  function validate(): string | null {
    if (chosen.length === 0) {
      return 'Add at least one brand to the order.';
    }
    if (!chosen.some((line) => line.quantity > 0)) {
      return 'At least one line must have a quantity above zero.';
    }
    const ids = chosen.map((line) => line.brandId);
    if (new Set(ids).size !== ids.length) {
      return 'The same brand cannot appear twice on one order.';
    }
    return null;
  }

  function onReview(): void {
    const problem = validate();
    setError(problem);
    if (!problem) {
      setConfirming(true);
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
            Sample shown: {sampleShown ? 'Yes' : 'No'}
          </Text>
          <Text style={{ fontSize: 22, fontWeight: '700', color: INK }}>
            {shopName}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        style={{ paddingHorizontal: 20 }}
      >
        <Text
          style={{
            fontSize: 14,
            fontWeight: '700',
            color: INK,
            marginBottom: 8,
          }}
        >
          Order lines
        </Text>
        <Text style={{ fontSize: 12, color: MUTED, marginBottom: 8 }}>
          Brand · quantity
        </Text>

        <View
          style={{
            backgroundColor: '#FFFFFF',
            borderWidth: 1,
            borderColor: BORDER,
            borderRadius: 16,
            overflow: 'hidden',
          }}
        >
          {lines.map((line, index) => {
            const brand = brands.find((b) => b.id === line.brandId);
            return (
              <View
                key={line.key}
                style={{
                  padding: 12,
                  gap: 10,
                  borderBottomWidth: index === lines.length - 1 ? 0 : 1,
                  borderBottomColor: ROW_SEPARATOR,
                }}
              >
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
                >
                  <Pressable
                    accessibilityLabel={`Brand for line ${index + 1}`}
                    onPress={() =>
                      setPickerFor(pickerFor === line.key ? null : line.key)
                    }
                    style={{
                      flexGrow: 1,
                      height: 44,
                      borderRadius: 12,
                      borderWidth: 1.5,
                      borderColor: '#CBD2DD',
                      justifyContent: 'center',
                      paddingHorizontal: 12,
                      backgroundColor: '#FFFFFF',
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 15,
                        fontWeight: '600',
                        color: brand ? INK : MUTED,
                      }}
                    >
                      {brand?.label ?? 'Choose a brand'}
                    </Text>
                  </Pressable>
                  {lines.length > 1 ? (
                    <Pressable
                      accessibilityLabel={`Remove line ${index + 1}`}
                      onPress={() =>
                        setLines((prev) =>
                          prev.filter((l) => l.key !== line.key),
                        )
                      }
                      style={{
                        width: 40,
                        height: 44,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <OutlineIcon
                        color={DANGER}
                        shapes={ICON_TRASH}
                        size={18}
                      />
                    </Pressable>
                  ) : null}
                </View>

                {pickerFor === line.key ? (
                  <View
                    style={{
                      borderWidth: 1,
                      borderColor: BORDER,
                      borderRadius: 12,
                      overflow: 'hidden',
                    }}
                  >
                    {brands.map((b) => (
                      <Pressable
                        key={b.id}
                        onPress={() => {
                          updateLine(line.key, { brandId: b.id });
                          setPickerFor(null);
                        }}
                        style={{
                          paddingVertical: 12,
                          paddingHorizontal: 12,
                          borderBottomWidth: 1,
                          borderBottomColor: ROW_SEPARATOR,
                        }}
                      >
                        <Text style={{ fontSize: 15, color: INK }}>
                          {b.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <Stepper
                    icon={ICON_MINUS}
                    label={`Decrease quantity on line ${index + 1}`}
                    onPress={() =>
                      updateLine(line.key, {
                        quantity: Math.max(0, line.quantity - 1),
                      })
                    }
                  />
                  <TextInput
                    accessibilityLabel={`Quantity for line ${index + 1}`}
                    keyboardType="number-pad"
                    onChangeText={(text) => {
                      const digits = text.replace(/[^0-9]/g, '');
                      updateLine(line.key, {
                        quantity: digits === '' ? 0 : Number(digits),
                      });
                    }}
                    style={{
                      flexGrow: 1,
                      height: 44,
                      borderRadius: 12,
                      borderWidth: 1.5,
                      borderColor: '#CBD2DD',
                      textAlign: 'center',
                      fontSize: 17,
                      fontWeight: '700',
                      color: INK,
                      backgroundColor: '#FFFFFF',
                    }}
                    value={String(line.quantity)}
                  />
                  <Stepper
                    icon={ICON_PLUS}
                    label={`Increase quantity on line ${index + 1}`}
                    onPress={() =>
                      updateLine(line.key, { quantity: line.quantity + 1 })
                    }
                  />
                </View>
              </View>
            );
          })}
        </View>

        <Pressable
          accessibilityLabel="Add brand"
          onPress={() =>
            setLines((prev) => [
              ...prev,
              { key: `l${Date.now()}`, brandId: null, quantity: 1 },
            ])
          }
          style={{
            marginTop: 12,
            height: 48,
            borderRadius: 14,
            borderWidth: 1.5,
            borderStyle: 'dashed',
            borderColor: BLUE,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <OutlineIcon
            color={BLUE}
            shapes={ICON_PLUS}
            size={18}
            strokeWidth={2.2}
          />
          <Text style={{ fontSize: 15, fontWeight: '700', color: BLUE }}>
            Add brand
          </Text>
        </Pressable>

        <View
          style={{
            flexDirection: 'row',
            gap: 10,
            marginTop: 16,
          }}
        >
          <Total label="brands" value={brandCount} />
          <Total label="Total quantity" value={totalQuantity} />
        </View>

        {error ? (
          <Text style={{ fontSize: 13, color: DANGER, marginTop: 12 }}>
            {error}
          </Text>
        ) : null}
      </ScrollView>

      <View
        style={{
          paddingTop: 14,
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 16,
          backgroundColor: '#FFFFFF',
          borderTopWidth: 1,
          borderTopColor: BORDER,
        }}
      >
        <Pressable
          accessibilityLabel="Capture location and review"
          onPress={onReview}
          style={{
            height: 54,
            borderRadius: 14,
            backgroundColor: BLUE,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>
            Review &amp; submit
          </Text>
        </Pressable>
      </View>

      <ConfirmSubmitSheet
        buildBody={() => ({
          stopId,
          sampleShown,
          outcome: 'ORDER',
          lines: chosen.map((line) => ({
            brandId: line.brandId as string,
            quantity: line.quantity,
          })),
        })}
        onCancel={() => setConfirming(false)}
        onSubmitted={() => {
          setConfirming(false);
          navigation.navigate('TodaysBeat');
        }}
        outcomeSummary={`Order · ${brandCount} brands · ${totalQuantity} qty`}
        sampleShown={sampleShown}
        shopName={shopName}
        stopLabel="This stop"
        visible={confirming}
      />
    </View>
  );
}

function Stepper({
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
        width: 44,
        height: 44,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: '#CBD2DD',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#FFFFFF',
      }}
    >
      <OutlineIcon color={INK} shapes={icon} size={18} strokeWidth={2.2} />
    </Pressable>
  );
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: CHIP_NEUTRAL_BG,
        borderRadius: 14,
        padding: 12,
      }}
    >
      <Text style={{ fontSize: 20, fontWeight: '700', color: INK }}>
        {value}
      </Text>
      <Text style={{ fontSize: 12, color: MUTED }}>{label}</Text>
    </View>
  );
}
