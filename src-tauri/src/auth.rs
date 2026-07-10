//! HMAC-SHA256 bearer-token authentication for the self-hosted server.
//!
//! Single-admin model: one password set via `SEAQUEL_ADMIN_PASSWORD`.
//! Login returns a signed token (24 h expiry) that must be sent as
//! `Authorization: Bearer <token>` on all `/api/*` routes (except login).

use base64::Engine;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;
const TOKEN_TTL_SECS: u64 = 86_400; // 24 hours
const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::URL_SAFE_NO_PAD;

#[derive(Clone)]
pub struct AuthConfig {
    secret_key: Vec<u8>,
    admin_password_hash: String,
}

impl AuthConfig {
    pub fn from_env() -> Self {
        let password =
            std::env::var("SEAQUEL_ADMIN_PASSWORD").unwrap_or_else(|_| "admin".to_string());

        let mut h = Sha256::new();
        h.update(password.as_bytes());
        let admin_password_hash = B64.encode(h.finalize());

        // Derive a signing key from the password so changing the password
        // also invalidates all outstanding tokens.
        let mut kh = Sha256::new();
        kh.update(b"seaquel-auth-signing-key-v1");
        kh.update(password.as_bytes());
        let secret_key = kh.finalize().to_vec();

        Self {
            secret_key,
            admin_password_hash,
        }
    }

    pub fn verify_password(&self, password: &str) -> bool {
        let mut h = Sha256::new();
        h.update(password.as_bytes());
        let hash = B64.encode(h.finalize());
        hash == self.admin_password_hash
    }

    pub fn create_token(&self) -> String {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let exp = now + TOKEN_TTL_SECS;
        let sid = uuid::Uuid::new_v4().to_string();

        let payload = format!("{{\"exp\":{},\"sid\":\"{}\"}}", exp, sid);
        let payload_b64 = B64.encode(&payload);

        let mut mac = HmacSha256::new_from_slice(&self.secret_key).unwrap();
        mac.update(payload_b64.as_bytes());
        let sig = B64.encode(mac.finalize().into_bytes());

        format!("{}.{}", payload_b64, sig)
    }

    /// Verify token and return the session ID if valid.
    pub fn verify_token(&self, token: &str) -> Option<String> {
        let mut parts = token.splitn(2, '.');
        let payload_b64 = parts.next()?;
        let sig_b64 = parts.next()?;

        // Verify HMAC
        let mut mac = HmacSha256::new_from_slice(&self.secret_key).ok()?;
        mac.update(payload_b64.as_bytes());
        let expected_sig = B64.decode(sig_b64).ok()?;
        mac.verify_slice(&expected_sig).ok()?;

        // Decode payload
        let payload_bytes = B64.decode(payload_b64).ok()?;
        let payload_str = std::str::from_utf8(&payload_bytes).ok()?;
        let payload: serde_json::Value = serde_json::from_str(payload_str).ok()?;

        // Check expiry
        let exp = payload["exp"].as_u64().unwrap_or(0);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        if exp <= now {
            return None;
        }

        payload["sid"].as_str().map(|s| s.to_string())
    }

}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_correct_password() {
        let cfg = AuthConfig::from_env(); // default "admin"
        assert!(cfg.verify_password("admin"));
    }

    #[test]
    fn test_wrong_password() {
        let cfg = AuthConfig::from_env();
        assert!(!cfg.verify_password("wrong"));
    }

    #[test]
    fn test_token_roundtrip() {
        let cfg = AuthConfig::from_env();
        let token = cfg.create_token();
        assert!(cfg.verify_token(&token).is_some());
    }

    #[test]
    fn test_garbage_token() {
        let cfg = AuthConfig::from_env();
        assert!(cfg.verify_token("garbage").is_none());
        assert!(cfg.verify_token("a.b").is_none());
        assert!(cfg.verify_token("").is_none());
    }
}

    #[test]
    fn test_token_has_session_id() {
        let cfg = AuthConfig::from_env();
        let token = cfg.create_token();
        let sid = cfg.verify_token(&token).expect("valid token");
        assert!(!sid.is_empty(), "session ID should be non-empty");
    }

    #[test]
    fn test_different_logins_have_different_sessions() {
        let cfg = AuthConfig::from_env();
        let sid1 = cfg.verify_token(&cfg.create_token()).unwrap();
        let sid2 = cfg.verify_token(&cfg.create_token()).unwrap();
        assert_ne!(sid1, sid2, "each login should get a unique session");
    }
