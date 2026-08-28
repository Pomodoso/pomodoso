import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

// Raw binding to the StoreKit 2 module in ios/PomodosoIapModule.swift.
//
// Nothing here talks to our backend or decides anything about entitlements —
// that lives in utils/purchases.ts. This file's only job is to give the native
// surface a type.

/** A product as the App Store describes it, already localised. */
export interface IapProduct {
  id: string;
  title: string;
  description: string;
  /** Formatted in the storefront's own currency, e.g. "$7.00" or "7,00 €". */
  price: string;
  /** Absent for the lifetime tier, which is not a subscription. */
  period?: 'day' | 'week' | 'month' | 'year' | 'unknown';
  periodCount?: number;
}

/** A purchase, with Apple's signature over it. */
export interface SignedTransaction {
  id: string;
  productId: string;
  /** The JWS the backend verifies. This is the only part that proves anything. */
  jws: string;
}

export type PurchaseStatus = 'purchased' | 'cancelled' | 'pending' | 'failed';

export interface PurchaseResult {
  status: PurchaseStatus;
  /** Present only when status is 'purchased'. */
  transaction?: SignedTransaction;
}

interface PomodosoIapModule {
  getProducts(ids: string[]): Promise<IapProduct[]>;
  purchase(productId: string, appAccountToken: string): Promise<PurchaseResult>;
  restore(): Promise<SignedTransaction[]>;
  currentEntitlements(): Promise<SignedTransaction[]>;
  finish(transactionId: string): Promise<void>;
  addListener(
    event: 'onTransaction',
    listener: (transaction: SignedTransaction) => void,
  ): EventSubscription;
}

// Optional rather than required: the module is iOS-only and absent on web, and
// a missing native module should leave purchasing unavailable rather than
// crash the app on launch.
const native = requireOptionalNativeModule<PomodosoIapModule>('PomodosoIap');

export function isAvailable(): boolean {
  return native !== null;
}

export async function getProducts(ids: string[]): Promise<IapProduct[]> {
  return native ? native.getProducts(ids) : [];
}

export async function purchase(
  productId: string,
  appAccountToken: string,
): Promise<PurchaseResult> {
  if (!native) return { status: 'failed' };
  return native.purchase(productId, appAccountToken);
}

/** Raises an App Store password prompt. Only for an explicit user action. */
export async function restore(): Promise<SignedTransaction[]> {
  return native ? native.restore() : [];
}

/** Silent. Safe on launch or after signing in. */
export async function currentEntitlements(): Promise<SignedTransaction[]> {
  return native ? native.currentEntitlements() : [];
}

/**
 * Tells StoreKit the purchase has been delivered.
 *
 * Call this only once the backend has accepted the transaction. Anything left
 * unfinished is handed back by Apple on the next launch, which is what turns a
 * dropped request into a retry instead of a customer who paid for nothing.
 */
export async function finish(transactionId: string): Promise<void> {
  await native?.finish(transactionId);
}

/** Renewals, Ask-to-Buy approvals, and purchases made on another device. */
export function addTransactionListener(
  listener: (transaction: SignedTransaction) => void,
): EventSubscription | null {
  return native ? native.addListener('onTransaction', listener) : null;
}
