//! Talking to the App Store directly, with no billing intermediary.
//!
//! Two things arrive from Apple, and both are JWS signed by the same chain:
//! server notifications (subscription lifecycle), and the transactions
//! StoreKit hands the app after a purchase or a restore. `jws` verifies them;
//! the types here describe what is inside once it is trustworthy.

pub mod jws;

use chrono::{DateTime, Utc};
use serde::Deserialize;

/// Our app. Checked on every payload: a signature from Apple proves the App
/// Store issued it, not that it was issued for *us* — without this, a
/// transaction from any other Apple developer's app would verify.
pub const BUNDLE_ID: &str = "com.pomodoso.app";

/// The outer payload of an App Store Server Notification V2.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    pub notification_type: String,
    #[serde(default)]
    pub subtype: Option<String>,
    #[serde(rename = "notificationUUID", default)]
    pub notification_uuid: Option<String>,
    #[serde(default)]
    pub data: Option<NotificationData>,
}

/// The envelope also repeats `bundleId` and `environment`, but they are not
/// read here: the transaction inside carries both, and that is the payload the
/// grant is derived from. Checking the outer copy would mean checking a field
/// that no decision depends on.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationData {
    /// A nested JWS that must be verified in its own right.
    #[serde(default)]
    pub signed_transaction_info: Option<String>,
}

/// A decoded `JWSTransaction`. The same shape reaches us two ways: nested in a
/// notification, and posted by the app after a purchase.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transaction {
    #[serde(default)]
    pub transaction_id: Option<String>,
    #[serde(default)]
    pub original_transaction_id: Option<String>,
    #[serde(default)]
    pub bundle_id: Option<String>,
    pub product_id: String,
    /// Milliseconds. Absent for non-consumables — the lifetime tier never ends.
    #[serde(default)]
    pub expires_date: Option<i64>,
    /// The UUID the app passed at purchase time: our `user.id`. This is what
    /// ties an anonymous store transaction to an account, and it is inside the
    /// signed payload, so Apple vouches for it having been set — though not
    /// for *whose* id it is. See `iap::verify_transaction`.
    #[serde(default)]
    pub app_account_token: Option<String>,
    /// Set once a purchase has been refunded or revoked. Any transaction
    /// carrying it grants nothing, whatever else it says.
    #[serde(default)]
    pub revocation_date: Option<i64>,
    #[serde(default)]
    pub environment: Option<String>,
}

/// Which App Store issued a payload. Sandbox transactions cost nothing, so
/// accepting one in production is handing out Pro for free.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Environment {
    Production,
    Sandbox,
}

impl Environment {
    pub fn parse(s: Option<&str>) -> Option<Self> {
        match s {
            Some("Production") => Some(Self::Production),
            Some("Sandbox") => Some(Self::Sandbox),
            _ => None,
        }
    }
}

impl Transaction {
    pub fn expires_at(&self) -> Option<DateTime<Utc>> {
        self.expires_date.and_then(DateTime::from_timestamp_millis)
    }

    pub fn is_revoked(&self) -> bool {
        self.revocation_date.is_some()
    }

    /// Renewals mint a fresh `transactionId`; only the original is stable for
    /// the life of a subscription, so that is what we store.
    pub fn stable_id(&self) -> Option<String> {
        self.original_transaction_id
            .clone()
            .or_else(|| self.transaction_id.clone())
    }
}
