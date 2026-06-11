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
}

#[derive(Debug, Clone, Serialize)]
pub struct Entitlements {
    pub plan: String,
    pub features: EntitlementFeatures,
}

impl Entitlements {
    pub fn from_subscription(sub: &Subscription) -> Self {
        let base = match sub.plan.as_str() {
            "pro" | "founder_lifetime" => EntitlementFeatures::pro(),
            _ => EntitlementFeatures::free(),
        };

        // Apply per-user feature_overrides (for dev/testing)
        let features = if let Some(overrides) = &sub.feature_overrides {
            apply_overrides(base, overrides)
        } else {
            base
        };

        Self {
            plan: sub.plan.clone(),
            features,
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
