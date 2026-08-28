import { TokenApiClient } from '@pomodoso/api';

import { API_URL, getMobileSupabase, isAuthConfigured } from '@/lib/supabase';
import * as iap from '@/modules/pomodoso-iap';
import type { IapProduct, SignedTransaction } from '@/modules/pomodoso-iap';

// Purchases go straight to StoreKit, and the proof goes straight to our
// backend. There is no billing service in between.
//
// The app never decides who is Pro. StoreKit hands it a transaction signed by
// Apple; the backend verifies that signature against Apple's root certificate
// and writes the subscription row the entitlements resolve from. What the
// purchase sheet returned is only ever used to know whether to ask.
//
// The ordering below is load-bearing: a transaction is finished only *after*
// the backend accepts it. Anything left unfinished is handed back by Apple on
// the next launch, so a dropped request or a crash mid-purchase becomes a
// retry rather than someone who paid and got nothing.

/** Our products, in the order the paywall shows them. */
export const PRODUCT_IDS = [
  'com.pomodoso.app.pro.monthly',
  'com.pomodoso.app.pro.annual',
  'com.pomodoso.app.founder.lifetime',
] as const;

export type PurchaseOutcome =
  | 'purchased'
  /** The most common outcome of opening a paywall. Not an error. */
  | 'cancelled'
  /** Ask to Buy, or a payment method needing action. May land hours later. */
  | 'pending'
  /** Charged, but the backend hasn't confirmed it yet. Apple will re-deliver. */
  | 'unverified'
  | 'failed';

export function isPurchasesConfigured(): boolean {
  return iap.isAvailable() && Boolean(API_URL);
}

/**
 * The products to show, straight from the App Store — localised titles and
 * prices in the user's own currency.
 *
 * StoreKit returns them in arbitrary order, so they are re-sorted into
 * PRODUCT_IDS order here. Anything the store doesn't return (not yet approved,
 * unavailable in this storefront) simply doesn't appear.
 */
export async function loadProducts(): Promise<IapProduct[]> {
  try {
    const products = await iap.getProducts([...PRODUCT_IDS]);
    return [...products].sort(
      (a, b) => productRank(a.id) - productRank(b.id),
    );
  } catch (err) {
    console.warn('[purchases] getProducts failed', err);
    return [];
  }
}

function productRank(id: string): number {
  const index = PRODUCT_IDS.indexOf(id as (typeof PRODUCT_IDS)[number]);
  return index === -1 ? PRODUCT_IDS.length : index;
}

/**
 * Runs the store's purchase sheet and reports the result to the backend.
 *
 * `userId` becomes the transaction's `appAccountToken`, which Apple then
 * carries inside every signed payload about this purchase for as long as it
 * exists — including the renewal notifications that arrive years later, with
 * the app long since closed. It is the only thing tying an Apple ID to one of
 * our accounts, so a purchase made without it is invisible to the backend.
 */
export async function buy(
  productId: string,
  userId: string,
  accessToken: string,
): Promise<PurchaseOutcome> {
  let result;
  try {
    result = await iap.purchase(productId, userId);
  } catch (err) {
    console.warn('[purchases] purchase failed', err);
    return 'failed';
  }

  if (result.status !== 'purchased' || !result.transaction) {
    return result.status;
  }

  return (await deliver(result.transaction, accessToken)) ? 'purchased' : 'unverified';
}

/**
 * Re-applies purchases already made with this Apple ID.
 *
 * Required by App Store review, not optional: an app that sells anything
 * without a restore path is rejected. It also covers the real cases —
 * reinstalling, a new device, or a purchase whose delivery never landed.
 *
 * Returns how many the backend accepted, which is what tells the UI apart from
 * "nothing to restore".
 */
export async function restorePurchases(accessToken: string): Promise<number> {
  let transactions: SignedTransaction[];
  try {
    transactions = await iap.restore();
  } catch (err) {
    console.warn('[purchases] restore failed', err);
    return 0;
  }

  const applied = await Promise.all(transactions.map(tx => deliver(tx, accessToken)));
  return applied.filter(Boolean).length;
}

/**
 * Picks up anything Apple is still holding: a purchase whose delivery failed
 * last run, or one made on another device.
 *
 * Silent — no password prompt — so it is safe to call on launch and whenever a
 * session appears.
 */
export async function drainPendingTransactions(accessToken: string): Promise<void> {
  try {
    for (const tx of await iap.currentEntitlements()) {
      await deliver(tx, accessToken);
    }
  } catch (err) {
    console.warn('[purchases] draining pending transactions failed', err);
  }
}

/**
 * Watches for transactions that arrive outside a purchase call — renewals, an
 * Ask to Buy approved an hour later, a purchase made on another device.
 *
 * The token is read when the event fires rather than captured here: these
 * arrive minutes to months after registration, by which time a token captured
 * at startup would be long expired.
 *
 * Returns an unsubscribe function.
 */
export function observeTransactions(): () => void {
  const subscription = iap.addTransactionListener(tx => {
    void (async () => {
      const token = await currentAccessToken();
      // Nothing to do while signed out. The transaction stays unfinished, so
      // Apple offers it again once there is a session to attach it to.
      if (!token) return;
      await deliver(tx, token);
    })();
  });

  return () => subscription?.remove();
}

/**
 * Sends one transaction to the backend and, only if it is accepted, tells
 * StoreKit it has been delivered.
 *
 * Returning false without finishing is the whole point: an unfinished
 * transaction is Apple's own retry queue, and it costs nothing to leave one
 * there. Finishing on failure would throw the receipt away.
 */
async function deliver(tx: SignedTransaction, accessToken: string): Promise<boolean> {
  if (!API_URL) return false;

  try {
    await new TokenApiClient(API_URL, accessToken).post('/iap/verify', {
      signed_transaction: tx.jws,
    });
  } catch (err) {
    console.warn('[purchases] backend did not accept transaction', err);
    return false;
  }

  await iap.finish(tx.id);
  return true;
}

async function currentAccessToken(): Promise<string | null> {
  if (!isAuthConfigured()) return null;
  const { data } = await getMobileSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}
