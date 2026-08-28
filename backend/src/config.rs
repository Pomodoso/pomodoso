use anyhow::{Context, Result};

#[derive(Clone, Debug)]
pub struct Config {
    // Required
    pub database_url: String,
    pub supabase_url: String,
    pub port: u16,
    pub frontend_url: String,

    // Optional — legacy HS256 fallback for local dev without JWKS
    pub supabase_jwt_secret: Option<String>,

    // Optional — billing won't work without these, but server starts fine
    pub stripe_secret_key: Option<String>,
    pub stripe_webhook_secret: Option<String>,
    pub stripe_pro_annual_price_id: Option<String>,
    pub stripe_pro_monthly_price_id: Option<String>,
    pub stripe_founder_lifetime_price_id: Option<String>,

    // Optional — store (App Store / Play) billing won't work without this
    pub revenuecat_webhook_secret: Option<String>,

    // Optional — emails won't send without this
    pub postmark_server_token: Option<String>,
    pub postmark_from_email: Option<String>,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let cfg = Self {
            database_url: required("DATABASE_URL")?,
            supabase_url: required("SUPABASE_URL")?,
            supabase_jwt_secret: std::env::var("SUPABASE_JWT_SECRET").ok(),
            port: std::env::var("PORT")
                .unwrap_or_else(|_| "8080".into())
                .parse()
                .context("PORT must be a number")?,
            frontend_url: std::env::var("FRONTEND_URL")
                .unwrap_or_else(|_| "http://localhost:5173".into()),

            stripe_secret_key: std::env::var("STRIPE_SECRET_KEY").ok(),
            stripe_webhook_secret: std::env::var("STRIPE_WEBHOOK_SECRET").ok(),
            stripe_pro_annual_price_id: std::env::var("STRIPE_PRO_ANNUAL_PRICE_ID").ok(),
            stripe_pro_monthly_price_id: std::env::var("STRIPE_PRO_MONTHLY_PRICE_ID").ok(),
            stripe_founder_lifetime_price_id: std::env::var("STRIPE_FOUNDER_LIFETIME_PRICE_ID")
                .ok(),

            // A blank value counts as unset — .env.example ships the key empty.
            revenuecat_webhook_secret: std::env::var("REVENUECAT_WEBHOOK_SECRET")
                .ok()
                .filter(|s| !s.is_empty()),

            // A blank value counts as unset, same as the RevenueCat secret above:
            // Railway keeps emptied variables rather than removing them, and an
            // empty token would send every request to Postmark to be rejected.
            postmark_server_token: std::env::var("POSTMARK_SERVER_TOKEN")
                .ok()
                .filter(|s| !s.is_empty()),
            postmark_from_email: std::env::var("POSTMARK_FROM_EMAIL")
                .ok()
                .filter(|s| !s.is_empty()),
        };

        if cfg.stripe_secret_key.is_none() {
            tracing::warn!("STRIPE_SECRET_KEY not set — billing endpoints will return 501");
        }
        if cfg.revenuecat_webhook_secret.is_none() {
            tracing::warn!("REVENUECAT_WEBHOOK_SECRET not set — store purchases will be rejected");
        }
        if cfg.postmark_server_token.is_none() {
            tracing::warn!("POSTMARK_SERVER_TOKEN not set — emails will not be sent");
        }

        Ok(cfg)
    }
}

fn required(key: &str) -> Result<String> {
    std::env::var(key).with_context(|| format!("missing required env var: {key}"))
}
