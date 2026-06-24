// Thin GA4 wrapper. No-ops when GA isn't loaded (VITE_GA_ID unset), so call
// sites stay clean and nothing breaks in dev/preview.
//
// PRIVACY: never send PII (email, name) to GA — Google's terms forbid it and it
// can get the property suspended. We identify a logged-in user only by their
// opaque UUID via `user_id`, plus non-identifying user properties like `plan`.

type GaParams = Record<string, unknown>;

function ga(...args: unknown[]): void {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  window.gtag(...args);
}

/**
 * Track a custom dashboard action, e.g.
 *   trackEvent('report_opened')
 *   trackEvent('workspace_switched', { from: 'all', to: wsId })
 */
export function trackEvent(name: string, params?: GaParams): void {
  ga('event', name, params ?? {});
}

/**
 * Tie all subsequent events to the logged-in user (opaque UUID) and set
 * non-PII user properties (e.g. plan) so you can segment in GA.
 */
export function identifyUser(userId: string, props?: GaParams): void {
  ga('set', { user_id: userId });
  if (props) ga('set', 'user_properties', props);
}

/** Drop the identity on logout so events aren't attributed to the prior user. */
export function clearUser(): void {
  ga('set', { user_id: null });
}
