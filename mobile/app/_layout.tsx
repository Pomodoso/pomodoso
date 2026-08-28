import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import 'react-native-reanimated';

import { BrandSplash } from '@/components/BrandSplash';
import { SyncChoiceModal } from '@/components/SyncChoiceModal';
import { colors } from '@/constants/theme';
import { useSyncLifecycle } from '@/hooks/useSyncLifecycle';
import { observeSignIn, observeTransactions } from '@/utils/purchases';

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

  // Registered here rather than inside a screen because these arrive with no
  // UI open: a renewal months from now, an Ask to Buy a parent approves an
  // hour later, a purchase made on another device. No-ops when the native
  // module is absent, so a simulator or web build runs fine without it.
  useEffect(observeTransactions, []);

  // Same reason, plus one more: this layout mounts exactly once. `useAuth` is
  // a plain hook, so the same effect placed there ran once per mounted
  // consumer.
  useEffect(observeSignIn, []);

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
        {/* No "settings" screen is declared here. PR #86 moved settings.tsx
            into (tabs)/, which deleted the root route this used to configure
            — the sub-pages are flat routes (settings/account, settings/data,
            …), and expo-router warned on every render that no route named
            "settings" existed. Its presentation option had been applying to
            nothing since that move. */}
      </Stack>
      {/* Overlaid rather than rendered instead of the Stack, so the app is
          already mounted and settled behind it when it fades. */}
      {!introDone && <BrandSplash onDone={finishIntro} />}
      {/* Renders itself only when there's a decision outstanding. Mounted at
          the root because the cold-start sync can raise it before the user
          has navigated anywhere. */}
      <SyncChoiceModal />
    </View>
  );
}
