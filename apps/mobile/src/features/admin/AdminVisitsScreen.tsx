import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AdminBottomNav } from '../../components/AdminBottomNav';
import { tabFromParams, VisitsListView } from '../manager/visitsListShared';
import type { AdminStackParamList } from '../../navigation/RootNavigator';

/**
 * PRD §4 screen 4.2 ("Visits · list + filters"), board uuid
 * `20fa5087-251b-4027-95b3-f781a0f2ed84` (011-admin-visits).
 *
 * Until this slice the Visits item in `AdminBottomNav` raised the "coming in
 * a later update" alert — the bar had no `onVisitsPress` prop at all, the
 * admin stack had no route to send it to, and `GET /visits` was
 * `@Roles('MANAGER')`. This is that gap.
 *
 * The list is `../manager/visitsListShared`, shared verbatim with board 3.3
 * because the decoded boards are the same markup apart from the two props
 * passed below. Importing it from the manager folder is deliberate: a copy
 * here would be a second place for board 4.2 to drift from 3.3, which is
 * exactly what the design-fidelity rule in CLAUDE.md forbids.
 */
export function AdminVisitsScreen() {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<
      NativeStackNavigationProp<AdminStackParamList, 'AdminVisits'>
    >();
  const route = useRoute<RouteProp<AdminStackParamList, 'AdminVisits'>>();

  return (
    <VisitsListView
      bottomNav={
        <AdminBottomNav
          active="Visits"
          bottomInset={insets.bottom}
          onBeatsPress={() => navigation.navigate('BeatPlansList')}
          onHomePress={() => navigation.navigate('Home')}
          onShopsPress={() => navigation.navigate('ShopsList')}
          onVisitsPress={() => undefined}
        />
      }
      initialTab={tabFromParams(route.params)}
      onOpenVisit={(target, visitId) =>
        navigation.navigate(target, { visitId })
      }
      subtitle="Company-wide visit history"
    />
  );
}
