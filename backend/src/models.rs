use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

// ─── User ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ─── Subscription & Entitlements ─────────────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Clone, sqlx::Type, Serialize, Deserialize, PartialEq)]
#[sqlx(type_name = "text", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum Plan {
    Free,
    Pro,
    FounderLifetime,
}

#[allow(dead_code)]
#[derive(Debug, Clone, FromRow)]
pub struct Subscription {
    pub id: Uuid,
    pub user_id: Uuid,
    pub plan: String,
    pub status: String,
    pub stripe_customer_id: Option<String>,
    pub stripe_subscription_id: Option<String>,
    /// "stripe" | "apple" | "google" — where the money came from. Entitlement
    /// resolution ignores this; it drives support and the manage-subscription
    /// link, which cannot use Stripe's portal for store purchases.
    pub payment_provider: Option<String>,
    pub store_transaction_id: Option<String>,
    pub store_product_id: Option<String>,
    pub current_period_end: Option<DateTime<Utc>>,
    pub trial_ends_at: Option<DateTime<Utc>>,
    pub cancelled_at: Option<DateTime<Utc>>,
    pub feature_overrides: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntitlementFeatures {
    pub sync: bool,
    pub dashboard: bool,
    pub multi_workspace: bool,
    pub calendar: bool,
    pub ai_summary: bool,
    pub history_unlimited: bool,
    pub api_integrations: bool,
    pub max_devices: i32,
    pub max_workspaces: i32,
    pub history_days: i32,
}

impl EntitlementFeatures {
    pub fn free() -> Self {
        Self {
            sync: false,
            dashboard: false,
            multi_workspace: false,
            calendar: false,
            ai_summary: false,
            history_unlimited: false,
            api_integrations: false,
            max_devices: 1,
            max_workspaces: 1,
            history_days: 30,
        }
    }

    pub fn pro() -> Self {
        Self {
            sync: true,
            dashboard: true,
            multi_workspace: true,
            calendar: true,
            ai_summary: false,
            history_unlimited: true,
            api_integrations: false,
            max_devices: 10,
            max_workspaces: 999,
            history_days: 9999,
        }
    }

    /// Resolves a plan string + optional per-user overrides straight into
    /// features, without needing a full `Subscription` row — callers that
    /// only fetched `plan`/`feature_overrides` (e.g. sync.rs's entitlement
    /// guards) can use this instead of constructing a fake `Subscription`.
    pub fn resolve(plan: &str, overrides: Option<&serde_json::Value>) -> Self {
        let base = match plan {
            "pro" | "founder_lifetime" => Self::pro(),
            _ => Self::free(),
        };
        match overrides {
            Some(o) => apply_overrides(base, o),
            None => base,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Entitlements {
    pub plan: String,
    pub features: EntitlementFeatures,
}

impl Entitlements {
    pub fn from_subscription(sub: &Subscription) -> Self {
        Self {
            plan: sub.plan.clone(),
            features: EntitlementFeatures::resolve(&sub.plan, sub.feature_overrides.as_ref()),
        }
    }
}

fn apply_overrides(
    mut features: EntitlementFeatures,
    overrides: &serde_json::Value,
) -> EntitlementFeatures {
    if let Some(v) = overrides.get("sync").and_then(|v| v.as_bool()) {
        features.sync = v;
    }
    if let Some(v) = overrides.get("dashboard").and_then(|v| v.as_bool()) {
        features.dashboard = v;
    }
    if let Some(v) = overrides.get("multi_workspace").and_then(|v| v.as_bool()) {
        features.multi_workspace = v;
    }
    if let Some(v) = overrides.get("calendar").and_then(|v| v.as_bool()) {
        features.calendar = v;
    }
    if let Some(v) = overrides.get("max_workspaces").and_then(|v| v.as_i64()) {
        features.max_workspaces = v as i32;
    }
    if let Some(v) = overrides.get("history_days").and_then(|v| v.as_i64()) {
        features.history_days = v as i32;
    }
    features
}

// ─── Workspace ────────────────────────────────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Workspace {
    pub id: Uuid,
    pub owner_id: Uuid,
    pub name: String,
    pub color: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}
