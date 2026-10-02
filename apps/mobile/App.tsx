import './global.css';

import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar, Text, View } from 'react-native';

import { COMPANY_CODE, COMPANY_NAME } from './src/config';

/**
 * Placeholder root screen. The real role-based navigator
 * (apps/mobile/src/navigation/RootNavigator.tsx) is built by a later work
 * unit (WU-07) once a session/auth store exists — this stub only proves
 * React Navigation + NativeWind + the per-company build config are wired up
 * and the app boots. The company line below is left visible (rather than
 * just logged) as a quick way to confirm which flavor an installed APK is.
 */
function PlaceholderScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-white">
      <Text className="text-lg font-semibold text-brand-700">
        Field Sales & Beat Execution
      </Text>
      <Text className="mt-2 text-sm text-gray-500">
        Mobile app scaffold ready.
      </Text>
      <Text className="mt-4 text-xs text-gray-400">
        {COMPANY_NAME} ({COMPANY_CODE})
      </Text>
    </View>
  );
}

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar barStyle="dark-content" />
      <Stack.Navigator>
        <Stack.Screen
          name="Placeholder"
          component={PlaceholderScreen}
          options={{ title: 'Field Sales' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
