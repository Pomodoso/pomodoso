import { router, Stack } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { colors } from '@/constants/theme';

// pomodoso://auth-callback#access_token=… — the link auth emails and Google
// sign-in come back through. useAuth's applySessionFromUrl reads the tokens
// from the same URL and navigates on its own (home, or /reset-password for a
// recovery link). Without a route here expo-router showed "This screen
// doesn't exist" while that happened.
//
// The timeout is only a way out if the link carried nothing usable (expired,
// already used), so nobody is left on a spinner.
export default function AuthCallbackScreen(): React.JSX.Element {
  useEffect(() => {
    const timer = setTimeout(() => router.replace('/'), 6000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
        <ActivityIndicator color={colors.textTertiary} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
});
