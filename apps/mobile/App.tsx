import './global.css';

import { useEffect } from 'react';
import { LogBox, StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { requestStartupPermissions } from './src/lib/permissions';
import { RootNavigator } from './src/navigation/RootNavigator';

/**
 * User Story 2 (specs/001-company-user-auth/orchestration-plan.md), DoD
 * item 0. Replaces WU-01's hardcoded `PlaceholderScreen`/`Stack.Navigator`
 * — `RootNavigator` now owns its own `NavigationContainer` and all
 * role-based routing (see its own class doc). `App.tsx` is left as just the
 * top-level providers a later story might add to (e.g. a TanStack Query
 * `QueryClientProvider`, if/when that gets introduced — see
 * `src/api/client.ts`'s "why not TanStack Query yet" note) plus the global
 * NativeWind stylesheet import and the status bar.
 *
 * `SafeAreaProvider` (the dependency was already installed, just unused
 * until now) is required for `useSafeAreaInsets()` — PRD §4 screen 4.1's
 * custom header (`HomeScreen.tsx`) draws its own header with
 * `headerShown: false`, so it needs the real status-bar inset itself
 * instead of relying on native-stack's default header to account for it.
 *
 * `LogBox.ignoreLogs` below suppresses exactly one warning: NativeWind's
 * `react-native-css-interop` runtime ("src/runtime/components.ts" in that
 * package) eagerly wraps a fixed list of core RN components for className
 * support —
 * including the deprecated `ImageBackground` — at import time, which fires
 * "ImageBackground is deprecated..." on every launch even though no screen
 * in this app renders one. Confirmed by grepping the whole dependency tree
 * for any JSX/import of `ImageBackground` outside `react-native`'s own
 * source — there is none in this app or its direct dependencies. Without
 * this, that single false-positive warning sits as a persistent LogBox
 * badge over every screen, which read as an unexplained ad-like overlay.
 * Narrowly scoped to this one message so every other warning still shows.
 */
LogBox.ignoreLogs(['ImageBackground is deprecated']);
export default function App() {
  // Location and camera, asked for as the app opens rather than at the
  // moment each one is first needed. Android has granted no dangerous
  // permission at install time since API 23, so this launch-time ask is as
  // close to "granted on install" as the platform allows; see
  // `src/lib/permissions.ts`. Fire-and-forget on purpose — the first screen
  // renders behind the system dialogs, and every caller re-checks anyway.
  useEffect(() => {
    void requestStartupPermissions();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <RootNavigator />
    </SafeAreaProvider>
  );
}
