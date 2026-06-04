import type { ApiClient } from './client.ts';

export type PriceOption = 'annual' | 'monthly' | 'lifetime';

export interface CheckoutOptions {
  price: PriceOption;
  successUrl: string;
  cancelUrl: string;
}

export async function createCheckoutSession(
  client: ApiClient,
  options: CheckoutOptions,
): Promise<string> {
  const { url } = await client.post<{ url: string }>('/billing/checkout', {
    price: options.price,
    success_url: options.successUrl,
    cancel_url: options.cancelUrl,
  });
  return url;
}

export async function createPortalSession(
  client: ApiClient,
  returnUrl: string,
): Promise<string> {
  const { url } = await client.post<{ url: string }>('/billing/portal', {
    return_url: returnUrl,
  });
  return url;
}
