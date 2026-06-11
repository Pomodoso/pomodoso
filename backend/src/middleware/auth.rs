use axum::{
    extract::{Request, State},
    middleware::Next,
    response::Response,
};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use uuid::Uuid;

use crate::{error::AppError, AppState};

#[derive(Debug, Deserialize)]
struct SupabaseClaims {
    sub: String,
    email: Option<String>,
    #[serde(default)]
    user_metadata: UserMetadata,
}

#[derive(Debug, Deserialize, Default)]
struct UserMetadata {
    #[serde(default)]
    full_name: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    avatar_url: Option<String>,
    #[serde(default)]
    user_name: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AuthUser {
    pub id: Uuid,
    pub email: String,
    pub name: String,
    pub avatar_url: Option<String>,
}

pub async fn require_auth(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let path = req.uri().path().to_string();
    let token = extract_bearer(&req).ok_or_else(|| {
        tracing::warn!("auth: no Bearer token for {path}");
        AppError::Unauthorized
    })?;
    let header = decode_header(token).map_err(|_| AppError::Unauthorized)?;

    let claims = if let Some(kid) = &header.kid {
        // ES256 via JWKS (new Supabase)
        let jwk = state.jwks.find(kid).ok_or(AppError::Unauthorized)?;
        let key = DecodingKey::from_jwk(jwk).map_err(|_| AppError::Unauthorized)?;
        let mut validation = Validation::new(Algorithm::ES256);
        validation.set_audience(&["authenticated"]);
        decode::<SupabaseClaims>(token, &key, &validation)
            .map_err(|_| AppError::Unauthorized)?
            .claims
    } else if let Some(secret) = &state.config.supabase_jwt_secret {
        // HS256 fallback (legacy Supabase projects)
        let key = DecodingKey::from_secret(secret.as_bytes());
        let mut validation = Validation::new(Algorithm::HS256);
        validation.set_audience(&["authenticated"]);
        decode::<SupabaseClaims>(token, &key, &validation)
            .map_err(|_| AppError::Unauthorized)?
            .claims
    } else {
        return Err(AppError::Unauthorized);
    };

    let id = Uuid::parse_str(&claims.sub).map_err(|_| AppError::Unauthorized)?;
    let email = claims.email.unwrap_or_default();
    let name = claims
        .user_metadata
        .full_name
        .or(claims.user_metadata.name)
        .or(claims.user_metadata.user_name)
        .unwrap_or_else(|| email.split('@').next().unwrap_or("user").to_string());

    req.extensions_mut().insert(AuthUser {
        id,
        email,
        name,
        avatar_url: claims.user_metadata.avatar_url,
    });

    Ok(next.run(req).await)
}

fn extract_bearer(req: &Request) -> Option<&str> {
    req.headers()
        .get("authorization")?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
}
