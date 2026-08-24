import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import 'react-native-reanimated';

import { BrandSplash } from '@/components/BrandSplash';
import { colors } from '@/constants/theme';
import { useSyncLifecycle } from '@/hooks/useSyncLifecycle';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    'SpaceMono-Regular': require('../assets/fonts/SpaceMono-Regular.ttf'),
  });
  // The native splash can only be a static image. Once fonts are in we hand
  // over to BrandSplash, which animates the same mark from the same frame and
  // then lifts away — so the launch reads as one motion rather than a static
  // image blinking into a UI.
  const [introDone, setIntroDone] = useState(false);
  const finishIntro = useCallback(() => setIntroDone(true), []);

  useSyncLifecycle();

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="task/[id]" options={{ presentation: 'card' }} />
        <Stack.Screen name="settings" options={{ presentation: 'card' }} />
      </Stack>
      {/* Overlaid rather than rendered instead of the Stack, so the app is
          already mounted and settled behind it when it fades. */}
      {!introDone && <BrandSplash onDone={finishIntro} />}
    </View>
  );
}
