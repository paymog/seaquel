//! HTTP + WebSocket server — exposed as `seaquel_lib::server` so both the
//! binary and the integration tests can share `build_router` / `run_server`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use futures::{SinkExt, StreamExt};
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};

use crate::db::{
    duckdb::DuckdbDriver, mssql::MssqlDriver, mysql::MysqlDriver, postgres::PostgresDriver,
    sqlite::SqliteDriver, BatchStatement, ConnectConfig, ConnectResult, ConnectionManager, DbError,
    Driver, DriverType, ExecuteResult, QueryResult, StreamEvent,
};

use crate::ssh_tunnel::{TunnelConfig, TunnelError, TunnelManager, TunnelResult};

// ── Secret store ─────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct SecretStore {
    secrets: tokio::sync::RwLock<HashMap<String, String>>,
}

impl SecretStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn set(&self, key: &str, value: &str) {
        self.secrets
            .write()
            .await
            .insert(key.to_string(), value.to_string());
    }

    pub async fn get(&self, key: &str) -> Option<String> {
        self.secrets.read().await.get(key).cloned()
    }

    pub async fn delete(&self, key: &str) -> bool {
        self.secrets.write().await.remove(key).is_some()
    }
}
// ── App state ─────────────────────────────────────────────────────────────────

/// Combined application state; sub-states are extracted via `FromRef` so
/// existing handlers that take `State<Arc<ConnectionManager>>` compile unchanged.
#[derive(Clone)]
pub struct AppState {
    pub db: Arc<ConnectionManager>,
    pub secrets: Arc<SecretStore>,
    pub tunnels: Arc<TunnelManager>,
}

impl axum::extract::FromRef<AppState> for Arc<ConnectionManager> {
    fn from_ref(state: &AppState) -> Self {
        Arc::clone(&state.db)
    }
}

impl axum::extract::FromRef<AppState> for Arc<SecretStore> {
    fn from_ref(state: &AppState) -> Self {
        Arc::clone(&state.secrets)
    }
}

impl axum::extract::FromRef<AppState> for Arc<TunnelManager> {
    fn from_ref(state: &AppState) -> Self {
        Arc::clone(&state.tunnels)
    }
}


// ── Request body types ────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct QueryRequest {
    connection_id: String,
    sql: String,
    values: Vec<serde_json::Value>,
}

#[derive(serde::Deserialize)]
struct ExecuteRequest {
    connection_id: String,
    sql: String,
    values: Vec<serde_json::Value>,
}

#[derive(serde::Deserialize)]
struct DisconnectRequest {
    connection_id: String,
}

#[derive(serde::Deserialize)]
struct TransactionRequest {
    connection_id: String,
    statements: Vec<BatchStatement>,
}

#[derive(serde::Deserialize)]
struct StreamRequest {
    query_id: String,
    connection_id: String,
    sql: String,
    values: Vec<serde_json::Value>,
}

#[derive(serde::Deserialize)]
struct SetSecretRequest {
    key: String,
    value: String,
}

#[derive(serde::Serialize)]
struct GetSecretResponse {
    value: String,
}

// ── Error response ────────────────────────────────────────────────────────────

struct ApiError(StatusCode, DbError);

impl From<DbError> for ApiError {
    fn from(err: DbError) -> Self {
        let status = match err.code.as_str() {
            "CONNECTION_NOT_FOUND" => StatusCode::NOT_FOUND,
            "CONNECTION_ERROR" | "QUERY_ERROR" | "EXECUTE_ERROR" => StatusCode::BAD_REQUEST,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        ApiError(status, err)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(self.1)).into_response()
    }
}

// ── Driver factory ────────────────────────────────────────────────────────────

async fn connect_driver(config: &ConnectConfig) -> Result<Box<dyn Driver>, DbError> {
    let driver: Box<dyn Driver> = match config.driver {
        DriverType::Postgres => Box::new(PostgresDriver::connect(config).await?),
        DriverType::Mysql => Box::new(MysqlDriver::connect(config).await?),
        DriverType::Sqlite => Box::new(SqliteDriver::connect(config).await?),
        DriverType::Mssql => Box::new(MssqlDriver::connect(config).await?),
        DriverType::Duckdb => Box::new(DuckdbDriver::connect(config)?),
    };
    Ok(driver)
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async fn handle_connect(
    State(manager): State<Arc<ConnectionManager>>,
    Json(config): Json<ConnectConfig>,
) -> Result<Json<ConnectResult>, ApiError> {
    let driver_name = format!("{:?}", config.driver);
    let connection_id = format!("{}-{}", driver_name.to_lowercase(), uuid::Uuid::new_v4());
    let driver = connect_driver(&config).await?;
    manager
        .connections
        .write()
        .await
        .insert(connection_id.clone(), Arc::from(driver));
    log::info!("connected driver={} connection_id={}", driver_name, connection_id);
    Ok(Json(ConnectResult { connection_id }))
}

async fn handle_query(
    State(manager): State<Arc<ConnectionManager>>,
    Json(req): Json<QueryRequest>,
) -> Result<Json<QueryResult>, ApiError> {
    let connections = manager.connections.read().await;
    let driver = connections
        .get(&req.connection_id)
        .ok_or_else(|| DbError::connection_not_found(&req.connection_id))?;
    let result = driver.query(&req.sql, req.values).await?;
    Ok(Json(result))
}

async fn handle_execute(
    State(manager): State<Arc<ConnectionManager>>,
    Json(req): Json<ExecuteRequest>,
) -> Result<Json<ExecuteResult>, ApiError> {
    let connections = manager.connections.read().await;
    let driver = connections
        .get(&req.connection_id)
        .ok_or_else(|| DbError::connection_not_found(&req.connection_id))?;
    let result = driver.execute(&req.sql, req.values).await?;
    Ok(Json(result))
}

async fn handle_test(Json(config): Json<ConnectConfig>) -> Result<Json<()>, ApiError> {
    let driver = connect_driver(&config).await?;
    driver.close().await?;
    Ok(Json(()))
}

async fn handle_disconnect(
    State(manager): State<Arc<ConnectionManager>>,
    Json(req): Json<DisconnectRequest>,
) -> Result<Json<()>, ApiError> {
    let mut connections = manager.connections.write().await;
    if let Some(driver) = connections.remove(&req.connection_id) {
        driver.close().await?;
    }
    log::info!("disconnected connection_id={}", req.connection_id);
    Ok(Json(()))
}

async fn handle_transaction(
    State(manager): State<Arc<ConnectionManager>>,
    Json(req): Json<TransactionRequest>,
) -> Result<Json<()>, ApiError> {
    let connections = manager.connections.read().await;
    let driver = connections
        .get(&req.connection_id)
        .ok_or_else(|| DbError::connection_not_found(&req.connection_id))?;
    driver.transaction(req.statements).await?;
    Ok(Json(()))
}

async fn handle_stream(
    ws: WebSocketUpgrade,
    State(manager): State<Arc<ConnectionManager>>,
) -> Response {
    ws.on_upgrade(|socket| stream_handler(socket, manager))
}

async fn stream_handler(socket: WebSocket, manager: Arc<ConnectionManager>) {
    let (mut sender, mut receiver) = socket.split();

    // Wait for the initial query request from the client.
    let first_msg = match receiver.next().await {
        Some(Ok(Message::Text(text))) => text,
        _ => {
            let _ = sender.send(Message::Close(None)).await;
            return;
        }
    };

    let req: StreamRequest = match serde_json::from_str(&first_msg) {
        Ok(r) => r,
        Err(e) => {
            let err = StreamEvent::Error {
                message: e.to_string(),
                code: "BAD_REQUEST".to_string(),
            };
            let _ = sender
                .send(Message::Text(serde_json::to_string(&err).unwrap().into()))
                .await;
            let _ = sender.send(Message::Close(None)).await;
            return;
        }
    };

    // Clone the Arc before dropping the read lock so the stream can run
    // without holding the lock for its full duration.
    let driver = {
        let connections = manager.connections.read().await;
        match connections.get(&req.connection_id) {
            Some(d) => Arc::clone(d),
            None => {
                let err = StreamEvent::Error {
                    message: format!("Connection not found: {}", req.connection_id),
                    code: "CONNECTION_NOT_FOUND".to_string(),
                };
                let _ = sender
                    .send(Message::Text(serde_json::to_string(&err).unwrap().into()))
                    .await;
                let _ = sender.send(Message::Close(None)).await;
                return;
            }
        }
    };

    // Register a cancellation flag so HTTP POST /cancel can flip it.
    let cancel_flag = Arc::new(AtomicBool::new(false));
    manager
        .cancellation_flags
        .write()
        .await
        .insert(req.query_id.clone(), Arc::clone(&cancel_flag));

    // The stream borrows &driver; since driver is a local Arc the borrow is
    // valid for the remainder of this function.
    let mut db_stream = driver.query_stream(req.sql, req.values);

    loop {
        tokio::select! {
            batch = db_stream.next() => {
                match batch {
                    Some(Ok(batch)) => {
                        if cancel_flag.load(Ordering::Relaxed) {
                            // Cancel requested between batches — terminate normally.
                            break;
                        }
                        let event = StreamEvent::Batch(batch);
                        let json = serde_json::to_string(&event).unwrap();
                        if sender.send(Message::Text(json.into())).await.is_err() {
                            // Client disappeared — clean up silently.
                            manager.cancellation_flags.write().await.remove(&req.query_id);
                            return;
                        }
                    }
                    Some(Err(e)) => {
                        let err = StreamEvent::Error {
                            message: e.message,
                            code: e.code,
                        };
                        let _ = sender
                            .send(Message::Text(serde_json::to_string(&err).unwrap().into()))
                            .await;
                        manager.cancellation_flags.write().await.remove(&req.query_id);
                        return;
                    }
                    None => break, // Stream exhausted naturally.
                }
            }
            msg = receiver.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                            if v.get("type").and_then(|t| t.as_str()) == Some("cancel") {
                                cancel_flag.store(true, Ordering::Relaxed);
                            }
                        }
                    }
                    // Client sent Close or connection error — stop immediately.
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => {
                        manager.cancellation_flags.write().await.remove(&req.query_id);
                        return;
                    }
                    _ => {} // Ping / Pong / Binary — ignore.
                }
            }
        }
    }

    // Natural completion or cancel — emit terminal Done event.
    let _ = sender
        .send(Message::Text(
            serde_json::to_string(&StreamEvent::Done).unwrap().into(),
        ))
        .await;
    manager.cancellation_flags.write().await.remove(&req.query_id);
}

// ── Secret handlers ───────────────────────────────────────────────────────────

async fn handle_set_secret(
    State(store): State<Arc<SecretStore>>,
    Json(req): Json<SetSecretRequest>,
) -> impl IntoResponse {
    store.set(&req.key, &req.value).await;
    StatusCode::CREATED
}

async fn handle_get_secret(
    State(store): State<Arc<SecretStore>>,
    Path(key): Path<String>,
) -> impl IntoResponse {
    match store.get(&key).await {
        Some(value) => (StatusCode::OK, Json(GetSecretResponse { value })).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn handle_delete_secret(
    State(store): State<Arc<SecretStore>>,
    Path(key): Path<String>,
) -> impl IntoResponse {
    store.delete(&key).await;
    StatusCode::NO_CONTENT
}


// ── SSH tunnel handlers ───────────────────────────────────────────────────────

struct SshApiError(StatusCode, TunnelError);

impl IntoResponse for SshApiError {
    fn into_response(self) -> Response {
        let body = serde_json::to_string(&self.1).unwrap_or_default();
        (self.0, body).into_response()
    }
}

impl From<TunnelError> for SshApiError {
    fn from(e: TunnelError) -> Self {
        let status = match e.code.as_str() {
            "TUNNEL_NOT_FOUND" => StatusCode::NOT_FOUND,
            "KEY_NOT_FOUND" | "KEY_LOAD_ERROR" | "INVALID_AUTH_METHOD" => {
                StatusCode::UNPROCESSABLE_ENTITY
            }
            "TIMEOUT" | "CONNECTION_ERROR" | "AUTH_FAILED" | "AUTH_ERROR" => {
                StatusCode::BAD_GATEWAY
            }
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        SshApiError(status, e)
    }
}

async fn handle_create_tunnel(
    State(tunnels): State<Arc<TunnelManager>>,
    Json(config): Json<TunnelConfig>,
) -> Result<Json<TunnelResult>, SshApiError> {
    let result = tunnels.establish(&config).await.map_err(SshApiError::from)?;
    Ok(Json(result))
}

async fn handle_close_tunnel(
    State(tunnels): State<Arc<TunnelManager>>,
    Path(tunnel_id): Path<String>,
) -> impl IntoResponse {
    if tunnels.close(&tunnel_id).await {
        StatusCode::NO_CONTENT.into_response()
    } else {
        StatusCode::NOT_FOUND.into_response()
    }
}

async fn handle_tunnel_status(
    State(tunnels): State<Arc<TunnelManager>>,
    Path(tunnel_id): Path<String>,
) -> impl IntoResponse {
    let active = tunnels.is_active(&tunnel_id).await;
    Json(serde_json::json!({ "active": active }))
}

async fn handle_list_tunnels(State(tunnels): State<Arc<TunnelManager>>) -> impl IntoResponse {
    Json(tunnels.list().await)
}

// ── Git helpers ───────────────────────────────────────────────────────────────

fn git_base_dir() -> std::path::PathBuf {
    let base = std::env::var("SEAQUEL_DATA_DIR").unwrap_or_else(|_| "./data".to_string());
    let path = std::path::PathBuf::from(base).join("git");
    let _ = std::fs::create_dir_all(&path);
    path
}

fn resolve_git_path(repo_path: &str) -> std::path::PathBuf {
    git_base_dir().join(repo_path.trim_start_matches('/'))
}

struct GitApiError(StatusCode, crate::git::GitError);

impl From<crate::git::GitError> for GitApiError {
    fn from(err: crate::git::GitError) -> Self {
        let status = match err.code.as_str() {
            "REPO_OPEN_ERROR" => StatusCode::NOT_FOUND,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        GitApiError(status, err)
    }
}

impl IntoResponse for GitApiError {
    fn into_response(self) -> Response {
        (self.0, Json(self.1)).into_response()
    }
}

async fn run_git<T, F>(f: F) -> Result<T, GitApiError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, crate::git::GitError> + Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|_| {
            GitApiError(
                StatusCode::INTERNAL_SERVER_ERROR,
                crate::git::GitError {
                    message: "git task panicked".to_string(),
                    code: "INTERNAL_ERROR".to_string(),
                },
            )
        })?
        .map_err(GitApiError::from)
}

// ── Git request / response types ──────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct GitCloneRequest {
    url: String,
    path: String,
    credentials: Option<crate::git::GitCredentials>,
}

#[derive(serde::Deserialize)]
struct GitInitRequest {
    path: String,
}

#[derive(serde::Deserialize)]
struct GitPullRequest {
    path: String,
    credentials: Option<crate::git::GitCredentials>,
}

#[derive(serde::Deserialize)]
struct GitPushRequest {
    path: String,
    credentials: Option<crate::git::GitCredentials>,
}

#[derive(serde::Deserialize)]
struct GitStatusQuery {
    path: String,
}

#[derive(serde::Deserialize)]
struct GitCommitRequest {
    path: String,
    message: String,
}

#[derive(serde::Serialize)]
struct GitCommitResponse {
    commit_id: String,
}

#[derive(serde::Deserialize)]
struct GitStageRequest {
    path: String,
    file_path: String,
}

#[derive(serde::Deserialize)]
struct GitDiscardRequest {
    path: String,
    file_path: String,
}

#[derive(serde::Deserialize)]
struct GitResolveRequest {
    path: String,
    file_path: String,
    resolution: String,
}

#[derive(serde::Deserialize)]
struct GitConflictQuery {
    path: String,
    file_path: String,
}

#[derive(serde::Deserialize)]
struct GitSetRemoteRequest {
    path: String,
    url: String,
}

#[derive(serde::Deserialize)]
struct GitRemoteUrlQuery {
    path: String,
}

#[derive(serde::Serialize)]
struct GitRemoteUrlResponse {
    url: Option<String>,
}

// ── Git handlers ──────────────────────────────────────────────────────────────

async fn handle_git_clone(Json(req): Json<GitCloneRequest>) -> Result<StatusCode, GitApiError> {
    let p = resolve_git_path(&req.path).to_string_lossy().to_string();
    run_git(move || crate::git::git_clone_repo(req.url, p, req.credentials)).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn handle_git_init(Json(req): Json<GitInitRequest>) -> Result<StatusCode, GitApiError> {
    let p = resolve_git_path(&req.path).to_string_lossy().to_string();
    run_git(move || crate::git::git_init_repo(p)).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn handle_git_pull(
    Json(req): Json<GitPullRequest>,
) -> Result<Json<crate::git::SyncResult>, GitApiError> {
    let p = resolve_git_path(&req.path).to_string_lossy().to_string();
    let result = run_git(move || crate::git::git_pull_repo(p, req.credentials)).await?;
    Ok(Json(result))
}

async fn handle_git_push(
    Json(req): Json<GitPushRequest>,
) -> Result<Json<crate::git::SyncResult>, GitApiError> {
    let p = resolve_git_path(&req.path).to_string_lossy().to_string();
    let result = run_git(move || crate::git::git_push_repo(p, req.credentials)).await?;
    Ok(Json(result))
}

async fn handle_git_status(
    Query(q): Query<GitStatusQuery>,
) -> Result<Json<crate::git::RepoStatus>, GitApiError> {
    let p = resolve_git_path(&q.path).to_string_lossy().to_string();
    let result = run_git(move || crate::git::git_get_repo_status(p)).await?;
    Ok(Json(result))
}

async fn handle_git_commit(
    Json(req): Json<GitCommitRequest>,
) -> Result<Json<GitCommitResponse>, GitApiError> {
    let p = resolve_git_path(&req.path).to_string_lossy().to_string();
    let commit_id = run_git(move || crate::git::git_commit_changes(p, req.message)).await?;
    Ok(Json(GitCommitResponse { commit_id }))
}

async fn handle_git_stage(Json(req): Json<GitStageRequest>) -> Result<StatusCode, GitApiError> {
    let p = resolve_git_path(&req.path).to_string_lossy().to_string();
    run_git(move || crate::git::git_stage_file(p, req.file_path)).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn handle_git_discard(
    Json(req): Json<GitDiscardRequest>,
) -> Result<StatusCode, GitApiError> {
    let p = resolve_git_path(&req.path).to_string_lossy().to_string();
    run_git(move || crate::git::git_discard_file(p, req.file_path)).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn handle_git_resolve(
    Json(req): Json<GitResolveRequest>,
) -> Result<StatusCode, GitApiError> {
    let p = resolve_git_path(&req.path).to_string_lossy().to_string();
    run_git(move || crate::git::git_resolve_conflict(p, req.file_path, req.resolution)).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn handle_git_conflict(
    Query(q): Query<GitConflictQuery>,
) -> Result<Json<crate::git::ConflictContent>, GitApiError> {
    let p = resolve_git_path(&q.path).to_string_lossy().to_string();
    let result = run_git(move || crate::git::git_get_conflict_content(p, q.file_path)).await?;
    Ok(Json(result))
}

async fn handle_git_set_remote(
    Json(req): Json<GitSetRemoteRequest>,
) -> Result<StatusCode, GitApiError> {
    let p = resolve_git_path(&req.path).to_string_lossy().to_string();
    run_git(move || crate::git::git_set_remote(p, req.url)).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn handle_git_remote_url(
    Query(q): Query<GitRemoteUrlQuery>,
) -> Result<Json<GitRemoteUrlResponse>, GitApiError> {
    let p = resolve_git_path(&q.path).to_string_lossy().to_string();
    let url = run_git(move || crate::git::git_get_remote_url(p)).await?;
    Ok(Json(GitRemoteUrlResponse { url }))
}


// ── Router builder ────────────────────────────────────────────────────────────

/// Build the application router.  Exposed `pub` so tests and the binary can
/// both call it without duplicating handler wiring.
pub fn build_router(db_state: Arc<ConnectionManager>, secret_state: Arc<SecretStore>, tunnel_state: Arc<TunnelManager>) -> Router {
    let static_dir =
        std::env::var("SEAQUEL_STATIC_DIR").unwrap_or_else(|_| "./static".to_string());

    let serve_dir = ServeDir::new(&static_dir)
        .fallback(ServeFile::new(format!("{}/index.html", static_dir)));

    let state = AppState {
        db: db_state,
        secrets: secret_state,
        tunnels: tunnel_state,
    };

    Router::new()
        .route("/api/db/connect", post(handle_connect))
        .route("/api/db/query", post(handle_query))
        .route("/api/db/execute", post(handle_execute))
        .route("/api/db/test", post(handle_test))
        .route("/api/db/disconnect", post(handle_disconnect))
        .route("/api/db/transaction", post(handle_transaction))
        .route("/api/db/stream", get(handle_stream))
        .route("/api/secrets", post(handle_set_secret))
        .route("/api/secrets/{key}", get(handle_get_secret))
        .route("/api/secrets/{key}", delete(handle_delete_secret))
        .route("/api/ssh/tunnel", post(handle_create_tunnel))
        .route("/api/ssh/tunnel/{tunnel_id}", delete(handle_close_tunnel))
        .route("/api/ssh/tunnel/{tunnel_id}/status", get(handle_tunnel_status))
        .route("/api/ssh/tunnels", get(handle_list_tunnels))
        .route("/api/git/clone", post(handle_git_clone))
        .route("/api/git/init", post(handle_git_init))
        .route("/api/git/pull", post(handle_git_pull))
        .route("/api/git/push", post(handle_git_push))
        .route("/api/git/status", get(handle_git_status))
        .route("/api/git/commit", post(handle_git_commit))
        .route("/api/git/stage", post(handle_git_stage))
        .route("/api/git/discard", post(handle_git_discard))
        .route("/api/git/resolve", post(handle_git_resolve))
        .route("/api/git/conflict", get(handle_git_conflict))
        .route("/api/git/remote", post(handle_git_set_remote))
        .route("/api/git/remote-url", get(handle_git_remote_url))
        .layer(CorsLayer::permissive())
        .fallback_service(serve_dir)
        .with_state(state)
}

pub async fn run_server() {
    let bind_addr =
        std::env::var("SEAQUEL_BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:3000".to_string());

    let state = Arc::new(ConnectionManager::new());
    let secrets = Arc::new(SecretStore::new());
    let tunnels = Arc::new(TunnelManager::new());
    let app = build_router(state, secrets, tunnels);

    let listener = tokio::net::TcpListener::bind(&bind_addr)
        .await
        .unwrap_or_else(|e| panic!("Failed to bind to {}: {}", bind_addr, e));

    log::info!("seaquel-server listening on {}", bind_addr);

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("server error");
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("failed to install Ctrl-C handler");
    log::info!("shutdown signal received");
}
