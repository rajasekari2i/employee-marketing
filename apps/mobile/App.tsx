import './global.css';

import { StatusBar } from 'react-native';

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
 */
export default function App() {
  return (
    <>
      <StatusBar barStyle="dark-content" />
      <RootNavigator />
    </>
  );
}
