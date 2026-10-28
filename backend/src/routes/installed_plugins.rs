//! The user's installed plugins (apps) and their records, as synced from their
//! devices, for the web dashboard. Read-only: the dashboard writes through
//! /sync/push like any device, so every client converges the same way.

use axum::{extract::State, Extension, Json};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

use crate::{error::Result, middleware::auth::AuthUser, AppState};

#[derive(Serialize)]
pub struct InstalledRecord {
    pub id: Uuid,
    pub collection: String,
    pub day: Option<NaiveDate>,
    pub occurred_at: Option<DateTime<Utc>>,
    pub data: Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct InstalledPlugin {
    pub id: Uuid,
    pub slug: String,
    pub source: String,
    pub manifest: Value,
    pub settings: Value,
    pub installed_on: NaiveDate,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub records: Vec<InstalledRecord>,
}

/// GET /plugins/installed: live installs, oldest first (the extension's order),
/// each with its live records.
pub async fn list(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Result<Json<Vec<InstalledPlugin>>> {
    let plugins = sqlx::query!(
        r#"SELECT id, slug, source, manifest, settings, installed_on, created_at, updated_at
           FROM plugin
           WHERE user_id = $1 AND deleted_at IS NULL AND enabled
           ORDER BY created_at"#,
        auth.id,
    )
    .fetch_all(&state.pool)
    .await?;
    let mut records = sqlx::query!(
        r#"SELECT id, plugin_id, collection, day, occurred_at, data, created_at, updated_at
           FROM plugin_record
           WHERE user_id = $1 AND deleted_at IS NULL
           ORDER BY created_at"#,
        auth.id,
    )
    .fetch_all(&state.pool)
    .await?;

    let out = plugins
        .into_iter()
        .map(|p| {
            let (mine, rest): (Vec<_>, Vec<_>) = std::mem::take(&mut records)
                .into_iter()
                .partition(|r| r.plugin_id == p.id);
            records = rest;
            InstalledPlugin {
                id: p.id,
                slug: p.slug,
                source: p.source,
                manifest: p.manifest,
                settings: p.settings,
                installed_on: p.installed_on,
                created_at: p.created_at,
                updated_at: p.updated_at,
                records: mine
                    .into_iter()
                    .map(|r| InstalledRecord {
                        id: r.id,
                        collection: r.collection,
                        day: r.day,
                        occurred_at: r.occurred_at,
                        data: r.data,
                        created_at: r.created_at,
                        updated_at: r.updated_at,
                    })
                    .collect(),
            }
        })
        .collect();
    Ok(Json(out))
}
