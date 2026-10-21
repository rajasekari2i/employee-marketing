import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ManagerBottomNav } from '../../components/ManagerBottomNav';
import type { ManagerStackParamList } from '../../navigation/RootNavigator';
import { tabFromParams, VisitsListView } from './visitsListShared';

/**
 * PRD §4 screen 3.3 ("Visits · list + filters"), board uuid
 * `d71d2e67-7b3b-479c-b242-96da6f4965de` (010-manager-app).
 *
 * The list itself lives in `./visitsListShared` — 011-admin-visits found
 * that board 4.2 is this same screen with a different subtitle and a
 * different bottom bar, so this file is now just the manager's half of that
 * pair. Behaviour, including the tab-decides-the-detail-screen rule
 * (FR-029), is unchanged and documented there.
 */
export function ManagerVisitsScreen() {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<
      NativeStackNavigationProp<ManagerStackParamList, 'ManagerVisits'>
    >();
  const route = useRoute<RouteProp<ManagerStackParamList, 'ManagerVisits'>>();

  return (
    <VisitsListView
      bottomNav={
        <ManagerBottomNav
          active="Visits"
          bottomInset={insets.bottom}
          onAttendancePress={() => navigation.navigate('AttendanceDay')}
          onReportsPress={() => navigation.navigate('PreviousDayReport')}
          onVisitsPress={() => undefined}
        />
      }
      initialTab={tabFromParams(route.params)}
      onOpenVisit={(target, visitId) =>
        navigation.navigate(target, { visitId })
      }
      subtitle="Visit history · all executives"
    />
  );
}
