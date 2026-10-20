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

import {
  OutlineIcon,
  type IconShape,
} from '../../components/icons/OutlineIcon';
import type { ManagerStackParamList } from '../../navigation/RootNavigator';
import {
  BG,
  BLUE,
  BORDER,
  CHIP_NO_ORDER_BG,
  CHIP_NO_ORDER_FG,
  INK,
  LABEL,
  MUTED,
  ROW_SEPARATOR,
} from './managerDesign';
import {
  Card,
  formatDateTime,
  formatDay,
  locationVerdict,
  useVisitDetail,
} from './visitDetailShared';
import { LoadNotice } from './loadState';

/**
 * PRD §4 screen 3.5 ("No-order visit · last 5 reasons"), board uuid
 * `eb30fec5-03ab-4e68-9c1d-0e0d3ee01126` (010-manager-app).
 *
 * The last five are what turn a list of refusals into a pattern worth
 * acting on — which is why the board calls out a repeat explicitly rather
 * than leaving a manager to notice it.
 */

const ICON_BACK: IconShape[] = [{ d: 'M15 18l-6-6 6-6' }];

export function NoOrderVisitScreen() {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<
      NativeStackNavigationProp<ManagerStackParamList, 'NoOrderVisit'>
    >();
  const route = useRoute<RouteProp<ManagerStackParamList, 'NoOrderVisit'>>();
  const { visitId } = route.params;

  const { visit, loading, staleNote, error } = useVisitDetail(visitId);

  const history = visit?.noOrder?.lastFiveReasons ?? [];
  const verdict = visit ? locationVerdict(visit.measurement) : null;
  const repeat = findRepeat(history);

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
            {visit
              ? `No order · ${visit.executiveName} · ${formatDateTime(visit.occurredAt)}`
              : 'No order'}
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

        {visit ? (
          <>
            <Card title="Reason given">
              <View style={{ paddingVertical: 11, gap: 10 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: INK }}>
                  {visit.noOrder?.reasonLabel ?? 'No reason recorded'}
                </Text>
                <View
                  style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}
                >
                  <Chip
                    bg={CHIP_NO_ORDER_BG}
                    fg={CHIP_NO_ORDER_FG}
                    label={`Sample shown: ${visit.sampleShown ? 'Yes' : 'No'}`}
                  />
                  {verdict ? (
                    <Chip
                      bg={CHIP_NO_ORDER_BG}
                      fg={verdict.tint}
                      label={verdict.text}
                    />
                  ) : null}
                </View>
              </View>
            </Card>

            <View style={{ gap: 8 }}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
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
                  Last 5 no-order reasons here
                </Text>
                <Text style={{ fontSize: 12, color: MUTED }}>Newest first</Text>
              </View>

              {history.length === 0 ? (
                <Text style={{ fontSize: 13, lineHeight: 19, color: LABEL }}>
                  This is the first no-order recorded at this shop.
                </Text>
              ) : (
                <View
                  style={{
                    backgroundColor: '#FFFFFF',
                    borderWidth: 1,
                    borderColor: BORDER,
                    borderRadius: 16,
                    paddingHorizontal: 14,
                  }}
                >
                  {history.map((h, index) => (
                    <View
                      key={`${h.businessDate}-${index}`}
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        gap: 12,
                        paddingVertical: 11,
                        borderBottomWidth: index === history.length - 1 ? 0 : 1,
                        borderBottomColor: ROW_SEPARATOR,
                      }}
                    >
                      <Text
                        numberOfLines={1}
                        style={{ fontSize: 14, color: INK, flexShrink: 1 }}
                      >
                        {h.reasonLabel ?? '—'}
                      </Text>
                      <Text style={{ fontSize: 12, color: MUTED }}>
                        {formatDay(h.businessDate)} · {h.executiveName}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Board 3.5 calls a repeat out rather than leaving a manager
                  to spot it (FR-027). */}
              {repeat ? (
                <Text style={{ fontSize: 13, lineHeight: 19, color: LABEL }}>
                  &ldquo;{repeat.reason}&rdquo; {repeat.count} times in the last{' '}
                  {history.length} no-order visit
                  {history.length === 1 ? '' : 's'}.
                </Text>
              ) : history.length > 0 && history.length < 5 ? (
                <Text style={{ fontSize: 13, color: LABEL }}>
                  Only {history.length} earlier no-order
                  {history.length === 1 ? '' : 's'} recorded here.
                </Text>
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** The most-repeated reason, when one occurs more than once. */
function findRepeat(
  history: Array<{ reasonLabel: string | null }>,
): { reason: string; count: number } | null {
  const tally = new Map<string, number>();
  for (const h of history) {
    if (!h.reasonLabel) continue;
    tally.set(h.reasonLabel, (tally.get(h.reasonLabel) ?? 0) + 1);
  }
  let best: { reason: string; count: number } | null = null;
  for (const [reason, count] of tally) {
    if (count > 1 && (!best || count > best.count)) {
      best = { reason, count };
    }
  }
  return best;
}

function Chip({ bg, fg, label }: { bg: string; fg: string; label: string }) {
  return (
    <View
      style={{
        height: 22,
        paddingHorizontal: 8,
        borderRadius: 999,
        backgroundColor: bg,
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: '700', color: fg }}>
        {label}
      </Text>
    </View>
  );
}
