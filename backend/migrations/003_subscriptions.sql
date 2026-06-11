CREATE TABLE IF NOT EXISTS subscription (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID        NOT NULL UNIQUE REFERENCES "user"(id) ON DELETE CASCADE,
  plan                    TEXT        NOT NULL DEFAULT 'free'
                            CHECK (plan IN ('free', 'pro', 'founder_lifetime')),
  status                  TEXT        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'trialing', 'cancelled', 'past_due')),
  stripe_customer_id      TEXT        UNIQUE,
  stripe_subscription_id  TEXT        UNIQUE,
  current_period_end      TIMESTAMPTZ,
  trial_ends_at           TIMESTAMPTZ,
  cancelled_at            TIMESTAMPTZ,
  feature_overrides       JSONB,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS subscription_user_idx ON subscription(user_id);
CREATE INDEX IF NOT EXISTS subscription_stripe_customer_idx ON subscription(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
