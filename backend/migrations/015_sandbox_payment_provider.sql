-- Allow 'apple_sandbox' as a payment provider.
--
-- Migration 013 pinned the check to ('stripe', 'apple', 'google'). PR #124
-- then started recording sandbox purchases under their own provider so they
-- stay distinguishable from revenue — and every one of those writes failed:
--
--   new row for relation "subscription" violates check constraint
--   "subscription_payment_provider_check"
--
-- The damage was quiet in the worst way. `apply_update` returns the sqlx error
-- up through `?`, so the purchase 500s and the plan is never written: the user
-- pays, StoreKit reports success, and the app never unlocks. It also blocked
-- fixing the affected rows by hand, which looked like the admin UI dropping
-- the edit rather than the database refusing the value.

ALTER TABLE subscription
  DROP CONSTRAINT IF EXISTS subscription_payment_provider_check;

ALTER TABLE subscription
  ADD CONSTRAINT subscription_payment_provider_check
  CHECK (
    payment_provider IS NULL
    OR payment_provider IN ('stripe', 'apple', 'apple_sandbox', 'google')
  );

-- One row was stamped 'apple' by a sandbox purchase made on 2026-08-28, before
-- the two providers were told apart. It has to be corrected or that account can
-- never buy again: should_apply() refuses to let a sandbox purchase overwrite a
-- row it believes somebody paid for.
--
-- Named explicitly rather than matched by `payment_provider = 'apple'`. The
-- blanket predicate is accurate today only because the app has never shipped,
-- so no production purchase exists yet — and a migration that would silently
-- downgrade real subscriptions if that assumption ever changed is not worth
-- the brevity.
UPDATE subscription
   SET payment_provider = 'apple_sandbox'
 WHERE user_id = '50b4c796-dd59-44dd-a4e6-44c975374b3c'
   AND payment_provider = 'apple';
