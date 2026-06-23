mod config;
mod db;
mod email;
mod error;
mod middleware;
mod models;
mod routes;

use axum::{
    middleware as axum_middleware,
    routing::{get, post},
    Router,
};
use jsonwebtoken::jwk::JwkSet;
use sqlx::PgPool;
use std::sync::Arc;
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use config::Config;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub config: Arc<Config>,
    pub http: reqwest::Client,
    pub jwks: Arc<JwkSet>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env in development
    let _ = dotenvy::dotenv();

    // Error reporting — only active when SENTRY_DSN is set. The guard must live
    // for the whole program, so keep it bound until main returns.
    let _sentry = std::env::var("SENTRY_DSN").ok().map(|dsn| {
        // Default 20% trace sampling; override with SENTRY_TRACES_SAMPLE_RATE.
        let traces_sample_rate = std::env::var("SENTRY_TRACES_SAMPLE_RATE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(0.2);
        sentry::init((
            dsn,
            sentry::ClientOptions {
                release: sentry::release_name!(),
                traces_sample_rate,
                enable_logs: true,
                ..Default::default()
            },
        ))
    });

    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with(tracing_subscriber::fmt::layer())
        // Forward `tracing::error!`/`warn!` to Sentry (no-op when SENTRY_DSN unset).
        .with(sentry::integrations::tracing::layer())
        .init();

    let config = Config::from_env()?;
    let pool = db::create_pool(&config.database_url).await?;

    // Run migrations
    sqlx::migrate!("./migrations").run(&pool).await?;
    tracing::info!("migrations applied");

    let http = reqwest::Client::new();
    let jwks = fetch_jwks(&http, &config.supabase_url).await?;
    tracing::info!("JWKS loaded ({} keys)", jwks.keys.len());

    let state = AppState {
        pool,
        config: Arc::new(config.clone()),
        http,
        jwks: Arc::new(jwks),
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let auth = axum_middleware::from_fn_with_state(state.clone(), middleware::auth::require_auth);

    let app = Router::new()
        // Public routes — no auth
        .route("/health", get(routes::health::health))
        .route("/webhooks/stripe", post(routes::billing::stripe_webhook))
        // Protected routes — auth applied per-route to avoid affecting public routes after merge
        .route("/me", get(routes::me::get_me).route_layer(auth.clone()))
        .route(
            "/me/entitlements",
            get(routes::me::get_entitlements).route_layer(auth.clone()),
        )
        .route(
            "/devices",
            get(routes::me::get_devices).route_layer(auth.clone()),
        )
        .route(
            "/sync/push",
            post(routes::sync::push).route_layer(auth.clone()),
        )
        .route(
            "/sync/pull",
            get(routes::sync::pull).route_layer(auth.clone()),
        )
        .route(
            "/workspaces",
            get(routes::today::get_workspaces).route_layer(auth.clone()),
        )
        .route(
            "/today",
            get(routes::today::get_today).route_layer(auth.clone()),
        )
        .route(
            "/billing/checkout",
            post(routes::billing::create_checkout).route_layer(auth.clone()),
        )
        .route(
            "/billing/portal",
            post(routes::billing::create_portal).route_layer(auth.clone()),
        )
        .with_state(state)
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    let addr = format!("0.0.0.0:{}", config.port);
    tracing::info!("listening on {addr}");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn fetch_jwks(http: &reqwest::Client, supabase_url: &str) -> anyhow::Result<JwkSet> {
    let url = format!("{}/auth/v1/.well-known/jwks.json", supabase_url);
    let jwks = http.get(&url).send().await?.json::<JwkSet>().await?;
    Ok(jwks)
}
