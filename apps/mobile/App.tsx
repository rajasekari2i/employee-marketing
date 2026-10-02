import './global.css';

import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { Text, View } from 'react-native';

/**
 * Placeholder root screen. The real role-based navigator
 * (apps/mobile/src/navigation/RootNavigator.tsx) is built by a later work
 * unit (WU-07) once a session/auth store exists — this stub only proves
 * React Navigation + NativeWind are wired up and the app boots.
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
    </View>
  );
}

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen
          name="Placeholder"
          component={PlaceholderScreen}
          options={{ title: 'Field Sales' }}
        />
      </Stack.Navigator>
      <StatusBar style="auto" />
    </NavigationContainer>
  );
}
