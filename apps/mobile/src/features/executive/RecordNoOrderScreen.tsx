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
  CHIP_PIN_OK_BG,
  CHIP_PIN_OK_FG,
  DANGER,
  INK,
  MUTED,
  ROW_SEPARATOR,
} from './executiveDesign';

/**
 * PRD §4 screen 2.2 ("Record no order"), board uuid
 * `8012c6be-4783-4ba8-b953-9d99e371535e`.
 *
 * Reasons come from `GET /reasons`, which returns **active reasons only** to
 * an executive, in display order, with the system "Other" last — the server
 * guarantees all three, so this screen renders what it is given rather than
 * re-sorting or re-filtering.
 *
 * Free text is required **only** for the system "Other" row. The screen keys
 * off the `isSystem` flag the API returns rather than matching the label
 * text, so a company whose "Other" is worded differently still behaves
 * correctly.
 */

const ICON_BACK: IconShape[] = [{ d: 'M15 18l-6-6 6-6' }];

interface Reason {
  id: string;
  label: string;
  isSystem: boolean;
  requiresText: boolean;
}

export function RecordNoOrderScreen() {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<
      NativeStackNavigationProp<ExecutiveStackParamList, 'RecordNoOrder'>
    >();
  const route = useRoute<RouteProp<ExecutiveStackParamList, 'RecordNoOrder'>>();
  const { stopId, shopName, sampleShown } = route.params;

  const [reasons, setReasons] = useState<Reason[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    void apiRequest<{ items: Reason[] }>('/reasons')
      .then((result) => setReasons(result.items))
      .catch(() => setError('Could not load reasons.'));
  }, []);

  const selected = reasons.find((reason) => reason.id === selectedId) ?? null;
  const needsText = Boolean(
    selected && (selected.isSystem || selected.requiresText),
  );

  function validate(): string | null {
    if (!selected) {
      return 'Choose a reason.';
    }
    if (needsText) {
      const trimmed = text.trim();
      if (trimmed.length < 3) {
        return 'Describe the reason — at least 3 characters.';
      }
      if (trimmed.length > 280) {
        return 'Keep the description under 280 characters.';
      }
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
          Reason (required)
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
          {reasons.map((reason, index) => {
            const isSelected = reason.id === selectedId;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                key={reason.id}
                onPress={() => {
                  setSelectedId(reason.id);
                  setError(null);
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  minHeight: 52,
                  paddingHorizontal: 14,
                  borderBottomWidth: index === reasons.length - 1 ? 0 : 1,
                  borderBottomColor: ROW_SEPARATOR,
                  backgroundColor: isSelected ? CHIP_PIN_OK_BG : '#FFFFFF',
                }}
              >
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    borderWidth: 2,
                    borderColor: isSelected ? BLUE : '#CBD2DD',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {isSelected ? (
                    <View
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        backgroundColor: BLUE,
                      }}
                    />
                  ) : null}
                </View>
                <Text
                  style={{
                    flexGrow: 1,
                    fontSize: 15,
                    fontWeight: '600',
                    color: isSelected ? CHIP_PIN_OK_FG : INK,
                  }}
                >
                  {reason.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {needsText ? (
          <View style={{ marginTop: 16, gap: 8 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: INK }}>
              Describe the reason (required for Other)
            </Text>
            <TextInput
              accessibilityLabel="Describe the reason"
              maxLength={280}
              multiline
              onChangeText={(value) => {
                setText(value);
                setError(null);
              }}
              placeholder="What happened at this shop?"
              placeholderTextColor={MUTED}
              style={{
                minHeight: 96,
                borderRadius: 12,
                borderWidth: 1.5,
                borderColor: '#CBD2DD',
                padding: 12,
                fontSize: 15,
                color: INK,
                backgroundColor: '#FFFFFF',
                textAlignVertical: 'top',
              }}
              value={text}
            />
            <Text style={{ fontSize: 12, color: MUTED, textAlign: 'right' }}>
              {text.trim().length}/280
            </Text>
          </View>
        ) : null}

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
          outcome: 'NO_ORDER',
          reasonId: selectedId,
          ...(needsText ? { reasonText: text.trim() } : {}),
        })}
        onCancel={() => setConfirming(false)}
        onSubmitted={() => {
          setConfirming(false);
          navigation.navigate('TodaysBeat');
        }}
        outcomeSummary={`No order · ${selected?.label ?? ''}`}
        sampleShown={sampleShown}
        shopName={shopName}
        stopLabel="This stop"
        visible={confirming}
      />
    </View>
  );
}
