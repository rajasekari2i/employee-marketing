import { useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RoleKey, UserStatus } from '@field-sales/shared';

import { apiRequest } from '../../api/client';
import { AccountMenu } from '../../components/AccountMenu';
import { AdminBottomNav } from '../../components/AdminBottomNav';
import {
  OutlineIcon,
  type IconShape,
} from '../../components/icons/OutlineIcon';
import { clearSession, getSession } from '../../lib/secureSession';
import type { AdminStackParamList } from '../../navigation/RootNavigator';
import {
  BG,
  BLUE,
  BORDER,
  INK,
  MUTED,
  ROLE_LABELS,
  comingSoon,
} from './adminDesign';

/**
 * PRD §4 screen 4.1 ("Company admin · Home"). Layout/colors/icons below are
 * taken verbatim from `docs/ui-design/Field_Sales_Beat_App.html` §4.1 — see
 * that board for the source of every hex value and SVG path here.
 *
 * Only two tiles have a real backend behind them yet (CLAUDE.md's build
 * order: 001-foundation/002-auth/003-company-and-users are built; 004
 * through 014 — masters, shops, beat plans, salary, reports — are not).
 * "Users & roles" shows a real count from `GET /users`; "Company settings"
 * shows the fixed architecture defaults every company is created with
 * (`CompanySettings`'s `@default(...)`s) since no endpoint exists yet to
 * change them, so these values are accurate today, not placeholders. Every
 * other tile, the "Today's assignments" banner, and the bottom nav's
 * Visits/Beats/Shops items are honest "coming soon" — matching the design's
 * exact shape/color, but never showing an invented number for a module that
 * doesn't exist yet.
 */

/** contracts/me.md's exact `GET /me` response shape. */
interface MeResponse {
  id: string;
  name: string;
  email: string | null;
  username: string | null;
  role: RoleKey;
  companyId: string | null;
  status: UserStatus;
  photoUrl: string | null;
  permissions: string[];
  company: { code: string; name: string; timezone: string } | null;
}

interface UsersListResponse {
  items: Array<{ status: UserStatus }>;
  nextCursor: string | null;
}

interface ShopsListResponse {
  items: Array<{ pinStatus: 'NONE' | 'APPROVED' }>;
  nextCursor: string | null;
}

interface BeatPlansListResponse {
  items: Array<{ executive: { id: string; name: string } | null }>;
  nextCursor: string | null;
}

/** 004-brands-reasons-crud: `/brands` and `/reasons` share one shape and, unlike the three above, carry no `nextCursor` — both are deliberately unpaginated (contracts/masters.md). */
interface MastersListResponse {
  items: Array<{ id: string }>;
}

type HomeNavigationProp = NativeStackNavigationProp<
  AdminStackParamList,
  'Home'
>;

const ICON_USERS: IconShape[] = [
  { circle: [9, 8, 3.5] },
  {
    d: 'M2.5 20c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5M16 4.5a3.5 3.5 0 0 1 0 7M18 15c2 .6 3.2 2.2 3.8 5',
  },
];
const ICON_BEAT_PLANS: IconShape[] = [
  { circle: [6, 18, 2.5] },
  { circle: [18, 6, 2.5] },
  { d: 'M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5' },
];
const ICON_SHOPS: IconShape[] = [
  { d: 'M3 9l1.5-5h15L21 9M3 9h18M3 9v11h18V9M9 20v-6h6v6' },
];
const ICON_MASTERS: IconShape[] = [
  { d: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' },
];
const ICON_SALARY: IconShape[] = [{ d: 'M7 4h10M7 9h10M7 4c5 0 5 5 0 5l7 11' }];
const ICON_REPORTS: IconShape[] = [{ d: 'M4 20V10M10 20V4M16 20v-7M22 20H2' }];
const ICON_ARROW: IconShape[] = [{ d: 'M9 6l6 6-6 6' }];

interface TileProps {
  icon: IconShape[];
  title: string;
  subtitle: string;
  subtitleColor?: string;
  onPress: () => void;
}

function Tile({ icon, title, subtitle, subtitleColor, onPress }: TileProps) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexBasis: '48%',
        flexGrow: 1,
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 16,
        padding: 12,
        gap: 8,
        minHeight: 96,
      }}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          backgroundColor: '#E3EBFC',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <OutlineIcon color={BLUE} shapes={icon} size={18} />
      </View>
      <Text style={{ fontSize: 15, fontWeight: '700', color: INK }}>
        {title}
      </Text>
      <Text style={{ fontSize: 12, color: subtitleColor ?? MUTED }}>
        {subtitle}
      </Text>
    </Pressable>
  );
}

export function HomeScreen() {
  const navigation = useNavigation<HomeNavigationProp>();
  const insets = useSafeAreaInsets();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [userCounts, setUserCounts] = useState<{
    active: number;
    inactive: number;
  } | null>(null);
  const [shopCounts, setShopCounts] = useState<{
    total: number;
    withoutPin: number;
  } | null>(null);
  const [beatPlanCounts, setBeatPlanCounts] = useState<{
    total: number;
    unassigned: number;
  } | null>(null);
  const [masterCounts, setMasterCounts] = useState<{
    brands: number;
    reasons: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    void apiRequest<MeResponse>('/me')
      .then((data) => {
        if (!cancelled) {
          setMe(data);
        }
      })
      .catch(() => {
        // A failed /me call here is almost always the API client's own
        // refresh-retry interceptor having already cleared the session
        // store on an unrecoverable 401 — RootNavigator is about to swap
        // back to Sign In on its own (subscribeSession()), so there is
        // nothing useful to show the user in the moment before that
        // happens.
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    // Best-effort — the "Users & roles" tile's count, not the screen's
    // primary data. Up to 100 users (the API's max `limit`), counted by
    // status client-side; there is no dedicated count endpoint and this
    // slice's company scale doesn't warrant building one yet.
    void apiRequest<UsersListResponse>('/users?limit=100')
      .then((result) => {
        if (cancelled) {
          return;
        }
        const active = result.items.filter((u) => u.status === 'ACTIVE').length;
        const inactive = result.items.length - active;
        setUserCounts({ active, inactive });
      })
      .catch(() => {
        // Leave userCounts null — the tile falls back to a neutral subtitle.
      });

    // Best-effort — the "Shops" tile's count, same posture as userCounts
    // above (up to 100 shops, counted client-side, no dedicated count
    // endpoint).
    void apiRequest<ShopsListResponse>('/shops?limit=100')
      .then((result) => {
        if (cancelled) {
          return;
        }
        const withoutPin = result.items.filter(
          (s) => s.pinStatus === 'NONE',
        ).length;
        setShopCounts({ total: result.items.length, withoutPin });
      })
      .catch(() => {
        // Leave shopCounts null — the tile falls back to a neutral subtitle.
      });

    // Best-effort — the "Beat plans" tile's count, same posture as
    // shopCounts above (up to 100 plans, counted client-side, no dedicated
    // count endpoint).
    void apiRequest<BeatPlansListResponse>('/beat-plans?limit=100')
      .then((result) => {
        if (cancelled) {
          return;
        }
        const unassigned = result.items.filter(
          (p) => p.executive === null,
        ).length;
        setBeatPlanCounts({ total: result.items.length, unassigned });
      })
      .catch(() => {
        // Leave beatPlanCounts null — the tile falls back to a neutral subtitle.
      });

    // Best-effort — the "Brands & reasons" tile's count, same posture as the
    // three above. Simpler than its siblings: 004-brands-reasons-crud's two
    // list endpoints are deliberately unpaginated (research.md §2), so these
    // are complete counts with no `?limit=100` truncation caveat.
    void Promise.all([
      apiRequest<MastersListResponse>('/brands'),
      apiRequest<MastersListResponse>('/reasons'),
    ])
      .then(([brandsResult, reasonsResult]) => {
        if (cancelled) {
          return;
        }
        setMasterCounts({
          brands: brandsResult.items.length,
          reasons: reasonsResult.items.length,
        });
      })
      .catch(() => {
        // Leave masterCounts null — the tile falls back to a neutral subtitle.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout(): Promise<void> {
    setLoggingOut(true);
    try {
      const session = await getSession();
      if (session) {
        await apiRequest('/auth/logout', {
          method: 'POST',
          body: { refreshToken: session.refreshToken },
        });
      }
    } catch {
      // Clear the session regardless — never strand the user looking
      // logged-in because of a network error.
    } finally {
      await clearSession();
      setLoggingOut(false);
      // No explicit navigation call: clearing the session store notifies
      // RootNavigator (subscribeSession()), which swaps back to Sign In.
    }
  }

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: BG,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator testID="home-loading" />
      </View>
    );
  }

  const usersSubtitle = userCounts
    ? `${userCounts.active} active · ${userCounts.inactive} inactive`
    : 'View all';

  const shopsSubtitle = shopCounts
    ? `${shopCounts.total} shops · ${shopCounts.withoutPin} without pin`
    : 'View all';

  const beatPlansSubtitle = beatPlanCounts
    ? `${beatPlanCounts.total} plans · ${beatPlanCounts.unassigned} unassigned`
    : 'View all';

  const mastersSubtitle = masterCounts
    ? `${masterCounts.brands} brands · ${masterCounts.reasons} reasons`
    : 'View all';

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <View
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 20,
          paddingBottom: 12,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <View style={{ gap: 2 }}>
          <Text style={{ fontSize: 13, color: MUTED }}>
            Company administrator
          </Text>
          <Text style={{ fontSize: 26, fontWeight: '700', color: INK }}>
            {me?.company?.name ?? 'Field Sales'}
          </Text>
          <Text style={{ fontSize: 12, color: MUTED }}>
            {me?.company?.code}
            {me?.company?.code && me?.company?.timezone ? ' · ' : ''}
            {me?.company?.timezone}
          </Text>
        </View>

        <AccountMenu
          loggingOut={loggingOut}
          name={me?.name}
          onLogoutPress={() => void handleLogout()}
          onProfilePress={() => navigation.navigate('Profile')}
          roleLabel={me ? ROLE_LABELS[me.role] : ''}
          testIDPrefix="home"
        />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          gap: 14,
          paddingBottom: 84 + insets.bottom + 20,
        }}
        style={{ flex: 1 }}
      >
        <Pressable
          onPress={() => comingSoon("Today's assignments")}
          style={{
            backgroundColor: BLUE,
            borderRadius: 18,
            padding: 14,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <View style={{ gap: 2 }}>
            <Text style={{ fontSize: 12, color: '#D3DFFB' }}>
              Today&apos;s assignments
            </Text>
            <Text style={{ fontSize: 20, fontWeight: '700', color: '#FFFFFF' }}>
              Beat plans not set up yet
            </Text>
          </View>
          <OutlineIcon
            color="#FFFFFF"
            shapes={ICON_ARROW}
            size={22}
            strokeWidth={2}
          />
        </Pressable>

        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <Tile
            icon={ICON_USERS}
            onPress={() => navigation.navigate('UsersList')}
            subtitle={usersSubtitle}
            title="Users & roles"
          />
          <Tile
            icon={ICON_BEAT_PLANS}
            onPress={() => navigation.navigate('BeatPlansList')}
            subtitle={beatPlansSubtitle}
            title="Beat plans"
          />
          <Tile
            icon={ICON_SHOPS}
            onPress={() => navigation.navigate('ShopsList')}
            subtitle={shopsSubtitle}
            title="Shops"
          />
          <Tile
            icon={ICON_MASTERS}
            onPress={() => navigation.navigate('BrandsReasonsList')}
            subtitle={mastersSubtitle}
            title="Brands & reasons"
          />
          <Tile
            icon={ICON_SALARY}
            onPress={() => comingSoon('Salary')}
            subtitle="Coming soon"
            title="Salary"
          />
          <Tile
            icon={ICON_REPORTS}
            onPress={() => comingSoon('Reports')}
            subtitle="Coming soon"
            title="Reports"
          />
        </View>

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
                letterSpacing: 0.6,
                textTransform: 'uppercase',
                color: MUTED,
              }}
            >
              Company settings
            </Text>
            <Pressable onPress={() => comingSoon('Edit company settings')}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: BLUE }}>
                Edit
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
            {[
              ['Default visit radius', '5 m'],
              ['Max GPS accuracy / age', '20 m · 2 min'],
              ['Session start (AM / PM)', '09:00 · 14:00'],
            ].map(([label, value], index, arr) => (
              <View
                key={label}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  minHeight: 40,
                  borderBottomWidth: index === arr.length - 1 ? 0 : 1,
                  borderBottomColor: '#ECEFF4',
                  paddingHorizontal: 14,
                }}
              >
                <Text style={{ fontSize: 13, color: MUTED }}>{label}</Text>
                <Text style={{ fontSize: 13, fontWeight: '700', color: INK }}>
                  {value}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      <AdminBottomNav
        active="Home"
        bottomInset={insets.bottom}
        onHomePress={() => {}}
        onVisitsPress={() => navigation.navigate('AdminVisits', {})}
        onBeatsPress={() => navigation.navigate('BeatPlansList')}
        onShopsPress={() => navigation.navigate('ShopsList')}
      />
    </View>
  );
}
