// The public plugin directory: search, a plugin's page, its versions, and
// publishing. Browsing is public (the web directory works signed out);
// publishing, reporting and "my plugins" need an account.
//
// The server is the source of truth for what gets published: it validates
// every manifest against the plugin file's JSON Schema, generated from the
// same zod schema the clients use (backend/schema/plugin.v1.json, kept equal
// by a test in @pomodoso/types). Cross-references between collections,
// fields and $values are checked by every client again on install, so a file
// that passes here but references something missing can't be installed.

use std::sync::OnceLock;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::AuthUser,
    models::EntitlementFeatures,
    AppState,
};

/// The client's own file limit (PLUGIN_FILE_MAX_BYTES).
const MANIFEST_MAX_BYTES: usize = 256 * 1024;
const CHANGELOG_MAX_CHARS: usize = 2000;
const REPORT_MAX_CHARS: usize = 1000;
/// Publishing rate limit, per account.
const PUBLISHES_PER_HOUR: i64 = 10;
/// Reporting rate limit, per account.
const REPORTS_PER_DAY: i64 = 20;
const SEARCH_LIMIT_MAX: i64 = 50;

/// Slugs nobody can publish under: anything that could pass for an official
/// plugin or a built-in part of Pomodoso.
const RESERVED_SLUGS: &[&str] = &[
    "pomodoso",
    "official",
    "admin",
    "support",
    "today",
    "tasks",
    "habits",
    "schedule",
    "apps",
    "settings",
    "reports",
    "report",
    "timer",
    "pomodoro",
    "focus",
    "sync",
    "extension",
    "web",
    "mobile",
    "directory",
    "plugins",
    "plugin",
];

pub fn is_reserved_slug(slug: &str) -> bool {
    slug.starts_with("pomodoso-") || RESERVED_SLUGS.contains(&slug)
}

fn schema() -> &'static jsonschema::Validator {
    static VALIDATOR: OnceLock<jsonschema::Validator> = OnceLock::new();
    VALIDATOR.get_or_init(|| {
        let schema: Value = serde_json::from_str(include_str!("../../schema/plugin.v1.json"))
            .expect("embedded plugin schema is valid JSON");
        jsonschema::validator_for(&schema).expect("embedded plugin schema compiles")
    })
}

/// Why a manifest can't be published, as `path: message` lines (at most 10),
/// or empty when it validates.
pub fn manifest_issues(manifest: &Value) -> Vec<String> {
    let size = serde_json::to_vec(manifest)
        .map(|b| b.len())
        .unwrap_or(usize::MAX);
    if size > MANIFEST_MAX_BYTES {
        return vec![format!(
            "the file is {size} bytes; the limit is {MANIFEST_MAX_BYTES}"
        )];
    }
    schema()
        .iter_errors(manifest)
        .take(10)
        .map(|e| {
            let path = e.instance_path().to_string();
            if path.is_empty() {
                e.to_string()
            } else {
                format!("{path}: {e}")
            }
        })
        .collect()
}

/// `major.minor.patch`, as the schema guarantees.
fn semver(v: &str) -> Option<(u64, u64, u64)> {
    let mut parts = v.split('.').map(|p| p.parse::<u64>().ok());
    Some((parts.next()??, parts.next()??, parts.next()??))
}

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct ListingSummary {
    pub slug: String,
    pub name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub author: Option<String>,
    pub has_today: bool,
    pub latest_version: String,
    pub visibility: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct VersionInfo {
    pub version: String,
    pub change_kind: String,
    pub changelog: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct ListingPage {
    #[serde(flatten)]
    pub listing: ListingSummary,
    pub manifest: Value,
    pub versions: Vec<VersionInfo>,
}

#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
    /// Only plugins with a Today widget.
    pub today: Option<bool>,
    /// 'newest' (default) or 'name'.
    pub sort: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Deserialize)]
pub struct PublishBody {
    /// The plugin file, parsed (the client reads the YAML).
    pub manifest: Value,
    pub changelog: Option<String>,
    /// 'public' (default for a new listing) or 'private' (only its owner sees it).
    pub visibility: Option<String>,
    /// The publishing client's classification against the previous version:
    /// 'additive' or 'breaking'. Ignored for a first version.
    pub change_kind: Option<String>,
}

#[derive(Deserialize)]
pub struct ReportBody {
    pub reason: String,
}

// ─── Public ───────────────────────────────────────────────────────────────────

pub async fn search(
    State(state): State<AppState>,
    Query(q): Query<SearchQuery>,
) -> Result<Json<Vec<ListingSummary>>> {
    let term = q.q.unwrap_or_default().trim().to_lowercase();
    let pattern = format!(
        "%{}%",
        term.replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    );
    let by_name = q.sort.as_deref() == Some("name");
    let limit = q
        .limit
        .unwrap_or(SEARCH_LIMIT_MAX)
        .clamp(1, SEARCH_LIMIT_MAX);
    let rows = sqlx::query_as!(
        ListingSummary,
        r#"SELECT slug, name, description, icon, author, has_today, latest_version, visibility, updated_at
           FROM plugin_listing
           WHERE visibility = 'public' AND deleted_at IS NULL
             AND ($1 = '' OR lower(name) LIKE $2 OR lower(coalesce(description, '')) LIKE $2 OR slug LIKE $2)
             AND (NOT $3 OR has_today)
           ORDER BY CASE WHEN $4 THEN lower(name) END ASC, updated_at DESC
           LIMIT $5"#,
        term,
        pattern,
        q.today.unwrap_or(false),
        by_name,
        limit,
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

/// A listing that isn't taken down: public, or any of `owner`'s.
async fn open_listing(
    state: &AppState,
    slug: &str,
    owner: Option<Uuid>,
) -> Result<(Uuid, ListingSummary)> {
    let row = sqlx::query!(
        r#"SELECT id, slug, name, description, icon, author, has_today, latest_version, visibility, updated_at
           FROM plugin_listing
           WHERE slug = $1 AND deleted_at IS NULL
             AND (visibility = 'public' OR owner_user_id = $2)"#,
        slug,
        owner,
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok((
        row.id,
        ListingSummary {
            slug: row.slug,
            name: row.name,
            description: row.description,
            icon: row.icon,
            author: row.author,
            has_today: row.has_today,
            latest_version: row.latest_version,
            visibility: row.visibility,
            updated_at: row.updated_at,
        },
    ))
}

pub async fn get_listing(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<ListingPage>> {
    let (id, listing) = open_listing(&state, &slug, None).await?;
    listing_page(&state, id, listing).await
}

/// One of the user's own listings, private ones included, to install or update from.
pub async fn get_mine(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(slug): Path<String>,
) -> Result<Json<ListingPage>> {
    let (id, listing) = open_listing(&state, &slug, Some(auth.id)).await?;
    listing_page(&state, id, listing).await
}

async fn listing_page(
    state: &AppState,
    id: Uuid,
    listing: ListingSummary,
) -> Result<Json<ListingPage>> {
    let manifest = sqlx::query_scalar!(
        "SELECT manifest FROM plugin_version WHERE listing_id = $1 AND version = $2",
        id,
        listing.latest_version,
    )
    .fetch_one(&state.pool)
    .await?;
    let versions = sqlx::query_as!(
        VersionInfo,
        r#"SELECT version, change_kind, changelog, created_at
           FROM plugin_version WHERE listing_id = $1 ORDER BY created_at DESC"#,
        id,
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(ListingPage {
        listing,
        manifest,
        versions,
    }))
}

pub async fn get_version(
    State(state): State<AppState>,
    Path((slug, version)): Path<(String, String)>,
) -> Result<Json<Value>> {
    let (id, _) = open_listing(&state, &slug, None).await?;
    let manifest = sqlx::query_scalar!(
        "SELECT manifest FROM plugin_version WHERE listing_id = $1 AND version = $2",
        id,
        version,
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(Json(manifest))
}

// ─── Signed in ────────────────────────────────────────────────────────────────

pub async fn mine(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Result<Json<Vec<ListingSummary>>> {
    let rows = sqlx::query_as!(
        ListingSummary,
        r#"SELECT slug, name, description, icon, author, has_today, latest_version, visibility, updated_at
           FROM plugin_listing
           WHERE owner_user_id = $1 AND deleted_at IS NULL
           ORDER BY updated_at DESC"#,
        auth.id,
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

pub async fn publish(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<PublishBody>,
) -> Result<(StatusCode, Json<ListingSummary>)> {
    let issues = manifest_issues(&body.manifest);
    if !issues.is_empty() {
        return Err(AppError::BadRequest(format!(
            "the plugin file is invalid:\n{}",
            issues.join("\n")
        )));
    }
    let m = &body.manifest;
    // The schema guarantees these are present and well-formed.
    let slug = m["id"].as_str().unwrap_or_default().to_owned();
    let version = m["version"].as_str().unwrap_or_default().to_owned();
    let name = m["name"].as_str().unwrap_or_default().to_owned();
    let description = m["description"].as_str().map(str::to_owned);
    let icon = m["icon"].as_str().map(str::to_owned);
    let author = m["author"].as_str().map(str::to_owned);
    let has_today = m.get("today").is_some_and(|t| t.is_object());
    let Some(next) = semver(&version) else {
        return Err(AppError::BadRequest(format!(
            "version \"{version}\" is not major.minor.patch"
        )));
    };
    if is_reserved_slug(&slug) {
        return Err(AppError::BadRequest(format!(
            "\"{slug}\" is reserved; pick another id"
        )));
    }
    let visibility = match body.visibility.as_deref() {
        None => None,
        Some(v @ ("public" | "private")) => Some(v.to_owned()),
        Some(v) => {
            return Err(AppError::BadRequest(format!(
                "visibility \"{v}\" must be public or private"
            )))
        }
    };
    let changelog = body
        .changelog
        .map(|c| c.trim().to_owned())
        .filter(|c| !c.is_empty());
    if changelog
        .as_ref()
        .is_some_and(|c| c.chars().count() > CHANGELOG_MAX_CHARS)
    {
        return Err(AppError::BadRequest(format!(
            "the changelog is longer than {CHANGELOG_MAX_CHARS} characters"
        )));
    }

    let mut tx = state.pool.begin().await?;

    let recent = sqlx::query_scalar!(
        r#"SELECT count(*) AS "n!" FROM plugin_version v
           JOIN plugin_listing l ON l.id = v.listing_id
           WHERE l.owner_user_id = $1 AND v.created_at > NOW() - INTERVAL '1 hour'"#,
        auth.id,
    )
    .fetch_one(&mut *tx)
    .await?;
    if recent >= PUBLISHES_PER_HOUR {
        return Err(AppError::TooManyRequests(format!(
            "at most {PUBLISHES_PER_HOUR} versions an hour; try again later"
        )));
    }

    // Locked, so two publishes of one slug can't both pass the checks.
    let existing = sqlx::query!(
        "SELECT id, owner_user_id, latest_version, visibility FROM plugin_listing WHERE slug = $1 FOR UPDATE",
        slug,
    )
    .fetch_optional(&mut *tx)
    .await?;

    // Private listings are a paid feature. What counts is the visibility the
    // listing ends up with, so a lapsed subscriber can't keep publishing to a
    // private one either: they make it public or take it down.
    let effective = visibility
        .as_deref()
        .or(existing.as_ref().map(|r| r.visibility.as_str()))
        .unwrap_or("public");
    if effective == "private" {
        let sub = sqlx::query!(
            "SELECT plan, feature_overrides FROM subscription WHERE user_id = $1",
            auth.id,
        )
        .fetch_optional(&mut *tx)
        .await?;
        let allowed = sub.is_some_and(|s| {
            EntitlementFeatures::resolve(&s.plan, s.feature_overrides.as_ref()).private_plugins
        });
        if !allowed {
            return Err(AppError::ForbiddenBecause(
                "private apps need Pomodoso Pro; publish it as public".to_owned(),
            ));
        }
    }

    let (listing_id, change_kind) = match existing {
        None => {
            let id = sqlx::query_scalar!(
                r#"INSERT INTO plugin_listing (slug, owner_user_id, visibility, name, description, icon, author, has_today, latest_version)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id"#,
                slug,
                auth.id,
                visibility.clone().unwrap_or_else(|| "public".to_owned()),
                name,
                description,
                icon,
                author,
                has_today,
                version,
            )
            .fetch_one(&mut *tx)
            .await?;
            (id, "initial".to_owned())
        }
        Some(row) => {
            // An id belongs to its first publisher for good, taken down or not:
            // reusing it would push someone else's file to that app's users.
            if row.owner_user_id != auth.id {
                return Err(AppError::ForbiddenBecause(format!(
                    "the id \"{slug}\" belongs to another author's app; change `id` in the file to publish it as your own"
                )));
            }
            let prev = semver(&row.latest_version).unwrap_or((0, 0, 0));
            if next <= prev {
                return Err(AppError::BadRequest(format!(
                    "version must go up from {}",
                    row.latest_version
                )));
            }
            let kind = match body.change_kind.as_deref() {
                Some("breaking") => "breaking",
                Some("additive") | None => "additive",
                Some(k) => {
                    return Err(AppError::BadRequest(format!(
                        "change_kind \"{k}\" must be additive or breaking"
                    )))
                }
            };
            if kind == "breaking" {
                if next.0 <= prev.0 {
                    return Err(AppError::BadRequest(format!(
                        "breaking changes need a new major version: {}.0.0",
                        prev.0 + 1
                    )));
                }
                if m["migrate"]["from"].as_str() != Some(&format!("{}.x", prev.0)) {
                    return Err(AppError::BadRequest(format!(
                        "breaking changes need a migrate block from \"{}.x\"",
                        prev.0
                    )));
                }
            }
            sqlx::query!(
                r#"UPDATE plugin_listing SET
                     name = $2, description = $3, icon = $4, author = $5, has_today = $6,
                     latest_version = $7, visibility = COALESCE($8, visibility), deleted_at = NULL
                   WHERE id = $1"#,
                row.id,
                name,
                description,
                icon,
                author,
                has_today,
                version,
                visibility,
            )
            .execute(&mut *tx)
            .await?;
            (row.id, kind.to_owned())
        }
    };

    sqlx::query!(
        r#"INSERT INTO plugin_version (listing_id, version, manifest, changelog, change_kind)
           VALUES ($1, $2, $3, $4, $5)"#,
        listing_id,
        version,
        m,
        changelog,
        change_kind,
    )
    .execute(&mut *tx)
    .await?;

    let listing = sqlx::query_as!(
        ListingSummary,
        r#"SELECT slug, name, description, icon, author, has_today, latest_version, visibility, updated_at
           FROM plugin_listing WHERE id = $1"#,
        listing_id,
    )
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(listing)))
}

/// The owner takes a listing down. Its versions stay (installs keep working
/// from what they stored) and the slug stays theirs; publishing again revives it.
pub async fn take_down(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(slug): Path<String>,
) -> Result<StatusCode> {
    let done = sqlx::query!(
        "UPDATE plugin_listing SET deleted_at = NOW() WHERE slug = $1 AND owner_user_id = $2 AND deleted_at IS NULL",
        slug,
        auth.id,
    )
    .execute(&state.pool)
    .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn report(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(slug): Path<String>,
    Json(body): Json<ReportBody>,
) -> Result<StatusCode> {
    let reason = body.reason.trim().to_owned();
    if reason.is_empty() || reason.chars().count() > REPORT_MAX_CHARS {
        return Err(AppError::BadRequest(format!(
            "a report needs a reason of 1 to {REPORT_MAX_CHARS} characters"
        )));
    }
    let (listing_id, _) = open_listing(&state, &slug, None).await?;
    let recent = sqlx::query_scalar!(
        r#"SELECT count(*) AS "n!" FROM plugin_report
           WHERE reporter_user_id = $1 AND created_at > NOW() - INTERVAL '1 day'"#,
        auth.id,
    )
    .fetch_one(&state.pool)
    .await?;
    if recent >= REPORTS_PER_DAY {
        return Err(AppError::TooManyRequests(
            "too many reports today; try again tomorrow".into(),
        ));
    }
    // One open report per person per listing: reporting again adds nothing.
    sqlx::query!(
        r#"INSERT INTO plugin_report (listing_id, reporter_user_id, reason)
           SELECT $1, $2, $3
           WHERE NOT EXISTS (
             SELECT 1 FROM plugin_report
             WHERE listing_id = $1 AND reporter_user_id = $2 AND resolved_at IS NULL
           )"#,
        listing_id,
        auth.id,
        reason,
    )
    .execute(&state.pool)
    .await?;
    Ok(StatusCode::ACCEPTED)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The smallest valid plugin file, as the client sends it (parsed).
    fn water() -> Value {
        json!({
            "schema_version": 1,
            "id": "water",
            "name": "Water",
            "version": "1.0.0",
            "collections": [{ "key": "glass", "kind": "event", "fields": [{ "key": "ml", "type": "number", "optional": true }] }],
            "views": [{ "id": "main", "blocks": [{ "type": "counter-button", "label": "Drank one", "adds": "glass" }] }]
        })
    }

    #[test]
    fn a_valid_manifest_has_no_issues() {
        assert!(manifest_issues(&water()).is_empty());
    }

    #[test]
    fn schema_errors_name_the_path() {
        let mut m = water();
        m["views"][0]["blocks"][0]["type"] = json!("bord");
        let issues = manifest_issues(&m);
        assert!(!issues.is_empty());
        assert!(
            issues.iter().any(|i| i.starts_with("/views/0/blocks/0")),
            "{issues:?}"
        );
    }

    #[test]
    fn refinements_are_enforced_too() {
        let mut m = water();
        m["hooks"] = json!([{ "on": "day_end", "ask": "How was today?" }]);
        assert!(!manifest_issues(&m).is_empty());
    }

    #[test]
    fn oversized_files_are_rejected_before_validation() {
        let mut m = water();
        m["description"] = json!("x".repeat(MANIFEST_MAX_BYTES));
        assert!(manifest_issues(&m)[0].contains("limit"));
    }

    #[test]
    fn reserved_slugs() {
        assert!(is_reserved_slug("pomodoso-timer"));
        assert!(is_reserved_slug("today"));
        assert!(!is_reserved_slug("quit-smoking"));
    }

    #[test]
    fn versions_compare_numerically() {
        assert!(semver("1.10.0") > semver("1.9.3"));
        assert_eq!(semver("1.2"), None);
    }
}
