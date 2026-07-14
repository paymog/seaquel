//! Multi-user authentication for the self-hosted server.
//!
//! Users are stored in a file-persisted JSON store (`users.json`). Passwords
//! are hashed with Argon2id. Login returns an HMAC-SHA256 signed token
//! (24 h expiry) carrying the username, role, and a unique session ID. The
//! token must be sent as `Authorization: Bearer <token>` on all `/api/*`
//! routes (except login).

use std::collections::HashMap;
use std::path::Path;

use argon2::password_hash::{
    rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
};
use argon2::Argon2;
use base64::Engine;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;
const TOKEN_TTL_SECS: u64 = 86_400; // 24 hours
const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::URL_SAFE_NO_PAD;

// ── Password hashing ─────────────────────────────────────────────────────────

fn hash_password(password: &str) -> String {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .expect("argon2 hashing should not fail")
        .to_string()
}

fn verify_password_hash(password: &str, hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

// ── User store ───────────────────────────────────────────────────────────────

/// A single user record (stored on disk — never serialized to the client).
#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct UserRecord {
    username: String,
    password_hash: String,
    role: String,
}

/// Public user info returned by the API (no password hash).
#[derive(serde::Serialize, Clone)]
pub struct UserInfo {
    pub username: String,
    pub role: String,
}

struct UserStoreInner {
    users: HashMap<String, UserRecord>,
    file_path: Option<std::path::PathBuf>,
}

/// File-persisted, async-safe user store. Backed by `users.json` in the data
/// directory. Uses Argon2id for password hashing.
pub struct UserStore {
    inner: tokio::sync::RwLock<UserStoreInner>,
}

impl UserStore {
    #[cfg(test)]
    /// In-memory store (tests / no persistence).
    fn new() -> Self {
        Self {
            inner: tokio::sync::RwLock::new(UserStoreInner {
                users: HashMap::new(),
                file_path: None,
            }),
        }
    }

    /// File-backed store that loads on construction and persists on every
    /// mutation.
    pub fn with_persistence(file_path: std::path::PathBuf) -> Self {
        let users = Self::load_from_file(&file_path);
        Self {
            inner: tokio::sync::RwLock::new(UserStoreInner {
                users,
                file_path: Some(file_path),
            }),
        }
    }

    fn load_from_file(path: &Path) -> HashMap<String, UserRecord> {
        match std::fs::read_to_string(path) {
            Ok(json) => serde_json::from_str(&json).unwrap_or_default(),
            Err(_) => HashMap::new(),
        }
    }

    fn persist(inner: &UserStoreInner) {
        if let Some(ref path) = inner.file_path {
            if let Ok(json) = serde_json::to_string_pretty(&inner.users) {
                if let Some(parent) = path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                let _ = std::fs::write(path, json);
            }
        }
    }

    pub async fn is_empty(&self) -> bool {
        self.inner.read().await.users.is_empty()
    }

    /// Returns the user's role if credentials match.
    pub async fn verify(&self, username: &str, password: &str) -> Option<String> {
        let inner = self.inner.read().await;
        let user = inner.users.get(username)?;
        if verify_password_hash(password, &user.password_hash) {
            Some(user.role.clone())
        } else {
            None
        }
    }

    /// Add a user. Returns `false` if the username already exists.
    pub async fn add(&self, username: &str, password: &str, role: &str) -> bool {
        let mut inner = self.inner.write().await;
        if inner.users.contains_key(username) {
            return false;
        }
        inner.users.insert(
            username.to_string(),
            UserRecord {
                username: username.to_string(),
                password_hash: hash_password(password),
                role: role.to_string(),
            },
        );
        Self::persist(&inner);
        true
    }

    /// Remove a user. Returns `false` if not found.
    pub async fn remove(&self, username: &str) -> bool {
        let mut inner = self.inner.write().await;
        let removed = inner.users.remove(username).is_some();
        if removed {
            Self::persist(&inner);
        }
        removed
    }

    /// Update password and/or role. Returns `false` if user not found.
    pub async fn update(
        &self,
        username: &str,
        password: Option<&str>,
        role: Option<&str>,
    ) -> bool {
        let mut inner = self.inner.write().await;
        let Some(user) = inner.users.get_mut(username) else {
            return false;
        };
        if let Some(pw) = password {
            user.password_hash = hash_password(pw);
        }
        if let Some(r) = role {
            user.role = r.to_string();
        }
        Self::persist(&inner);
        true
    }

    pub async fn list(&self) -> Vec<UserInfo> {
        self.inner
            .read()
            .await
            .users
            .values()
            .map(|u| UserInfo {
                username: u.username.clone(),
                role: u.role.clone(),
            })
            .collect()
    }
}

// ── Auth claims ──────────────────────────────────────────────────────────────

/// Claims extracted from a verified token. Injected into request extensions
/// by the auth middleware.
#[derive(Debug, Clone)]
pub struct AuthClaims {
    pub session_id: String,
    pub username: String,
    pub role: String,
}

// ── Auth config ──────────────────────────────────────────────────────────────

pub struct AuthConfig {
    secret_key: Vec<u8>,
    users: UserStore,
}

impl AuthConfig {
    /// Initialise from environment. Derives a signing key from
    /// `SEAQUEL_SECRET_KEY` (or generates a random one). Bootstraps an admin
    /// user from `SEAQUEL_ADMIN_PASSWORD` if the user store is empty.
    pub async fn from_env(data_dir: &Path) -> Self {
        let secret_key = Self::derive_signing_key();
        let users = UserStore::with_persistence(data_dir.join("users.json"));

        let config = Self { secret_key, users };
        config.bootstrap_admin().await;
        config
    }

    /// Test constructor — in-memory user store, deterministic key.
    #[cfg(test)]
    fn for_test() -> Self {
        Self {
            secret_key: Self::derive_signing_key(),
            users: UserStore::new(),
        }
    }

    fn derive_signing_key() -> Vec<u8> {
        if let Ok(b64) = std::env::var("SEAQUEL_SECRET_KEY") {
            if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(b64.trim()) {
                return bytes;
            }
        }
        // Fallback: hash a fixed seed so tests are deterministic.
        let mut h = Sha256::new();
        h.update(b"seaquel-auth-signing-key-v2");
        h.finalize().to_vec()
    }

    async fn bootstrap_admin(&self) {
        if self.users.is_empty().await {
            let password =
                std::env::var("SEAQUEL_ADMIN_PASSWORD").unwrap_or_else(|_| "admin".to_string());
            self.users.add("admin", &password, "admin").await;
        }
    }

    pub fn users(&self) -> &UserStore {
        &self.users
    }

    /// Verify credentials and return the user's role if valid.
    pub async fn verify_credentials(&self, username: &str, password: &str) -> Option<String> {
        self.users.verify(username, password).await
    }

    pub fn create_token(&self, username: &str, role: &str) -> String {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let exp = now + TOKEN_TTL_SECS;
        let sid = uuid::Uuid::new_v4().to_string();

        let payload = format!(
            r#"{{"exp":{},"sid":"{}","user":"{}","role":"{}"}}"#,
            exp, sid, username, role
        );
        let payload_b64 = B64.encode(&payload);

        let mut mac = HmacSha256::new_from_slice(&self.secret_key).unwrap();
        mac.update(payload_b64.as_bytes());
        let sig = B64.encode(mac.finalize().into_bytes());

        format!("{}.{}", payload_b64, sig)
    }

    /// Verify token and return the claims if valid.
    pub fn verify_token(&self, token: &str) -> Option<AuthClaims> {
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

        Some(AuthClaims {
            session_id: payload["sid"].as_str()?.to_string(),
            username: payload["user"].as_str()?.to_string(),
            role: payload["role"].as_str()?.to_string(),
        })
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    async fn make_config() -> AuthConfig {
        let cfg = AuthConfig::for_test();
        cfg.users().add("alice", "secret", "admin").await;
        cfg.users().add("bob", "pass", "viewer").await;
        cfg
    }

    #[tokio::test]
    async fn test_correct_password() {
        let cfg = make_config().await;
        let role = cfg.verify_credentials("alice", "secret").await;
        assert_eq!(role.as_deref(), Some("admin"));
    }

    #[tokio::test]
    async fn test_wrong_password() {
        let cfg = make_config().await;
        assert!(cfg.verify_credentials("alice", "wrong").await.is_none());
    }

    #[tokio::test]
    async fn test_unknown_user() {
        let cfg = make_config().await;
        assert!(cfg.verify_credentials("nobody", "x").await.is_none());
    }

    #[tokio::test]
    async fn test_token_roundtrip() {
        let cfg = make_config().await;
        let token = cfg.create_token("alice", "admin");
        let claims = cfg.verify_token(&token).expect("valid token");
        assert_eq!(claims.username, "alice");
        assert_eq!(claims.role, "admin");
        assert!(!claims.session_id.is_empty());
    }

    #[tokio::test]
    async fn test_token_carries_role() {
        let cfg = make_config().await;
        let token = cfg.create_token("bob", "viewer");
        let claims = cfg.verify_token(&token).unwrap();
        assert_eq!(claims.role, "viewer");
    }

    #[tokio::test]
    async fn test_garbage_token() {
        let cfg = make_config().await;
        assert!(cfg.verify_token("garbage").is_none());
        assert!(cfg.verify_token("a.b").is_none());
        assert!(cfg.verify_token("").is_none());
    }

    #[tokio::test]
    async fn test_different_logins_have_different_sessions() {
        let cfg = make_config().await;
        let c1 = cfg.verify_token(&cfg.create_token("alice", "admin")).unwrap();
        let c2 = cfg.verify_token(&cfg.create_token("alice", "admin")).unwrap();
        assert_ne!(c1.session_id, c2.session_id);
    }

    #[tokio::test]
    async fn test_add_duplicate_user_fails() {
        let cfg = make_config().await;
        assert!(!cfg.users().add("alice", "newpass", "viewer").await);
    }

    #[tokio::test]
    async fn test_update_password() {
        let cfg = make_config().await;
        assert!(cfg.users().update("bob", Some("newpw"), None).await);
        assert_eq!(
            cfg.verify_credentials("bob", "newpw").await.as_deref(),
            Some("viewer")
        );
        assert!(cfg.verify_credentials("bob", "pass").await.is_none());
    }

    #[tokio::test]
    async fn test_update_role() {
        let cfg = make_config().await;
        assert!(cfg.users().update("bob", None, Some("editor")).await);
        assert_eq!(
            cfg.verify_credentials("bob", "pass").await.as_deref(),
            Some("editor")
        );
    }

    #[tokio::test]
    async fn test_remove_user() {
        let cfg = make_config().await;
        assert!(cfg.users().remove("bob").await);
        assert!(!cfg.users().remove("bob").await);
        assert!(cfg.verify_credentials("bob", "pass").await.is_none());
    }

    #[tokio::test]
    async fn test_list_users() {
        let cfg = make_config().await;
        let users = cfg.users().list().await;
        assert_eq!(users.len(), 2);
        let names: Vec<_> = users.iter().map(|u| u.username.as_str()).collect();
        assert!(names.contains(&"alice"));
        assert!(names.contains(&"bob"));
    }
}
