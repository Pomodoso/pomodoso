import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';

// One place that explains a locked feature and offers the next step, so
// every gate in the app leads somewhere instead of stating a fact and
// stopping. The Workspaces screen used to render "Multiple workspaces
// require Pro" beside a Pro badge with nothing to tap.
//
// The next step depends on where the user actually is, and there are two
// different walls:
//
//   signed out  → there is no account to attach a plan to yet. Asking for
//                 money here skips a step; the ask is to create an account.
//   Free        → the ask is to upgrade.
//
// Pro users never see this — callers render it only when the feature is
// locked, so it deliberately has no third state.

const PRICING_URL = 'https://pomodoso.com/pricing';

export function ProUpsell({ title, benefit }: { title: string; benefit: string }): React.JSX.Element {
  const auth = useAuth();
  const signedIn = Boolean(auth.session);

  function openPricing(): void {
    // Opens the web pricing page, matching what Account & Sync already does.
    // This is the surface ADR 0003's native IAP paywall replaces: App Store
    // guideline 3.1.1 treats sending users out to buy as anti-steering, so
    // this cannot ship to the App Store as-is. Kept identical to the
    // existing behaviour rather than adding a second variant of it, so
    // there's one thing to swap when the products exist.
    void WebBrowser.openBrowserAsync(PRICING_URL).catch(() => {
      Alert.alert('Could not open pricing page', 'Please try again later.');
    });
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Ionicons name="sparkles-outline" size={15} color={colors.accent} />
        <Text style={styles.title}>{title}</Text>
      </View>
      <Text style={styles.benefit}>{benefit}</Text>

      {signedIn ? (
        <Pressable style={styles.cta} onPress={openPricing}>
          <Text style={styles.ctaText}>Upgrade to Pro →</Text>
        </Pressable>
      ) : (
        <>
          <Pressable style={styles.cta} onPress={() => router.push('/login')}>
            <Ionicons name="person-add-outline" size={15} color={colors.surface} />
            <Text style={styles.ctaText}>Create a free account</Text>
          </Pressable>
          {/* Said plainly because the app is genuinely useful signed out, and
              implying otherwise would be a lie the first offline session
              exposes. */}
          <Text style={styles.footnote}>
            Everything you already have keeps working offline on this device.
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.accentSoft,
    padding: 14,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 14, fontWeight: '700', color: colors.text },
  benefit: { fontSize: 12, lineHeight: 17, color: colors.textSecondary, marginTop: 4 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  ctaText: { fontSize: 13, fontWeight: '600', color: colors.surface },
  footnote: { fontSize: 11, lineHeight: 15, color: colors.textTertiary, marginTop: 8, textAlign: 'center' },
});
