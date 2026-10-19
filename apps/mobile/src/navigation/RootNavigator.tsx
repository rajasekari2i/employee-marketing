import { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, Text, View } from 'react-native';
import type { RoleKey, UserStatus } from '@field-sales/shared';

import { BeatPlanFormScreen } from '../features/admin/BeatPlanFormScreen';
import { BeatPlansListScreen } from '../features/admin/BeatPlansListScreen';
import { BrandsReasonsListScreen } from '../features/admin/BrandsReasonsListScreen';
import { CaptureShopPinScreen } from '../features/executive/CaptureShopPinScreen';
import { RecordNoOrderScreen } from '../features/executive/RecordNoOrderScreen';
import { RecordOrderScreen } from '../features/executive/RecordOrderScreen';
import { ShopVisitScreen } from '../features/executive/ShopVisitScreen';
import { TodaysBeatScreen } from '../features/executive/TodaysBeatScreen';
import type { BeatPlanSummaryForEdit } from '../features/admin/BeatPlansListScreen';
import { HomeScreen } from '../features/admin/HomeScreen';
import { ProfileScreen } from '../features/admin/ProfileScreen';
import { ShopFormScreen } from '../features/admin/ShopFormScreen';
import { ShopsListScreen } from '../features/admin/ShopsListScreen';
import type { ShopSummaryForEdit } from '../features/admin/ShopsListScreen';
import { UserFormScreen } from '../features/admin/UserFormScreen';
import { UsersListScreen } from '../features/admin/UsersListScreen';
import { ChangePasswordScreen } from '../features/auth/ChangePasswordScreen';
import { ForgotPasswordScreen } from '../features/auth/ForgotPasswordScreen';
import { SignInScreen } from '../features/auth/SignInScreen';
import {
  getSession,
  subscribeSession,
  type StoredSession,
} from '../lib/secureSession';

/**
 * User Story 2 (specs/001-company-user-auth/orchestration-plan.md), DoD
 * items 0 + 5. Replaces `App.tsx`'s old hardcoded `PlaceholderScreen`/
 * `Stack.Navigator` — this is now the single root of the app's navigation
 * tree (owns its own `NavigationContainer`), switching between three
 * mutually-exclusive stacks based on the session store
 * (`../lib/secureSession.ts`):
 *
 *   - no session            -> the Sign In stack
 *   - `COMPANY_ADMIN`       -> the admin stack (this story's Home screen)
 *   - anything else         -> a trivial "coming in a later update" stack
 *     (`MANAGER`/`MARKETING_EXECUTIVE` per this story's DoD; `SYSTEM_ADMIN`
 *     and any future role fall back to the same placeholder, since the
 *     System Admin has no mobile screens in release 1 at all — PRD §4 — and
 *     there is no "unknown role" screen worth building a separate branch
 *     for)
 *
 * Deliberately has NO explicit `navigation.navigate()` call anywhere for
 * "log in" or "log out" — `SignInScreen`'s successful login and
 * `HomeScreen`'s logout both just call `setSession()`/`clearSession()` on
 * the session store, and this component's `subscribeSession()` listener
 * re-renders the whole switch the moment that happens. This is what DoD
 * item 4 ("navigate into RootNavigator's authenticated stack") and item 7
 * ("navigates back to Sign In") actually resolve to at this layer.
 */

export type AuthStackParamList = {
  SignIn: undefined;
  /** User Story 4, DoD item 10 (PRD §4 screen 1.2). */
  ForgotPassword: undefined;
};

/**
 * User Story 3's `UserForm` route carries the row the Users list screen
 * already fetched (`GET /users`'s per-item shape) rather than just an id —
 * `contracts/users.md` has no `GET /users/:id` detail endpoint in this
 * slice, so this is the only source `UserFormScreen.tsx` has to prefill an
 * edit from. `undefined` means "create a new user."
 */
export interface UserSummaryForEdit {
  id: string;
  name: string;
  email: string | null;
  role: RoleKey;
  status: UserStatus;
  username: string | null;
  monthlySalary: string | null;
  halfDayRate: string | null;
  rateEffectiveFrom: string | null;
  photoUrl: string | null;
}

export type AdminStackParamList = {
  Home: undefined;
  Profile: undefined;
  /** User Story 4, DoD item 9 (PRD §4 screen 1.10). */
  ChangePassword: undefined;
  UsersList: undefined;
  UserForm: { user?: UserSummaryForEdit } | undefined;
  /**
   * 002-shops-crud, PRD §4 screen 4.8. 003-beat-plans-crud (research.md §2)
   * added the optional selection-mode params: when `selectionMode` is set,
   * this screen becomes a multi-select picker (used by
   * `BeatPlanFormScreen`'s "+ Add existing shops") instead of navigating to
   * `ShopForm` on tap. No params (every existing call site) is unchanged.
   */
  ShopsList:
    | {
        selectionMode?: boolean;
        onSelect?: (shops: ShopSummaryForEdit[]) => void;
      }
    | undefined;
  /**
   * 002-shops-crud, PRD §4 screen 4.9. `undefined` means "create a new
   * shop," same convention as `UserForm` above. 003-beat-plans-crud
   * (research.md §3) added the optional `onCreated` callback: when present
   * and a *create* save succeeds, it's called with the new shop before
   * `navigation.goBack()` — used by `BeatPlanFormScreen`'s "Create a new
   * shop in this beat" instead of only going back.
   */
  ShopForm:
    | {
        shop?: ShopSummaryForEdit;
        onCreated?: (shop: ShopSummaryForEdit) => void;
      }
    | undefined;
  /** 003-beat-plans-crud, PRD §4 screen 4.6. */
  BeatPlansList: undefined;
  /** 003-beat-plans-crud, PRD §4 screen 4.7. `undefined` means "create a new beat plan," same convention as `UserForm`/`ShopForm` above. */
  BeatPlanForm: { beatPlan?: BeatPlanSummaryForEdit } | undefined;
  /** 004-brands-reasons-crud, PRD §4 screen 4.12. One screen, two tabs — no separate form screen; rows are added, reordered and toggled in place. */
  BrandsReasonsList: undefined;
};

/** 005-executive-dashboard, PRD §4 screen 1.3. The executive's only built destination so far; the bottom bar's other two tabs are rendered but not yet navigable. */
export type ExecutiveStackParamList = {
  TodaysBeat: undefined;
  /** 006-visit-outcomes, PRD §4 screen 1.7. */
  ShopVisit: { stopId: string };
  /** PRD §4 screen 2.1. `sampleShown` is carried through from the visit screen, where it is required before either outcome. */
  RecordOrder: { stopId: string; shopName: string; sampleShown: boolean };
  /** PRD §4 screen 2.2. */
  RecordNoOrder: { stopId: string; shopName: string; sampleShown: boolean };
  /**
   * PRD §4 screen 1.8 — reached instead of ShopVisit when the shop has no
   * saved location. `maxAccuracyMeters` is the company's gate, passed in so
   * the screen can show the verdict without a second round trip.
   */
  CaptureShopPin: {
    stopId: string;
    shopId: string;
    shopName: string;
    shopCode: string;
    addressLine: string | null;
    maxAccuracyMeters: number;
  };
};

export type ComingSoonStackParamList = {
  ComingSoon: undefined;
};

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const AdminStack = createNativeStackNavigator<AdminStackParamList>();
const ExecutiveStack = createNativeStackNavigator<ExecutiveStackParamList>();
const ComingSoonStack = createNativeStackNavigator<ComingSoonStackParamList>();

/** DoD item 5: `MANAGER`/`MARKETING_EXECUTIVE` (and any other non-Admin role) land here — their own stacks are out of this story's scope. */
function ComingSoonScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-white px-6">
      <Text className="text-center text-base text-gray-600">
        Your screens are coming in a later update.
      </Text>
    </View>
  );
}

function LoadingScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-white">
      <ActivityIndicator testID="root-navigator-loading" />
    </View>
  );
}

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="SignIn" component={SignInScreen} />
      <AuthStack.Screen
        name="ForgotPassword"
        component={ForgotPasswordScreen}
        options={{ headerShown: true, title: 'Forgot password' }}
      />
    </AuthStack.Navigator>
  );
}

function AdminNavigator() {
  return (
    <AdminStack.Navigator>
      <AdminStack.Screen
        name="Home"
        component={HomeScreen}
        options={{ headerShown: false }}
      />
      <AdminStack.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ headerShown: false }}
      />
      <AdminStack.Screen
        name="ChangePassword"
        component={ChangePasswordScreen}
        options={{ title: 'Change password' }}
      />
      <AdminStack.Screen
        name="UsersList"
        component={UsersListScreen}
        options={{ headerShown: false }}
      />
      <AdminStack.Screen
        name="UserForm"
        component={UserFormScreen}
        options={{ headerShown: false }}
      />
      <AdminStack.Screen
        name="ShopsList"
        component={ShopsListScreen}
        options={{ headerShown: false }}
      />
      <AdminStack.Screen
        name="ShopForm"
        component={ShopFormScreen}
        options={{ headerShown: false }}
      />
      <AdminStack.Screen
        name="BeatPlansList"
        component={BeatPlansListScreen}
        options={{ headerShown: false }}
      />
      <AdminStack.Screen
        name="BeatPlanForm"
        component={BeatPlanFormScreen}
        options={{ headerShown: false }}
      />
      <AdminStack.Screen
        name="BrandsReasonsList"
        component={BrandsReasonsListScreen}
        options={{ headerShown: false }}
      />
    </AdminStack.Navigator>
  );
}

function ComingSoonNavigator() {
  return (
    <ComingSoonStack.Navigator>
      <ComingSoonStack.Screen
        name="ComingSoon"
        component={ComingSoonScreen}
        options={{ title: 'Field Sales' }}
      />
    </ComingSoonStack.Navigator>
  );
}

function ExecutiveNavigator() {
  return (
    <ExecutiveStack.Navigator>
      <ExecutiveStack.Screen
        name="TodaysBeat"
        component={TodaysBeatScreen}
        options={{ headerShown: false }}
      />
      <ExecutiveStack.Screen
        name="ShopVisit"
        component={ShopVisitScreen}
        options={{ headerShown: false }}
      />
      <ExecutiveStack.Screen
        name="RecordOrder"
        component={RecordOrderScreen}
        options={{ headerShown: false }}
      />
      <ExecutiveStack.Screen
        name="RecordNoOrder"
        component={RecordNoOrderScreen}
        options={{ headerShown: false }}
      />
      <ExecutiveStack.Screen
        name="CaptureShopPin"
        component={CaptureShopPinScreen}
        options={{ headerShown: false }}
      />
    </ExecutiveStack.Navigator>
  );
}

function stackForRole(role: RoleKey) {
  if (role === 'COMPANY_ADMIN') {
    return <AdminNavigator />;
  }
  // 005-executive-dashboard: the executive now has their own stack.
  if (role === 'MARKETING_EXECUTIVE') {
    return <ExecutiveNavigator />;
  }
  // MANAGER and SYSTEM_ADMIN (no mobile screens at all, PRD §4), and
  // anything else, still share the placeholder.
  return <ComingSoonNavigator />;
}

export function RootNavigator() {
  // `undefined` = still loading the session from the keychain on mount;
  // `null` = loaded and confirmed there is none.
  const [session, setSessionState] = useState<StoredSession | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;

    void getSession()
      .then((value) => {
        if (!cancelled) {
          setSessionState(value);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSessionState(null);
        }
      });

    const unsubscribe = subscribeSession((value) => {
      setSessionState(value);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return (
    <NavigationContainer>
      {session === undefined ? (
        <LoadingScreen />
      ) : session === null ? (
        <AuthNavigator />
      ) : (
        stackForRole(session.role)
      )}
    </NavigationContainer>
  );
}
