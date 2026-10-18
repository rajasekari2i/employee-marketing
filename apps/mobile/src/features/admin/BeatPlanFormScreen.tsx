import { useEffect, useState } from 'react';
import type { RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  createBeatPlanSchema,
  updateBeatPlanSchema,
} from '@field-sales/shared';

import { ApiError, apiRequest, generateIdempotencyKey } from '../../api/client';
import {
  OutlineIcon,
  type IconShape,
} from '../../components/icons/OutlineIcon';
import type { AdminStackParamList } from '../../navigation/RootNavigator';
import type { ShopSummaryForEdit } from './ShopsListScreen';
import { BG, BLUE, BORDER, INK, LABEL, MUTED } from './adminDesign';

/**
 * PRD §4 screen 4.7 ("New beat plan"). Layout/colors/icons below are taken
 * verbatim from `docs/ui-design/Field_Sales_Beat_App.html` §4.7 — see that
 * board for the source of every hex value and SVG path here. There is no
 * separate "edit beat plan" board — per the feature spec, editing opens
 * this same screen pre-filled, titled "Edit beat plan" instead of "New
 * beat plan" (FR-015).
 *
 * "+ Add existing shops" and "Create a new shop in this beat" reuse
 * `ShopsListScreen`'s selection mode and `ShopFormScreen`'s `onCreated`
 * callback respectively (research.md §2/§3) rather than duplicating either
 * screen. "Assigned executive" calls `GET /users?role=MARKETING_EXECUTIVE
 * &status=ACTIVE` directly (research.md §4). Reordering uses plain up/down
 * controls, not a drag gesture library (research.md §6).
 */

type BeatPlanFormNavigationProp = NativeStackNavigationProp<
  AdminStackParamList,
  'BeatPlanForm'
>;
type BeatPlanFormRouteProp = RouteProp<AdminStackParamList, 'BeatPlanForm'>;

interface ExecutiveOption {
  id: string;
  name: string;
}

interface PlanShop {
  id: string;
  name: string;
  pinStatus: 'NONE' | 'APPROVED';
}

const DAYS: Array<{ value: number; label: string }> = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

const ICON_CLOSE: IconShape[] = [{ d: 'M6 6l12 12M18 6L6 18' }];
const ICON_BACK: IconShape[] = [{ d: 'M15 18l-6-6 6-6' }];
const ICON_CHEVRON_DOWN: IconShape[] = [{ d: 'M6 9l6 6 6-6' }];
const ICON_PLUS: IconShape[] = [{ d: 'M12 5v14M5 12h14' }];
const ICON_REMOVE: IconShape[] = [{ d: 'M6 6l12 12M18 6L6 18' }];
const ICON_UP: IconShape[] = [{ d: 'M18 15l-6-6-6 6' }];
const ICON_DOWN: IconShape[] = [{ d: 'M6 9l6 6 6-6' }];

function errorMessageFor(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'DUPLICATE_BEAT_PLAN_CODE':
        return 'That beat plan code is already in use in this company.';
      case 'VALIDATION_FAILED':
        return error.message || 'Please check the fields and try again.';
      case 'NETWORK_ERROR':
        return 'No internet connection. Check your signal and try again.';
      case 'NOT_FOUND':
        return 'This beat plan could not be found.';
      default:
        return 'Something went wrong at our end. Try again in a moment.';
    }
  }
  return 'Something went wrong at our end. Try again in a moment.';
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
  height: 46,
  borderWidth: 1.5,
  borderColor: '#CBD2DD',
  borderRadius: 12,
  paddingHorizontal: 12,
  fontSize: 15,
  fontWeight: '500' as const,
  color: INK,
  backgroundColor: '#FFFFFF',
};

/** Pin-saved: `#E3EBFC`/`#1E3A8A`; No-pin: `#FCEFD9`/`#7A4105` — the same pair boards 4.6/4.8/4.9 all use for a shop's pin status. */
function pinChipColors(pinStatus: 'NONE' | 'APPROVED') {
  return pinStatus === 'APPROVED'
    ? { bg: '#E3EBFC', fg: '#1E3A8A', label: 'Pin' }
    : { bg: '#FCEFD9', fg: '#7A4105', label: 'No pin' };
}

export function BeatPlanFormScreen() {
  const navigation = useNavigation<BeatPlanFormNavigationProp>();
  const route = useRoute<BeatPlanFormRouteProp>();
  const editingPlan = route.params?.beatPlan;
  const isEditing = Boolean(editingPlan);

  const [name, setName] = useState(editingPlan?.name ?? '');
  const [code, setCode] = useState(editingPlan?.code ?? '');
  const [executive, setExecutive] = useState<ExecutiveOption | null>(
    editingPlan?.executive ?? null,
  );
  const [workingDays, setWorkingDays] = useState<number[]>(
    editingPlan?.workingDays ?? [],
  );
  const [shops, setShops] = useState<PlanShop[]>(editingPlan?.shops ?? []);

  const [executiveOptions, setExecutiveOptions] = useState<ExecutiveOption[]>(
    [],
  );
  const [executivePickerOpen, setExecutivePickerOpen] = useState(false);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiRequest<{ items: ExecutiveOption[] }>(
      '/users?role=MARKETING_EXECUTIVE&status=ACTIVE&limit=100',
    )
      .then((result) => {
        if (!cancelled) {
          setExecutiveOptions(result.items);
        }
      })
      .catch(() => {
        // Leave executiveOptions empty — the picker shows "No executive" only.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleDay(day: number): void {
    setWorkingDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  }

  function addShops(picked: ShopSummaryForEdit[]): void {
    setShops((prev) => {
      const existingIds = new Set(prev.map((s) => s.id));
      const additions = picked
        .filter((s) => !existingIds.has(s.id))
        .map((s) => ({ id: s.id, name: s.name, pinStatus: s.pinStatus }));
      return [...prev, ...additions];
    });
  }

  function addCreatedShop(shop: ShopSummaryForEdit): void {
    addShops([shop]);
  }

  function moveShop(index: number, direction: -1 | 1): void {
    setShops((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      if (!moved) {
        return prev;
      }
      next.splice(target, 0, moved);
      return next;
    });
  }

  function removeShop(shopId: string): void {
    setShops((prev) => prev.filter((s) => s.id !== shopId));
  }

  async function onSubmit(): Promise<void> {
    setSubmitError(null);

    const payload = {
      code: code.trim(),
      name: name.trim(),
      executiveId: executive?.id,
      workingDays,
      shopIds: shops.map((s) => s.id),
    };

    const schema = isEditing ? updateBeatPlanSchema : createBeatPlanSchema;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      setSubmitError(parsed.error.issues[0]?.message ?? 'Invalid input.');
      return;
    }

    setSubmitting(true);
    try {
      if (isEditing) {
        await apiRequest(`/beat-plans/${editingPlan?.id}`, {
          method: 'PATCH',
          body: parsed.data,
          idempotencyKey: generateIdempotencyKey(),
        });
      } else {
        await apiRequest('/beat-plans', {
          method: 'POST',
          body: parsed.data,
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

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: 52,
          paddingHorizontal: 20,
          paddingBottom: 32,
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
            {isEditing ? 'Edit beat plan' : 'New beat plan'}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 2 }}>
            <FieldLabel>Beat name</FieldLabel>
            <TextInput
              onChangeText={setName}
              style={INPUT_STYLE}
              testID="beat-plan-form-name"
              value={name}
            />
          </View>
          <View style={{ flex: 1 }}>
            <FieldLabel>Code</FieldLabel>
            <TextInput
              autoCapitalize="characters"
              onChangeText={setCode}
              style={[INPUT_STYLE, { fontFamily: 'monospace' }]}
              testID="beat-plan-form-code"
              value={code}
            />
          </View>
        </View>

        <View>
          <FieldLabel>Assigned executive</FieldLabel>
          <Pressable
            onPress={() => setExecutivePickerOpen(true)}
            style={[
              INPUT_STYLE,
              {
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              },
            ]}
            testID="beat-plan-form-executive"
          >
            <Text style={{ fontSize: 15, color: executive ? INK : MUTED }}>
              {executive?.name ?? 'No executive'}
            </Text>
            <OutlineIcon
              color={INK}
              shapes={ICON_CHEVRON_DOWN}
              size={14}
              strokeWidth={2}
            />
          </Pressable>
        </View>

        <View>
          <SectionLabel>Working days</SectionLabel>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              marginTop: 8,
            }}
          >
            {DAYS.map(({ value, label }) => {
              const selected = workingDays.includes(value);
              return (
                <Pressable
                  key={value}
                  onPress={() => toggleDay(value)}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: selected ? BLUE : '#FFFFFF',
                    borderWidth: selected ? 0 : 1.5,
                    borderColor: '#CBD2DD',
                  }}
                  testID={`beat-plan-form-day-${value}`}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      fontWeight: '700',
                      color: selected ? '#FFFFFF' : MUTED,
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={{ gap: 8 }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <SectionLabel>{`Shops in visit order · ${shops.length}`}</SectionLabel>
            <Pressable
              onPress={() =>
                navigation.navigate('ShopsList', {
                  selectionMode: true,
                  onSelect: addShops,
                })
              }
              testID="beat-plan-form-add-shops"
            >
              <Text style={{ fontSize: 13, fontWeight: '700', color: BLUE }}>
                + Add existing shops
              </Text>
            </Pressable>
          </View>
          <View
            style={{
              backgroundColor: '#FFFFFF',
              borderWidth: 1,
              borderColor: BORDER,
              borderRadius: 16,
              overflow: 'hidden',
            }}
          >
            {shops.map((shop, index) => {
              const chip = pinChipColors(shop.pinStatus);
              return (
                <View
                  key={shop.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    minHeight: 52,
                    paddingHorizontal: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: '#ECEFF4',
                  }}
                  testID={`beat-plan-form-shop-${shop.id}`}
                >
                  <Text
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 13,
                      color: MUTED,
                      width: 22,
                    }}
                  >
                    {String(index + 1).padStart(2, '0')}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{
                      flexGrow: 1,
                      fontSize: 14,
                      fontWeight: '600',
                      color: INK,
                    }}
                  >
                    {shop.name}
                  </Text>
                  <View
                    style={{
                      height: 22,
                      paddingHorizontal: 8,
                      borderRadius: 999,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: chip.bg,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: '700',
                        color: chip.fg,
                      }}
                    >
                      {chip.label}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityLabel={`Move ${shop.name} up`}
                    disabled={index === 0}
                    onPress={() => moveShop(index, -1)}
                    style={{
                      width: 32,
                      height: 44,
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: index === 0 ? 0.3 : 1,
                    }}
                  >
                    <OutlineIcon
                      color={MUTED}
                      shapes={ICON_UP}
                      size={16}
                      strokeWidth={2}
                    />
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`Move ${shop.name} down`}
                    disabled={index === shops.length - 1}
                    onPress={() => moveShop(index, 1)}
                    style={{
                      width: 32,
                      height: 44,
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: index === shops.length - 1 ? 0.3 : 1,
                    }}
                  >
                    <OutlineIcon
                      color={MUTED}
                      shapes={ICON_DOWN}
                      size={16}
                      strokeWidth={2}
                    />
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`Remove ${shop.name}`}
                    onPress={() => removeShop(shop.id)}
                    style={{
                      width: 32,
                      height: 44,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <OutlineIcon
                      color="#A3261B"
                      shapes={ICON_REMOVE}
                      size={14}
                      strokeWidth={2.2}
                    />
                  </Pressable>
                </View>
              );
            })}
            <Pressable
              onPress={() =>
                navigation.navigate('ShopForm', {
                  shop: undefined,
                  onCreated: addCreatedShop,
                })
              }
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                minHeight: 48,
                paddingHorizontal: 14,
              }}
              testID="beat-plan-form-create-shop"
            >
              <OutlineIcon
                color={BLUE}
                shapes={ICON_PLUS}
                size={16}
                strokeWidth={2.2}
              />
              <Text style={{ fontSize: 14, fontWeight: '700', color: BLUE }}>
                Create a new shop in this beat
              </Text>
            </Pressable>
          </View>
        </View>

        <Text style={{ fontSize: 12, color: MUTED, lineHeight: 17 }}>
          Daily assignments start from the next working day. Later edits never
          rewrite past daily snapshots.
        </Text>

        {submitError ? (
          <Text style={{ fontSize: 13, color: '#A3261B', textAlign: 'center' }}>
            {submitError}
          </Text>
        ) : null}
      </ScrollView>

      <View
        style={{
          padding: 20,
          paddingBottom: 30,
          backgroundColor: '#FFFFFF',
          borderTopWidth: 1,
          borderTopColor: BORDER,
          flexDirection: 'row',
          gap: 10,
        }}
      >
        <Pressable
          onPress={() => navigation.goBack()}
          style={{
            flex: 1,
            height: 52,
            borderRadius: 14,
            borderWidth: 1.5,
            borderColor: INK,
            backgroundColor: '#FFFFFF',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          testID="beat-plan-form-cancel"
        >
          <Text style={{ fontSize: 15, fontWeight: '600', color: INK }}>
            Cancel
          </Text>
        </Pressable>
        <Pressable
          disabled={submitting}
          onPress={() => void onSubmit()}
          style={{
            flex: 1,
            height: 52,
            borderRadius: 14,
            backgroundColor: BLUE,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: submitting ? 0.6 : 1,
          }}
          testID="beat-plan-form-save"
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>
              {isEditing ? 'Save changes' : 'Create beat plan'}
            </Text>
          )}
        </Pressable>
      </View>

      <Modal
        animationType="slide"
        onRequestClose={() => setExecutivePickerOpen(false)}
        transparent
        visible={executivePickerOpen}
      >
        <Pressable
          onPress={() => setExecutivePickerOpen(false)}
          style={{
            flex: 1,
            backgroundColor: 'rgba(20,26,38,0.4)',
            justifyContent: 'flex-end',
          }}
        >
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={{
              backgroundColor: '#FFFFFF',
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              maxHeight: '70%',
              paddingBottom: 20,
            }}
          >
            <Text
              style={{
                fontSize: 16,
                fontWeight: '700',
                color: INK,
                padding: 16,
              }}
            >
              Assigned executive
            </Text>
            <FlatList
              data={[{ id: '', name: 'No executive' }, ...executiveOptions]}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    setExecutive(item.id ? item : null);
                    setExecutivePickerOpen(false);
                  }}
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    borderTopWidth: 1,
                    borderTopColor: '#ECEFF4',
                  }}
                  testID={`beat-plan-form-executive-option-${item.id || 'none'}`}
                >
                  <Text style={{ fontSize: 15, color: INK }}>{item.name}</Text>
                </Pressable>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
