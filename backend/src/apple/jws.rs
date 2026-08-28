//! Verification of the JWS payloads Apple signs.
//!
//! Everything the App Store tells us — server notifications, and the
//! transactions StoreKit hands the app — arrives as a JWS whose header carries
//! the certificate chain that signed it. Trusting one means three checks, and
//! skipping any single one makes the other two decorative:
//!
//! 1. the chain terminates at Apple's root, pinned in this binary — otherwise
//!    a well-formed chain from any public CA would do;
//! 2. each certificate actually signed the one below it, and none has expired;
//! 3. the payload's own signature verifies under the leaf's public key —
//!    otherwise the chain is genuine but the body is attacker-chosen.
//!
//! This is the whole of our answer to "is this purchase real". There is no
//! billing service to ask, so if this is wrong, nothing else catches it.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::de::DeserializeOwned;
use x509_parser::prelude::*;

/// Apple Root CA - G3, from <https://www.apple.com/certificateauthority/>.
///
/// SHA-256 `63343abf b89a6a03 ebb57e9b 3f5fa7be 7c4f5c75 6f3017b3 a8c488c3 653e9179`,
/// matching Apple's published fingerprint. P-384, valid until 2039.
///
/// Pinned rather than read from the system trust store on purpose: the system
/// store answers "is this a valid certificate", and we need "is this Apple".
const APPLE_ROOT_CA_G3: &[u8] = include_bytes!("AppleRootCA-G3.cer");

/// Apple signs with ES256 and has no reason to change without notice. Naming
/// the one algorithm we accept closes the family of attacks where the token
/// picks its own verification scheme.
const EXPECTED_ALG: &str = "ES256";

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum JwsError {
    #[error("malformed JWS: {0}")]
    Malformed(&'static str),
    #[error("unexpected algorithm {0:?}, want ES256")]
    UnexpectedAlgorithm(String),
    #[error("certificate chain does not terminate at Apple's root")]
    UntrustedRoot,
    #[error("certificate chain is not internally consistent")]
    BrokenChain,
    #[error("a certificate in the chain is expired or not yet valid")]
    CertificateNotValid,
    #[error("signature does not verify")]
    BadSignature,
    #[error("payload is not the expected shape: {0}")]
    BadPayload(String),
}

#[derive(serde::Deserialize)]
struct JwsHeader {
    alg: String,
    /// leaf, intermediate, root — in that order, standard base64 (not URL-safe).
    x5c: Vec<String>,
}

/// Verifies a JWS from Apple and returns its decoded payload.
pub fn verify<T: DeserializeOwned>(jws: &str) -> Result<T, JwsError> {
    verify_against_root(jws, APPLE_ROOT_CA_G3)
}

/// The real implementation, with the trust anchor as a parameter so tests can
/// drive it with a chain they mint themselves. Production always passes
/// Apple's root.
fn verify_against_root<T: DeserializeOwned>(jws: &str, root_der: &[u8]) -> Result<T, JwsError> {
    // The signature segment is matched but not bound: jsonwebtoken reads it
    // off the original token below. Checking the shape here is still worth it —
    // it is what rejects a two-part `alg: none` token before anything else runs.
    let mut parts = jws.split('.');
    let (Some(header_b64), Some(payload_b64), Some(_), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(JwsError::Malformed("expected three dot-separated parts"));
    };

    let header: JwsHeader = serde_json::from_slice(&b64url(header_b64)?)
        .map_err(|_| JwsError::Malformed("header is not JSON"))?;

    if header.alg != EXPECTED_ALG {
        return Err(JwsError::UnexpectedAlgorithm(header.alg));
    }

    let chain: Vec<Vec<u8>> = header
        .x5c
        .iter()
        .map(|c| {
            B64.decode(c)
                .map_err(|_| JwsError::Malformed("x5c entry is not base64"))
        })
        .collect::<Result<_, _>>()?;

    let leaf_key = verify_chain(&chain, root_der)?;

    // Only now is the payload worth reading: the bytes are attacker-supplied
    // until this passes.
    verify_signature(&leaf_key, jws)?;

    serde_json::from_slice(&b64url(payload_b64)?).map_err(|e| JwsError::BadPayload(e.to_string()))
}

fn b64url(s: &str) -> Result<Vec<u8>, JwsError> {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    URL_SAFE_NO_PAD
        .decode(s)
        .map_err(|_| JwsError::Malformed("segment is not base64url"))
}

/// Walks the chain from leaf to root and returns the leaf's public key.
///
/// The anchor check is a byte comparison against the pinned root rather than a
/// name or fingerprint match: names can be replayed by any CA willing to issue
/// them, and the DER we shipped is the only definition of "Apple" we trust.
fn verify_chain(chain: &[Vec<u8>], root_der: &[u8]) -> Result<Vec<u8>, JwsError> {
    // Leaf plus at least one issuer. Apple sends three.
    if chain.len() < 2 {
        return Err(JwsError::Malformed("x5c has fewer than two certificates"));
    }

    if chain.last().map(Vec::as_slice) != Some(root_der) {
        return Err(JwsError::UntrustedRoot);
    }

    let certs: Vec<X509Certificate> = chain
        .iter()
        .map(|der| {
            X509Certificate::from_der(der)
                .map(|(_, c)| c)
                .map_err(|_| JwsError::Malformed("x5c entry is not a certificate"))
        })
        .collect::<Result<_, _>>()?;

    let now = ASN1Time::from_timestamp(chrono::Utc::now().timestamp())
        .map_err(|_| JwsError::CertificateNotValid)?;

    for cert in &certs {
        if !cert.validity().is_valid_at(now) {
            return Err(JwsError::CertificateNotValid);
        }
    }

    // Each certificate must be signed by the next one up. Checking only the
    // leaf would let an attacker splice their own leaf under Apple's root.
    for pair in certs.windows(2) {
        pair[0]
            .verify_signature(Some(pair[1].public_key()))
            .map_err(|_| JwsError::BrokenChain)?;
    }

    Ok(certs[0].public_key().subject_public_key.data.to_vec())
}

/// ES256 over the signing input, using the leaf's key.
///
/// `from_ec_der` is a misleading name in jsonwebtoken: it wants the raw SEC1
/// point, which is exactly the BitString we pulled out of the certificate, not
/// a DER-wrapped SubjectPublicKeyInfo.
fn verify_signature(key: &[u8], jws: &str) -> Result<(), JwsError> {
    let mut validation = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::ES256);
    // Apple's payloads are not access tokens: no exp, no aud, no sub. Left as
    // it comes, jsonwebtoken would reject every one of them for a missing exp.
    validation.required_spec_claims.clear();
    validation.validate_exp = false;
    validation.validate_aud = false;

    // Deserialising into Value rather than the caller's type keeps this about
    // the signature alone — a payload that verifies but doesn't fit the
    // expected shape is a different error, and worth telling apart.
    jsonwebtoken::decode::<serde_json::Value>(
        jws,
        &jsonwebtoken::DecodingKey::from_ec_der(key),
        &validation,
    )
    .map(|_| ())
    .map_err(|_| JwsError::BadSignature)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use rcgen::{
        BasicConstraints, CertificateParams, DnType, IsCa, KeyPair, PKCS_ECDSA_P256_SHA256,
        PKCS_ECDSA_P384_SHA384,
    };
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Serialize, Deserialize, PartialEq)]
    struct Payload {
        #[serde(rename = "productId")]
        product_id: String,
    }

    /// A throwaway CA chain plus the leaf key, so tests can sign payloads the
    /// way Apple does and then take the chain apart.
    struct Chain {
        root_der: Vec<u8>,
        certs: Vec<Vec<u8>>,
        leaf_key: KeyPair,
    }

    fn ca_params(name: &str) -> CertificateParams {
        let mut p = CertificateParams::default();
        p.distinguished_name.push(DnType::CommonName, name);
        p.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        p
    }

    /// Mirrors Apple's shape: a P-384 self-signed root, a P-256 intermediate,
    /// a P-256 leaf, and x5c ordered leaf-first.
    fn chain() -> Chain {
        let root_key = KeyPair::generate_for(&PKCS_ECDSA_P384_SHA384).unwrap();
        let root = ca_params("Test Root CA").self_signed(&root_key).unwrap();

        let inter_key = KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256).unwrap();
        let inter = ca_params("Test Intermediate")
            .signed_by(&inter_key, &root, &root_key)
            .unwrap();

        let leaf_key = KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256).unwrap();
        let mut leaf_params = CertificateParams::default();
        leaf_params
            .distinguished_name
            .push(DnType::CommonName, "Test Leaf");
        let leaf = leaf_params
            .signed_by(&leaf_key, &inter, &inter_key)
            .unwrap();

        Chain {
            root_der: root.der().to_vec(),
            certs: vec![
                leaf.der().to_vec(),
                inter.der().to_vec(),
                root.der().to_vec(),
            ],
            leaf_key,
        }
    }

    fn sign(chain: &Chain, payload: &Payload) -> String {
        let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::ES256);
        header.x5c = Some(chain.certs.iter().map(|c| B64.encode(c)).collect());
        jsonwebtoken::encode(
            &header,
            payload,
            &jsonwebtoken::EncodingKey::from_ec_der(&chain.leaf_key.serialize_der()),
        )
        .unwrap()
    }

    fn a_payload() -> Payload {
        Payload {
            product_id: "com.pomodoso.app.pro.monthly".into(),
        }
    }

    // ─── The happy path ───────────────────────────────────────────────────────

    #[test]
    fn accepts_a_payload_signed_by_a_chain_rooted_in_the_trusted_ca() {
        let chain = chain();
        let jws = sign(&chain, &a_payload());

        let decoded: Payload = verify_against_root(&jws, &chain.root_der).unwrap();

        assert_eq!(decoded, a_payload());
    }

    // ─── Trust anchor ─────────────────────────────────────────────────────────

    #[test]
    fn rejects_a_perfectly_valid_chain_from_a_different_ca() {
        // The attack this exists to stop: a chain that verifies end to end but
        // was minted by someone who is not Apple. Everything about it is
        // internally consistent — only the anchor differs.
        let attacker = chain();
        let jws = sign(&attacker, &a_payload());

        let err = verify_against_root::<Payload>(&jws, &chain().root_der).unwrap_err();

        assert_eq!(err, JwsError::UntrustedRoot);
    }

    #[test]
    fn rejects_apples_real_root_when_the_payload_is_ours() {
        // The production entry point, against a chain we control. If this ever
        // passes, the pinning is not doing anything.
        let jws = sign(&chain(), &a_payload());

        assert_eq!(
            verify::<Payload>(&jws).unwrap_err(),
            JwsError::UntrustedRoot
        );
    }

    #[test]
    fn rejects_a_leaf_spliced_under_the_trusted_root() {
        // A chain whose root is genuinely Apple's but whose leaf was issued by
        // someone else. Checking only the anchor, or only the leaf, lets this
        // through — it is why the whole chain gets walked.
        let trusted = chain();
        let attacker = chain();

        let spliced = Chain {
            root_der: trusted.root_der.clone(),
            certs: vec![
                attacker.certs[0].clone(),
                attacker.certs[1].clone(),
                trusted.root_der.clone(),
            ],
            leaf_key: attacker.leaf_key,
        };
        let jws = sign(&spliced, &a_payload());

        assert_eq!(
            verify_against_root::<Payload>(&jws, &trusted.root_der).unwrap_err(),
            JwsError::BrokenChain
        );
    }

    // ─── Signature ────────────────────────────────────────────────────────────

    #[test]
    fn rejects_a_payload_edited_after_signing() {
        let chain = chain();
        let jws = sign(&chain, &a_payload());

        // Swap the body for a lifetime purchase, keeping header and signature.
        let mut parts: Vec<&str> = jws.split('.').collect();
        let forged = URL_SAFE_NO_PAD.encode(
            serde_json::to_vec(&Payload {
                product_id: "com.pomodoso.app.founder.lifetime".into(),
            })
            .unwrap(),
        );
        parts[1] = &forged;

        assert_eq!(
            verify_against_root::<Payload>(&parts.join("."), &chain.root_der).unwrap_err(),
            JwsError::BadSignature
        );
    }

    #[test]
    fn rejects_a_signature_from_a_key_that_is_not_the_leafs() {
        let chain = chain();
        let other = chain_signed_by_a_stranger(&chain);

        assert_eq!(
            verify_against_root::<Payload>(&other, &chain.root_der).unwrap_err(),
            JwsError::BadSignature
        );
    }

    /// Real chain, real anchor, but the body is signed with a key that has
    /// nothing to do with the leaf certificate presented.
    fn chain_signed_by_a_stranger(chain: &Chain) -> String {
        let stranger = KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256).unwrap();
        let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::ES256);
        header.x5c = Some(chain.certs.iter().map(|c| B64.encode(c)).collect());
        jsonwebtoken::encode(
            &header,
            &a_payload(),
            &jsonwebtoken::EncodingKey::from_ec_der(&stranger.serialize_der()),
        )
        .unwrap()
    }

    // ─── Algorithm ────────────────────────────────────────────────────────────

    #[test]
    fn refuses_to_verify_an_unsigned_token() {
        // alg=none is the oldest JWT attack there is; the header must not get
        // to choose whether the signature matters.
        let chain = chain();
        let header = URL_SAFE_NO_PAD.encode(
            serde_json::json!({
                "alg": "none",
                "x5c": chain.certs.iter().map(|c| B64.encode(c)).collect::<Vec<_>>(),
            })
            .to_string(),
        );
        let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&a_payload()).unwrap());

        assert_eq!(
            verify_against_root::<Payload>(&format!("{header}.{payload}."), &chain.root_der)
                .unwrap_err(),
            JwsError::UnexpectedAlgorithm("none".into())
        );
    }

    // ─── Shape ────────────────────────────────────────────────────────────────

    #[test]
    fn rejects_structurally_broken_input() {
        let root = chain().root_der;
        for input in ["", "a.b", "a.b.c.d", "not-a-jws"] {
            assert!(
                verify_against_root::<Payload>(input, &root).is_err(),
                "should have rejected {input:?}"
            );
        }
    }

    #[test]
    fn rejects_a_chain_with_no_issuer() {
        // A lone self-signed leaf. Without the length floor this would fall
        // through to the anchor check with nothing to compare.
        let chain = chain();
        let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::ES256);
        header.x5c = Some(vec![B64.encode(&chain.certs[0])]);
        let jws = jsonwebtoken::encode(
            &header,
            &a_payload(),
            &jsonwebtoken::EncodingKey::from_ec_der(&chain.leaf_key.serialize_der()),
        )
        .unwrap();

        assert!(matches!(
            verify_against_root::<Payload>(&jws, &chain.root_der).unwrap_err(),
            JwsError::Malformed(_)
        ));
    }

    // ─── The pinned certificate ───────────────────────────────────────────────

    #[test]
    fn the_pinned_root_is_apples_and_still_valid() {
        let (_, cert) = X509Certificate::from_der(APPLE_ROOT_CA_G3).unwrap();

        assert!(
            cert.subject()
                .iter_common_name()
                .next()
                .unwrap()
                .as_str()
                .unwrap()
                .contains("Apple Root CA - G3"),
            "the pinned anchor is not Apple's root"
        );
        assert!(
            cert.validity()
                .is_valid_at(ASN1Time::from_timestamp(chrono::Utc::now().timestamp()).unwrap()),
            "the pinned root has expired — purchases will stop verifying"
        );
    }
}
