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

        let payload = format!("{{\"exp\":{}}}", exp);
        let payload_b64 = B64.encode(&payload);

        let mut mac = HmacSha256::new_from_slice(&self.secret_key).unwrap();
        mac.update(payload_b64.as_bytes());
        let sig = B64.encode(mac.finalize().into_bytes());

        format!("{}.{}", payload_b64, sig)
    }

    pub fn verify_token(&self, token: &str) -> bool {
        let mut parts = token.splitn(2, '.');
        let payload_b64 = match parts.next() {
            Some(s) => s,
            None => return false,
        };
        let sig_b64 = match parts.next() {
            Some(s) => s,
            None => return false,
        };

        // Verify HMAC
        let mut mac = match HmacSha256::new_from_slice(&self.secret_key) {
            Ok(m) => m,
            Err(_) => return false,
        };
        mac.update(payload_b64.as_bytes());
        let expected_sig = match B64.decode(sig_b64) {
            Ok(s) => s,
            Err(_) => return false,
        };
        if mac.verify_slice(&expected_sig).is_err() {
            return false;
        }

        // Check expiry
        let payload_bytes = match B64.decode(payload_b64) {
            Ok(p) => p,
            Err(_) => return false,
        };
        let payload_str = match std::str::from_utf8(&payload_bytes) {
            Ok(s) => s,
            Err(_) => return false,
        };
        let exp = payload_str
            .trim_start_matches("{\"exp\":")
            .trim_end_matches('}')
            .parse::<u64>()
            .unwrap_or(0);

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        exp > now
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
        assert!(cfg.verify_token(&token));
    }

    #[test]
    fn test_garbage_token() {
        let cfg = AuthConfig::from_env();
        assert!(!cfg.verify_token("garbage"));
        assert!(!cfg.verify_token("a.b"));
        assert!(!cfg.verify_token(""));
    }
}
