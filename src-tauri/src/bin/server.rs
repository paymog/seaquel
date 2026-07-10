use std::sync::Arc;

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};

use seaquel_lib::db::{
    duckdb::DuckdbDriver, mssql::MssqlDriver, mysql::MysqlDriver, postgres::PostgresDriver,
    sqlite::SqliteDriver, BatchStatement, ConnectConfig, ConnectResult, ConnectionManager, DbError,
    Driver, DriverType, ExecuteResult, QueryResult,
};

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
        .insert(connection_id.clone(), driver);

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

/// Placeholder — WebSocket streaming is implemented in issue #8.
async fn handle_stream() -> Response {
    (
        StatusCode::UPGRADE_REQUIRED,
        "WebSocket streaming not yet implemented; see issue #8",
    )
        .into_response()
}

// ── Router builder (exposed for tests) ───────────────────────────────────────

pub fn build_router(state: Arc<ConnectionManager>) -> Router {
    let static_dir =
        std::env::var("SEAQUEL_STATIC_DIR").unwrap_or_else(|_| "./static".to_string());

    let serve_dir = ServeDir::new(&static_dir)
        .fallback(ServeFile::new(format!("{}/index.html", static_dir)));

    Router::new()
        .route("/api/db/connect", post(handle_connect))
        .route("/api/db/query", post(handle_query))
        .route("/api/db/execute", post(handle_execute))
        .route("/api/db/test", post(handle_test))
        .route("/api/db/disconnect", post(handle_disconnect))
        .route("/api/db/transaction", post(handle_transaction))
        .route("/api/db/stream", post(handle_stream))
        .layer(CorsLayer::permissive())
        .fallback_service(serve_dir)
        .with_state(state)
}

pub async fn run_server() {
    let bind_addr =
        std::env::var("SEAQUEL_BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:3000".to_string());

    let state = Arc::new(ConnectionManager::new());
    let app = build_router(state);

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

#[tokio::main]
async fn main() {
    env_logger::init();
    run_server().await;
}
