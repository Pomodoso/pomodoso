import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import type { IapProduct } from '@/modules/pomodoso-iap';
import { buy, isPurchasesConfigured, loadProducts, restorePurchases } from '@/utils/purchases';

// The in-app purchase sheet. Replaces the link to pomodoso.com/pricing that
// used to live here — App Store guideline 3.1.1 treats sending users out of
// the app to buy as anti-steering, and it is one of the most reliable ways to
// be rejected.
//
// Prices and titles come from the store, not from this file. Hardcoding them
// shows the wrong currency to anyone outside the US and goes stale the first
// time pricing changes; the store already knows both, localised.
//
// Only reachable with a session: ProUpsell sends signed-out users to /login
// instead, because a purchase has to attach to an account to mean anything.

function periodLabel(product: IapProduct): string {
  // No period at all is the case worth naming explicitly rather than leaving
  // blank — that's the lifetime tier, not a missing value.
  if (!product.period || product.period === 'unknown') return 'one payment, forever';

  const count = product.periodCount ?? 1;
  if (count !== 1) return `every ${count} ${product.period}s`;

  return product.period === 'year' ? 'per year' : `per ${product.period}`;
}

export function Paywall({ visible, onClose }: { visible: boolean; onClose: () => void }): React.JSX.Element | null {
  const auth = useAuth();
  const [products, setProducts] = useState<IapProduct[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setProducts(null);
    void loadProducts().then(setProducts);
  }, [visible]);

  // After a purchase the app asks the *backend* what the user may do, rather
  // than trusting what the purchase sheet returned. /iap/verify has already
  // written the subscription row by the time we get here, so /me reflects it
  // immediately — no "check back in a minute".
  async function settle(action: () => Promise<boolean>, successMessage: string): Promise<void> {
    const ok = await action();
    if (!ok) return;
    await auth.refreshEntitlements();
    Alert.alert('Thanks!', successMessage);
    onClose();
  }

  async function handleBuy(product: IapProduct): Promise<void> {
    const userId = auth.session?.user.id;
    const token = auth.session?.access_token;
    if (!userId || !token) return;

    setBusy(product.id);
    try {
      await settle(async () => {
        switch (await buy(product.id, userId, token)) {
          case 'purchased':
            return true;

          // Cancelling is the most common thing to do with a paywall open. An
          // error alert for it would read as a broken app.
          case 'cancelled':
            return false;

          // Ask to Buy, awaiting a parent's approval. Nothing is charged yet
          // and it may land hours from now, arriving through the transaction
          // listener with the app closed.
          case 'pending':
            Alert.alert(
              'Waiting for approval',
              'Your purchase needs to be approved. Pro unlocks as soon as it is.',
            );
            return false;

          // Apple took the payment but our backend has not confirmed it. The
          // transaction is deliberately left unfinished, so Apple hands it
          // back on the next launch and it resolves itself.
          case 'unverified':
            Alert.alert(
              'Almost there',
              'Your purchase went through and will unlock shortly. Reopen the app if it does not.',
            );
            return false;

          case 'failed':
            Alert.alert('Purchase failed', 'Nothing was charged. Please try again.');
            return false;
        }
      }, 'Pomodoso Pro is unlocked.');
    } finally {
      setBusy(null);
    }
  }

  async function handleRestore(): Promise<void> {
    const token = auth.session?.access_token;
    if (!token) return;

    setBusy('restore');
    try {
      await settle(async () => {
        if ((await restorePurchases(token)) === 0) {
          Alert.alert('Nothing to restore', 'No previous purchase was found for this Apple ID.');
          return false;
        }
        return true;
      }, 'Your purchase has been restored.');
    } finally {
      setBusy(null);
    }
  }

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Pomodoso Pro</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.textTertiary} />
            </Pressable>
          </View>

          <Text style={styles.benefits}>
            Sync across devices · Unlimited workspaces · Web dashboard · Full history
          </Text>

          <ScrollView style={styles.list} contentContainerStyle={{ gap: 10 }}>
            {products === null ? (
              <ActivityIndicator color={colors.accent} style={{ marginVertical: 24 }} />
            ) : products.length === 0 ? (
              // Reached when the store has nothing to sell here: products not
              // approved yet, or a build without the native module. Better to
              // say so than to show an empty box.
              <Text style={styles.empty}>
                {isPurchasesConfigured()
                  ? 'Plans are not available right now. Please try again later.'
                  : 'Purchases are unavailable in this build.'}
              </Text>
            ) : (
              products.map(product => (
                <Pressable
                  key={product.id}
                  style={[styles.plan, busy === product.id && styles.planBusy]}
                  onPress={() => void handleBuy(product)}
                  disabled={busy !== null}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planTitle}>{product.title}</Text>
                    <Text style={styles.planPeriod}>{periodLabel(product)}</Text>
                  </View>
                  {busy === product.id ? (
                    <ActivityIndicator color={colors.accent} />
                  ) : (
                    <Text style={styles.planPrice}>{product.price}</Text>
                  )}
                </Pressable>
              ))
            )}
          </ScrollView>

          {/* Required by App Store review, not optional: an app that sells
              anything without a restore path is rejected. It also covers the
              real cases — a reinstall, a new device, or a purchase whose
              delivery never landed. */}
          <Pressable style={styles.restore} onPress={() => void handleRestore()} disabled={busy !== null}>
            <Text style={styles.restoreText}>
              {busy === 'restore' ? 'Restoring…' : 'Restore purchases'}
            </Text>
          </Pressable>

          <Text style={styles.legal}>
            Payment is charged to your Apple ID. Subscriptions renew automatically unless cancelled at least 24
            hours before the period ends. Manage or cancel in your Apple ID settings.
          </Text>

          {/* Guideline 3.1.2 requires functional links to the Terms of Use and
              Privacy Policy on the purchase screen itself — not only on the
              website. Title, length and price are already above; these were the
              missing half, and their absence is a documented rejection reason. */}
          <View style={styles.legalLinks}>
            <Pressable onPress={() => void Linking.openURL('https://pomodoso.com/terms')} hitSlop={8}>
              <Text style={styles.legalLink}>Terms of Use</Text>
            </Pressable>
            <Text style={styles.legalSeparator}>·</Text>
            <Pressable onPress={() => void Linking.openURL('https://pomodoso.com/privacy')} hitSlop={8}>
              <Text style={styles.legalLink}>Privacy Policy</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(26,26,23,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 34,
    maxHeight: '85%',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 19, fontWeight: '700', color: colors.text },
  benefits: { fontSize: 12.5, lineHeight: 18, color: colors.textSecondary, marginTop: 6 },
  list: { marginTop: 16 },
  empty: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', paddingVertical: 24 },
  plan: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    backgroundColor: colors.surface,
  },
  planBusy: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  planTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  planPeriod: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  planPrice: { fontSize: 16, fontWeight: '700', color: colors.accent },
  restore: { alignItems: 'center', paddingVertical: 14 },
  restoreText: { fontSize: 13.5, fontWeight: '600', color: colors.textSecondary },
  legal: { fontSize: 10.5, lineHeight: 15, color: colors.textTertiary, textAlign: 'center' },
  legalLinks: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 8 },
  legalLink: { fontSize: 11, color: colors.textSecondary, textDecorationLine: 'underline' },
  legalSeparator: { fontSize: 11, color: colors.textTertiary },
});
