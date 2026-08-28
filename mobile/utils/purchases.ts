import Purchases, { LOG_LEVEL, type CustomerInfo, type PurchasesPackage } from 'react-native-purchases';

// RevenueCat sits between the App Store and our backend. The store tells
// RevenueCat about a purchase, RevenueCat webhooks /iap/webhook, and that
// writes the subscription row the entitlements resolve from.
//
// The app never decides who is Pro. It asks the store to complete a purchase
// and then re-reads entitlements from our own /me — because a client that
// grants itself access is a client that can be made to grant itself access.
// CustomerInfo is used only to know whether a purchase went through, never
// as the source of truth for what the user may do.

const API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;

/** RevenueCat's own identifier for the bundle of products we sell. Configured
 *  in their dashboard; the app asks for "the current offering" rather than
 *  naming products, so pricing and packaging can change without a release. */
export const OFFERING_ID = 'default';

let configured = false;

export function isPurchasesConfigured(): boolean {
  return Boolean(API_KEY);
}

/**
 * Starts the SDK. Safe to call more than once.
 *
 * Deliberately does not throw when the key is missing: a build without one
 * (a local dev build, or CI) should run with purchasing unavailable rather
 * than crash on launch. Callers check isPurchasesConfigured().
 */
export function configurePurchases(): void {
  if (configured || !API_KEY) return;
  Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.ERROR);
  Purchases.configure({ apiKey: API_KEY });
  configured = true;
}

/**
 * Ties store purchases to our account.
 *
 * The webhook rejects any event whose app_user_id isn't one of our UUIDs
 * (iap.rs's parse_event), so without this every purchase is invisible to the
 * backend. A purchase made before signing in carries RevenueCat's anonymous
 * id; logging in afterwards triggers a TRANSFER and re-fires the events under
 * the real id, which is why buying-then-signing-in still resolves.
 */
export async function identifyPurchaser(userId: string): Promise<void> {
  if (!configured) return;
  try {
    await Purchases.logIn(userId);
  } catch (err) {
    console.warn('[purchases] logIn failed', err);
  }
}

/** Detaches the account on sign-out, so a second user on the same device
 *  doesn't inherit the first one's purchases in the SDK's local cache. */
export async function forgetPurchaser(): Promise<void> {
  if (!configured) return;
  try {
    await Purchases.logOut();
  } catch (err) {
    console.warn('[purchases] logOut failed', err);
  }
}

/** The packages to show, straight from the store — localised titles and
 *  prices in the user's own currency. Hardcoding prices here would show the
 *  wrong ones to anyone outside the US and go stale on every price change. */
export async function loadPackages(): Promise<PurchasesPackage[]> {
  if (!configured) return [];
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current?.availablePackages ?? [];
  } catch (err) {
    console.warn('[purchases] getOfferings failed', err);
    return [];
  }
}

export type PurchaseOutcome = 'purchased' | 'cancelled' | 'failed';

/**
 * Runs the store's purchase sheet.
 *
 * A user cancelling is not an error and must not surface as one — it is the
 * most common outcome of opening a paywall, and an error alert for it reads
 * as a broken app.
 */
export async function buy(pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  try {
    await Purchases.purchasePackage(pkg);
    return 'purchased';
  } catch (err) {
    if ((err as { userCancelled?: boolean }).userCancelled) return 'cancelled';
    console.warn('[purchases] purchase failed', err);
    return 'failed';
  }
}

/**
 * Re-applies purchases already made with this Apple ID.
 *
 * Required by App Store review, not optional: an app that sells anything
 * without a restore path is rejected. It also covers the real cases —
 * reinstalling, a new device, or an account whose webhook never landed.
 */
export async function restore(): Promise<CustomerInfo | null> {
  if (!configured) return null;
  try {
    return await Purchases.restorePurchases();
  } catch (err) {
    console.warn('[purchases] restore failed', err);
    return null;
  }
}
