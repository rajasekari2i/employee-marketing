import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
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

import { ApiError, apiRequest, generateIdempotencyKey } from '../../api/client';
import {
  OutlineIcon,
  type IconShape,
} from '../../components/icons/OutlineIcon';
import type { ManagerStackParamList } from '../../navigation/RootNavigator';
import {
  ACTION_BAR_BG,
  ACTION_BAR_INK,
  BG,
  BLUE,
  BORDER,
  DANGER,
  INK,
  LABEL,
  MUTED,
} from './managerDesign';
import { describeFailure } from './loadState';

/**
 * PRD §4 screen 3.2 ("Add shop to today — manager"), board uuid
 * `47a5b552-8ab3-44cf-a169-3d8aeb692e06` (010-manager-app).
 *
 * The **reason is required** and is written to the audit trail with the
 * manager and the executive (FR-043) — which is the one thing this flow has
 * that the executive's own extra-shop flow does not.
 *
 * Adding never touches the beat plan and never affects another day
 * (FR-044). That is not re-implemented here: this screen calls the same
 * transaction slice 007 built, through a second entry point.
 */

const ICON_BACK: IconShape[] = [{ d: 'M15 18l-6-6 6-6' }];
const ICON_SEARCH: IconShape[] = [
  { circle: [11, 11, 7] },
  { d: 'M20 20l-4-4' },
];

/**
 * One of today's assignments. The manager picks a PERSON while the add
 * route is addressed by that person's DAY, so the screen resolves one to
 * the other through `GET /assignments` — which also supplies the board's
 * "5 of 12 done" progress line.
 */
interface ExecutiveOption {
  assignmentId: string;
  executiveId: string;
  executiveName: string;
  beatPlanName: string | null;
  state: 'NOT_STARTED' | 'RUNNING' | 'ENDED' | 'AUTO_CLOSED';
  visited: number;
  total: number;
  /** Already on that day — planned or extra. Excluded from the picker. */
  shopIds: string[];
}

interface ShopOption {
  id: string;
  name: string;
  addressLine: string | null;
}

export function AddShopToTodayScreen() {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<
      NativeStackNavigationProp<ManagerStackParamList, 'AddShopToToday'>
    >();

  const [executives, setExecutives] = useState<ExecutiveOption[]>([]);
  const [chosen, setChosen] = useState<ExecutiveOption | null>(null);
  const [assignmentId, setAssignmentId] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [shops, setShops] = useState<ShopOption[]>([]);
  const [searchFailed, setSearchFailed] = useState(false);
  const [pickedShop, setPickedShop] = useState<ShopOption | null>(null);
  const [reason, setReason] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // TODAY's assignments — not the report, which is about yesterday. This is
  // the route that turns the chosen person into the day the stop is added
  // to.
  useEffect(() => {
    void apiRequest<ExecutiveOption[]>('/assignments')
      .then(setExecutives)
      .catch((err: unknown) =>
        setError(
          describeFailure(err, "today's beats", false).error ??
            "Could not load today's beats.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runSearch = useCallback((term: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      if (term.trim().length === 0) {
        setShops([]);
        setSearchFailed(false);
        return;
      }
      void apiRequest<{ items: ShopOption[] }>(
        `/shops?search=${encodeURIComponent(term.trim())}&limit=20`,
      )
        .then((r) => {
          setShops(r.items);
          setSearchFailed(false);
        })
        .catch(() => {
          // An empty list here would read as "no shop by that name", which
          // is a different and false statement (T336). Say the search
          // could not run.
          setShops([]);
          setSearchFailed(true);
        });
    }, 300);
  }, []);

  /**
   * Shops already on the chosen executive's day are not offered — adding
   * one is refused by `@@unique([assignmentId, shopId])` with
   * `SHOP_ALREADY_IN_BEAT`, so offering it would only produce an error the
   * picker already had the information to prevent.
   */
  const visibleShops = chosen
    ? shops.filter((s) => !chosen.shopIds.includes(s.id))
    : shops;

  async function add(): Promise<void> {
    if (!assignmentId || !pickedShop || reason.trim().length < 3 || saving) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/assignments/${assignmentId}/stops/manager`, {
        method: 'POST',
        body: { shopId: pickedShop.id, reason: reason.trim() },
        idempotencyKey: generateIdempotencyKey(),
      });
      navigation.goBack();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'SHOP_ALREADY_IN_BEAT'
          ? `${pickedShop.name} is already on that executive's list today.`
          : err instanceof ApiError && err.code === 'BEAT_NOT_STARTED'
            ? 'That executive has not started their beat yet.'
            : err instanceof Error
              ? err.message
              : 'Could not add the shop.',
      );
      setSaving(false);
    }
  }

  const canAdd =
    assignmentId !== null && pickedShop !== null && reason.trim().length >= 3;

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
          <Text style={{ fontSize: 13, color: MUTED }}>Today only</Text>
          <Text style={{ fontSize: 22, fontWeight: '700', color: INK }}>
            Add shop to today
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
        <View
          style={{
            paddingVertical: 12,
            paddingHorizontal: 14,
            borderRadius: 14,
            backgroundColor: ACTION_BAR_BG,
          }}
        >
          <Text style={{ fontSize: 13, lineHeight: 19, color: ACTION_BAR_INK }}>
            This adds one extra stop to the executive&rsquo;s day. The{' '}
            <Text style={{ fontWeight: '700' }}>beat plan is not changed</Text>,
            and tomorrow&rsquo;s list is unaffected.
          </Text>
        </View>

        {loading ? (
          <View style={{ paddingVertical: 32, alignItems: 'center' }}>
            <ActivityIndicator color={BLUE} />
          </View>
        ) : null}

        <Section title="Executive">
          {executives.length === 0 && !loading ? (
            <Text style={{ fontSize: 13, color: LABEL }}>
              No executive has a beat today, so there is nothing to add to.
            </Text>
          ) : null}
          {executives.map((e) => (
            <Pressable
              key={e.executiveId}
              onPress={() => {
                setChosen(e);
                // A shop chosen for someone else may already be on this
                // person's day; dropping it is better than leaving a
                // selection the picker no longer offers.
                if (pickedShop && e.shopIds.includes(pickedShop.id)) {
                  setPickedShop(null);
                }
                setProgress(
                  `${e.beatPlanName ?? 'No beat plan'} · ${e.visited} of ${e.total} done`,
                );
                setAssignmentId(e.assignmentId);
              }}
              style={{
                paddingVertical: 11,
                paddingHorizontal: 12,
                borderRadius: 12,
                borderWidth: chosen?.executiveId === e.executiveId ? 2 : 1,
                borderColor:
                  chosen?.executiveId === e.executiveId ? BLUE : BORDER,
                backgroundColor:
                  chosen?.executiveId === e.executiveId ? '#E3EBFC' : '#FFFFFF',
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: INK }}>
                {e.executiveName}
              </Text>
              <Text style={{ fontSize: 12, color: MUTED }}>
                {e.beatPlanName ?? 'No beat plan'} · {e.visited} of {e.total}{' '}
                done
              </Text>
            </Pressable>
          ))}
          {progress ? (
            <Text style={{ fontSize: 12, color: MUTED }}>{progress}</Text>
          ) : null}
        </Section>

        <Section title="Shop to add">
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              height: 48,
              paddingHorizontal: 12,
              borderRadius: 12,
              backgroundColor: '#FFFFFF',
              borderWidth: 1.5,
              borderColor: BORDER,
            }}
          >
            <OutlineIcon color={MUTED} shapes={ICON_SEARCH} size={18} />
            <TextInput
              autoCapitalize="none"
              onChangeText={(t) => {
                setSearch(t);
                runSearch(t);
              }}
              placeholder="Search shops"
              placeholderTextColor={MUTED}
              style={{ flexGrow: 1, fontSize: 15, color: INK, padding: 0 }}
              value={search}
            />
          </View>
          {searchFailed ? (
            <Text style={{ fontSize: 13, color: LABEL }}>
              The search could not run. Check your signal and try again.
            </Text>
          ) : null}
          {search.trim().length > 0 &&
          !searchFailed &&
          visibleShops.length === 0 ? (
            <Text style={{ fontSize: 13, color: LABEL }}>
              {shops.length > 0
                ? `Every match is already on that list today.`
                : 'No shop matches that name.'}
            </Text>
          ) : null}
          {visibleShops.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => setPickedShop(s)}
              style={{
                paddingVertical: 11,
                paddingHorizontal: 12,
                borderRadius: 12,
                borderWidth: pickedShop?.id === s.id ? 2 : 1,
                borderColor: pickedShop?.id === s.id ? BLUE : BORDER,
                backgroundColor:
                  pickedShop?.id === s.id ? '#E3EBFC' : '#FFFFFF',
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: INK }}>
                {s.name}
              </Text>
              {s.addressLine ? (
                <Text numberOfLines={1} style={{ fontSize: 12, color: MUTED }}>
                  {s.addressLine}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </Section>

        <Section title="Reason for adding (recorded in the audit log)">
          <TextInput
            multiline
            onChangeText={setReason}
            placeholder="Why is this shop being added?"
            placeholderTextColor={MUTED}
            style={{
              minHeight: 72,
              borderWidth: 1.5,
              borderColor: BORDER,
              borderRadius: 12,
              padding: 12,
              fontSize: 15,
              color: INK,
              backgroundColor: '#FFFFFF',
              textAlignVertical: 'top',
            }}
            value={reason}
          />
        </Section>

        {error ? (
          <Text style={{ fontSize: 13, color: DANGER }}>{error}</Text>
        ) : null}

        <Text style={{ fontSize: 13, color: LABEL }}>
          {canAdd && chosen && pickedShop
            ? `${chosen.executiveName} will see ${pickedShop.name} as an extra stop today.`
            : 'Choose an executive, a shop and a reason to continue.'}
        </Text>

        <Pressable
          disabled={!canAdd || saving}
          onPress={() => void add()}
          style={{
            height: 54,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: canAdd ? BLUE : BORDER,
          }}
        >
          {saving ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text
              style={{
                fontSize: 16,
                fontWeight: '700',
                color: canAdd ? '#FFFFFF' : MUTED,
              }}
            >
              Add to today&rsquo;s plan
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 8 }}>
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
