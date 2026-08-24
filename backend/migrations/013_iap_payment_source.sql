-- IAP (App Store / Play Store) as a second payment source alongside Stripe.
-- `plan` and `status` stay provider-independent so entitlement resolution
-- (models.rs `EntitlementFeatures::resolve`) never needs to know where the
-- money came from.

ALTER TABLE subscription
  ADD COLUMN IF NOT EXISTS payment_provider     TEXT,
  ADD COLUMN IF NOT EXISTS store_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS store_product_id     TEXT;

-- Every paying row that exists today came from Stripe.
UPDATE subscription
   SET payment_provider = 'stripe'
 WHERE payment_provider IS NULL
   AND stripe_customer_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscription_payment_provider_check'
  ) THEN
    ALTER TABLE subscription
      ADD CONSTRAINT subscription_payment_provider_check
      CHECK (payment_provider IS NULL OR payment_provider IN ('stripe', 'apple', 'google'));
  END IF;
END
$$;

-- Store-side subscription identity (Apple original_transaction_id / Play
-- purchase token), the IAP analogue of stripe_subscription_id.
CREATE UNIQUE INDEX IF NOT EXISTS subscription_store_transaction_idx
  ON subscription(store_transaction_id)
  WHERE store_transaction_id IS NOT NULL;
