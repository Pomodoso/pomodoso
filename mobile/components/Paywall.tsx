import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';

import { colors } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { buy, isPurchasesConfigured, loadPackages, restore } from '@/utils/purchases';

// The in-app purchase sheet. Replaces the link to pomodoso.com/pricing that
// used to live here — App Store guideline 3.1.1 treats sending users out of
// the app to buy as anti-steering, and it is one of the most reliable ways
// to be rejected.
//
// Prices and titles come from the store, not from this file. Hardcoding them
// shows the wrong currency to anyone outside the US and goes stale the first
// time pricing changes; the store already knows both, localised.

function priceLabel(pkg: PurchasesPackage): string {
  return pkg.product.priceString;
}

function periodLabel(pkg: PurchasesPackage): string {
  // packageType is RevenueCat's normalisation of the store's subscription
  // period. A lifetime purchase has no period at all, which is the case
  // worth naming explicitly rather than leaving blank.
  switch (pkg.packageType) {
    case 'ANNUAL':
      return 'per year';
    case 'MONTHLY':
      return 'per month';
    case 'LIFETIME':
      return 'one payment, forever';
    default:
      return '';
  }
}

export function Paywall({ visible, onClose }: { visible: boolean; onClose: () => void }): React.JSX.Element | null {
  const auth = useAuth();
  const [packages, setPackages] = useState<PurchasesPackage[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setPackages(null);
    void loadPackages().then(setPackages);
  }, [visible]);

  // After a purchase the app asks the *backend* what the user may do, rather
  // than trusting what the purchase sheet returned. The store tells
  // RevenueCat, RevenueCat webhooks our backend, and /me is the only answer
  // that reflects the subscription row the entitlements resolve from.
  //
  // That round trip takes a moment, so a purchase can complete before the
  // webhook lands. Saying "unlocking…" is honest about that; claiming Pro
  // and then rendering Free would be worse.
  async function settle(action: () => Promise<boolean>, successMessage: string): Promise<void> {
    const ok = await action();
    if (!ok) return;
    await auth.refreshEntitlements();
    Alert.alert('Thanks!', successMessage);
    onClose();
  }

  async function handleBuy(pkg: PurchasesPackage): Promise<void> {
    setBusy(pkg.identifier);
    try {
      await settle(async () => {
        const outcome = await buy(pkg);
        // Cancelling is the most common thing to do with a paywall open. An
        // error alert for it would read as a broken app.
        if (outcome === 'cancelled') return false;
        if (outcome === 'failed') {
          Alert.alert('Purchase failed', 'Nothing was charged. Please try again.');
          return false;
        }
        return true;
      }, 'Pro is unlocking now. If it takes a moment, pull to refresh in a minute.');
    } finally {
      setBusy(null);
    }
  }

  async function handleRestore(): Promise<void> {
    setBusy('restore');
    try {
      await settle(async () => {
        const info = await restore();
        if (!info || Object.keys(info.entitlements.active).length === 0) {
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
            {packages === null ? (
              <ActivityIndicator color={colors.accent} style={{ marginVertical: 24 }} />
            ) : packages.length === 0 ? (
              // Reached when the store has nothing to sell here: products not
              // approved yet, or a build with no RevenueCat key. Better to say
              // so than to show an empty box.
              <Text style={styles.empty}>
                {isPurchasesConfigured()
                  ? 'Plans are not available right now. Please try again later.'
                  : 'Purchases are unavailable in this build.'}
              </Text>
            ) : (
              packages.map(pkg => (
                <Pressable
                  key={pkg.identifier}
                  style={[styles.plan, busy === pkg.identifier && styles.planBusy]}
                  onPress={() => void handleBuy(pkg)}
                  disabled={busy !== null}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planTitle}>{pkg.product.title}</Text>
                    <Text style={styles.planPeriod}>{periodLabel(pkg)}</Text>
                  </View>
                  {busy === pkg.identifier ? (
                    <ActivityIndicator color={colors.accent} />
                  ) : (
                    <Text style={styles.planPrice}>{priceLabel(pkg)}</Text>
                  )}
                </Pressable>
              ))
            )}
          </ScrollView>

          {/* Required by App Store review, not optional: an app that sells
              anything without a restore path is rejected. It also covers the
              real cases — a reinstall, a new device, or a webhook that never
              landed. */}
          <Pressable style={styles.restore} onPress={() => void handleRestore()} disabled={busy !== null}>
            <Text style={styles.restoreText}>
              {busy === 'restore' ? 'Restoring…' : 'Restore purchases'}
            </Text>
          </Pressable>

          <Text style={styles.legal}>
            Payment is charged to your Apple ID. Subscriptions renew automatically unless cancelled at least 24
            hours before the period ends. Manage or cancel in your Apple ID settings.
          </Text>
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
});
