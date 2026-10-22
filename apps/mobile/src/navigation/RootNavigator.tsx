import { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, Text, View } from 'react-native';
import type { RoleKey, UserStatus } from '@field-sales/shared';

import { BeatPlanFormScreen } from '../features/admin/BeatPlanFormScreen';
import { BeatPlansListScreen } from '../features/admin/BeatPlansListScreen';
import { BrandsReasonsListScreen } from '../features/admin/BrandsReasonsListScreen';
import { AddExtraShopScreen } from '../features/executive/AddExtraShopScreen';
import { MyTotalsScreen } from '../features/executive/MyTotalsScreen';
import { AddShopToTodayScreen } from '../features/manager/AddShopToTodayScreen';
import { AttendanceDayScreen } from '../features/manager/AttendanceDayScreen';
import { AttendanceSessionScreen } from '../features/manager/AttendanceSessionScreen';
import { ManagerVisitsScreen } from '../features/manager/ManagerVisitsScreen';
import { NoOrderVisitScreen } from '../features/manager/NoOrderVisitScreen';
import { OrderVisitScreen } from '../features/manager/OrderVisitScreen';
import { OutOfRangeVisitScreen } from '../features/manager/OutOfRangeVisitScreen';
import { PreviousDayReportScreen } from '../features/manager/PreviousDayReportScreen';
import { MyVisitsScreen } from '../features/executive/MyVisitsScreen';
import { CaptureShopPinScreen } from '../features/executive/CaptureShopPinScreen';
import { CreateShopFromFieldScreen } from '../features/executive/CreateShopFromFieldScreen';
import { RecordNoOrderScreen } from '../features/executive/RecordNoOrderScreen';
import { RecordOrderScreen } from '../features/executive/RecordOrderScreen';
import { ShopVisitScreen } from '../features/executive/ShopVisitScreen';
import { TodaysBeatScreen } from '../features/executive/TodaysBeatScreen';
import type { BeatPlanSummaryForEdit } from '../features/admin/BeatPlansListScreen';
import { AdminVisitsScreen } from '../features/admin/AdminVisitsScreen';
import { HomeScreen } from '../features/admin/HomeScreen';
import { SalaryRunScreen } from '../features/admin/SalaryRunScreen';
import { SalaryEmployeeDetailScreen } from '../features/admin/SalaryEmployeeDetailScreen';
import { ProfileScreen } from '../features/profile/ProfileScreen';
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
  /**
   * 011-admin-visits, PRD §4 screen 4.2. Params preset the tab, exactly as
   * the manager's `ManagerVisits` does.
   */
  AdminVisits: { outcome?: 'ORDER' | 'NO_ORDER'; outOfRange?: boolean };
  /**
   * 012-monthly-salary-run, PRD §4 screen 4.13. No params: the server
   * decides the period (the previous month, in the company's timezone), so
   * the client cannot name a default and get it wrong.
   */
  SalaryRun: undefined;
  /**
   * 012-monthly-salary-run. One employee's month — the only screen in the
   * product with NO board, designed under FR-047 on the user's explicit
   * instruction. Addressed by run AND user because a month has versions:
   * `runId` says which one is being explained.
   */
  SalaryEmployeeDetail: { runId: string; userId: string };
  /**
   * 011-admin-visits, PRD §4 screens 4.3–4.5. Deliberately the SAME route
   * names and param shapes as `ManagerStackParamList`'s, because they are
   * the same three components: the admin boards decode byte-identical to
   * boards 3.4–3.6 (one name in the sample data aside), and all three
   * screens only ever `goBack()`, so neither needs to know which stack it
   * was pushed onto. Renaming one of these without renaming its manager
   * twin would break that reuse.
   */
  OrderVisit: { visitId: string };
  NoOrderVisit: { visitId: string };
  OutOfRangeVisit: { visitId: string };
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
  /**
   * 007-extra-shops, PRD §4 screen 1.4. Reached only while the beat is
   * RUNNING — `totalStopsToday` is today's current stop count, which the
   * footer renders as "as stop N today" with N = count + 1 (the size of the
   * day AFTER the add, not the stop's `sequence`).
   */
  AddExtraShop: {
    assignmentId: string;
    beatPlanName: string | null;
    totalStopsToday: number;
  };
  /** 008-my-visits, PRD §4 screen 1.5 — the executive's own visit history. */
  MyVisits: undefined;
  /** 009-my-totals, PRD §4 screen 1.6 — the executive's own figures by period. */
  MyTotals: undefined;
  /** PRD §4 screen 1.9 — the same ProfileScreen every role uses, reached from the account menu. */
  Profile: undefined;
  /** PRD §4 screen 1.10, "all users". */
  ChangePassword: undefined;
  /** Board 4.9's form, reached from board 1.4's "Shop not listed — create new". */
  CreateShopFromField: {
    assignmentId: string;
    beatPlanName: string | null;
  };
};

/**
 * 010-manager-app, PRD §4 screens 3.1–3.8. The Manager's whole app.
 *
 * Until this slice a manager signed in and landed on the coming-soon
 * screen — `stackForRole` below sent them there with a comment from slice
 * 001 saying their stack was out of that story's scope. This is that scope.
 */
export type ManagerStackParamList = {
  /** Board 3.1 — the landing screen. */
  PreviousDayReport: undefined;
  /** Board 3.3. Params preset the tab when arriving from a report tile. */
  ManagerVisits: { outcome?: 'ORDER' | 'NO_ORDER'; outOfRange?: boolean };
  /** Board 3.4 — reached from the Order tab, and the only place a delivery is marked. */
  OrderVisit: { visitId: string };
  /** Board 3.5 — reached from the No order tab. */
  NoOrderVisit: { visitId: string };
  /** Board 3.6 — reached from the Out of range tab, read-only, whatever the outcome. */
  OutOfRangeVisit: { visitId: string };
  /** Board 3.2. */
  AddShopToToday: undefined;
  /** Board 3.7. */
  AttendanceDay: undefined;
  /** Board 3.8. */
  AttendanceSession: {
    userId: string;
    name: string;
    businessDate: string;
    session: 'MORNING' | 'EVENING';
  };
  /** The same ProfileScreen every role uses, reached from the account menu. */
  Profile: undefined;
  ChangePassword: undefined;
};

export type ComingSoonStackParamList = {
  ComingSoon: undefined;
};

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const AdminStack = createNativeStackNavigator<AdminStackParamList>();
const ExecutiveStack = createNativeStackNavigator<ExecutiveStackParamList>();
const ManagerStack = createNativeStackNavigator<ManagerStackParamList>();
const ComingSoonStack = createNativeStackNavigator<ComingSoonStackParamList>();

/**
 * Where a role with no screens lands. As of 010-manager-app that is only
 * `SYSTEM_ADMIN` (API-only by design) and `EMPLOYEE` (who never signs in) —
 * Admin, Executive and Manager all have their own stacks now.
 */
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
        // Board 1.10 draws its own back chip and 24/700 title, so the
        // native header would be a second one above it.
        options={{ headerShown: false }}
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
      <AdminStack.Screen
        name="AdminVisits"
        component={AdminVisitsScreen}
        options={{ headerShown: false }}
      />
      <AdminStack.Screen
        name="SalaryRun"
        component={SalaryRunScreen}
        options={{ headerShown: false }}
      />
      <AdminStack.Screen
        name="SalaryEmployeeDetail"
        component={SalaryEmployeeDetailScreen}
        options={{ headerShown: false }}
      />
      {/*
        Boards 4.3–4.5 are the manager's 3.4–3.6 components, registered a
        second time here under the same route names. Decoding both sets
        showed identical markup, and each screen's only navigation call is
        `goBack()`, so there is nothing stack-specific to parameterise — a
        second copy would only be a second thing to keep in step.
      */}
      <AdminStack.Screen
        name="OrderVisit"
        component={OrderVisitScreen}
        options={{ headerShown: false }}
      />
      <AdminStack.Screen
        name="NoOrderVisit"
        component={NoOrderVisitScreen}
        options={{ headerShown: false }}
      />
      <AdminStack.Screen
        name="OutOfRangeVisit"
        component={OutOfRangeVisitScreen}
        options={{ headerShown: false }}
      />
    </AdminStack.Navigator>
  );
}

function ManagerNavigator() {
  return (
    <ManagerStack.Navigator>
      <ManagerStack.Screen
        name="PreviousDayReport"
        component={PreviousDayReportScreen}
        options={{ headerShown: false }}
      />
      <ManagerStack.Screen
        name="ManagerVisits"
        component={ManagerVisitsScreen}
        options={{ headerShown: false }}
      />
      <ManagerStack.Screen
        name="OrderVisit"
        component={OrderVisitScreen}
        options={{ headerShown: false }}
      />
      <ManagerStack.Screen
        name="NoOrderVisit"
        component={NoOrderVisitScreen}
        options={{ headerShown: false }}
      />
      <ManagerStack.Screen
        name="OutOfRangeVisit"
        component={OutOfRangeVisitScreen}
        options={{ headerShown: false }}
      />
      <ManagerStack.Screen
        name="AddShopToToday"
        component={AddShopToTodayScreen}
        options={{ headerShown: false }}
      />
      <ManagerStack.Screen
        name="AttendanceDay"
        component={AttendanceDayScreen}
        options={{ headerShown: false }}
      />
      <ManagerStack.Screen
        name="AttendanceSession"
        component={AttendanceSessionScreen}
        options={{ headerShown: false }}
      />
      <ManagerStack.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ headerShown: false }}
      />
      <ManagerStack.Screen
        name="ChangePassword"
        component={ChangePasswordScreen}
        options={{ headerShown: false }}
      />
    </ManagerStack.Navigator>
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
        name="Profile"
        component={ProfileScreen}
        options={{ headerShown: false }}
      />
      <ExecutiveStack.Screen
        name="ChangePassword"
        component={ChangePasswordScreen}
        options={{ headerShown: false }}
      />
      <ExecutiveStack.Screen
        name="MyTotals"
        component={MyTotalsScreen}
        options={{ headerShown: false }}
      />
      <ExecutiveStack.Screen
        name="MyVisits"
        component={MyVisitsScreen}
        options={{ headerShown: false }}
      />
      <ExecutiveStack.Screen
        name="AddExtraShop"
        component={AddExtraShopScreen}
        options={{ headerShown: false }}
      />
      <ExecutiveStack.Screen
        name="CreateShopFromField"
        component={CreateShopFromFieldScreen}
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
  if (role === 'MANAGER') {
    return <ManagerNavigator />;
  }

  if (role === 'MARKETING_EXECUTIVE') {
    return <ExecutiveNavigator />;
  }
  // SYSTEM_ADMIN (API-only, PRD §4), EMPLOYEE (never signs in), and
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
