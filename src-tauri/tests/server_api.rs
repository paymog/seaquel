//! Integration tests for the seaquel-server HTTP API.
//!
//! Each test starts an axum server on a random OS-assigned port and exercises
//! the endpoints with reqwest against an in-memory SQLite database.

#![cfg(feature = "server")]

use std::sync::Arc;

use seaquel_lib::db::ConnectionManager;

// Inline the router builder so we don't need the bin crate in scope.
// We reach into the server binary by declaring a module path.  Because
// `server.rs` is a `[[bin]]` target (not a library), the cleanest
// approach is to re-implement a small test harness that builds the
// same router by calling the public `build_router` function.
//
// Cargo compiles `tests/` against the *library* crate, so we cannot
// import `seaquel::bin::server` directly.  Instead we duplicate the
// minimal router setup here using the public library types.

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use tower_http::cors::CorsLayer;

use seaquel_lib::db::{
    duckdb::DuckdbDriver, mssql::MssqlDriver, mysql::MysqlDriver, postgres::PostgresDriver,
    sqlite::SqliteDriver, BatchStatement, ConnectConfig, ConnectResult, DbError, Driver,
    DriverType, ExecuteResult, QueryResult,
};

// ── Minimal duplicate of server's error/handler layer for tests ───────────────

struct ApiError(StatusCode, DbError);
impl From<DbError> for ApiError {
    fn from(e: DbError) -> Self {
        let s = match e.code.as_str() {
            "CONNECTION_NOT_FOUND" => StatusCode::NOT_FOUND,
            "CONNECTION_ERROR" | "QUERY_ERROR" | "EXECUTE_ERROR" => StatusCode::BAD_REQUEST,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        ApiError(s, e)
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(self.1)).into_response()
    }
}

async fn connect_driver_local(config: &ConnectConfig) -> Result<Box<dyn Driver>, DbError> {
    let driver: Box<dyn Driver> = match config.driver {
        DriverType::Postgres => Box::new(PostgresDriver::connect(config).await?),
        DriverType::Mysql => Box::new(MysqlDriver::connect(config).await?),
        DriverType::Sqlite => Box::new(SqliteDriver::connect(config).await?),
        DriverType::Mssql => Box::new(MssqlDriver::connect(config).await?),
        DriverType::Duckdb => Box::new(DuckdbDriver::connect(config)?),
    };
    Ok(driver)
}

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

async fn handle_connect(
    State(mgr): State<Arc<ConnectionManager>>,
    Json(cfg): Json<ConnectConfig>,
) -> Result<Json<ConnectResult>, ApiError> {
    let name = format!("{:?}", cfg.driver);
    let id = format!("{}-{}", name.to_lowercase(), uuid::Uuid::new_v4());
    let driver = connect_driver_local(&cfg).await?;
    mgr.connections.write().await.insert(id.clone(), driver);
    Ok(Json(ConnectResult { connection_id: id }))
}

async fn handle_query(
    State(mgr): State<Arc<ConnectionManager>>,
    Json(req): Json<QueryRequest>,
) -> Result<Json<QueryResult>, ApiError> {
    let conns = mgr.connections.read().await;
    let driver = conns
        .get(&req.connection_id)
        .ok_or_else(|| DbError::connection_not_found(&req.connection_id))?;
    Ok(Json(driver.query(&req.sql, req.values).await?))
}

async fn handle_execute(
    State(mgr): State<Arc<ConnectionManager>>,
    Json(req): Json<ExecuteRequest>,
) -> Result<Json<ExecuteResult>, ApiError> {
    let conns = mgr.connections.read().await;
    let driver = conns
        .get(&req.connection_id)
        .ok_or_else(|| DbError::connection_not_found(&req.connection_id))?;
    Ok(Json(driver.execute(&req.sql, req.values).await?))
}

async fn handle_disconnect(
    State(mgr): State<Arc<ConnectionManager>>,
    Json(req): Json<DisconnectRequest>,
) -> Result<Json<()>, ApiError> {
    let mut conns = mgr.connections.write().await;
    if let Some(d) = conns.remove(&req.connection_id) {
        d.close().await?;
    }
    Ok(Json(()))
}

async fn handle_transaction(
    State(mgr): State<Arc<ConnectionManager>>,
    Json(req): Json<TransactionRequest>,
) -> Result<Json<()>, ApiError> {
    let conns = mgr.connections.read().await;
    let driver = conns
        .get(&req.connection_id)
        .ok_or_else(|| DbError::connection_not_found(&req.connection_id))?;
    driver.transaction(req.statements).await?;
    Ok(Json(()))
}

fn test_router(state: Arc<ConnectionManager>) -> Router {
    Router::new()
        .route("/api/db/connect", post(handle_connect))
        .route("/api/db/query", post(handle_query))
        .route("/api/db/execute", post(handle_execute))
        .route("/api/db/disconnect", post(handle_disconnect))
        .route("/api/db/transaction", post(handle_transaction))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

/// Start a server on a random port. Returns the base URL.
async fn spawn_test_server() -> String {
    let state = Arc::new(ConnectionManager::new());
    let app = test_router(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("local_addr");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve");
    });
    format!("http://{}", addr)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_sqlite_full_lifecycle() {
    let base = spawn_test_server().await;
    let client = reqwest::Client::new();

    // 1. Connect
    let res = client
        .post(format!("{}/api/db/connect", base))
        .json(&serde_json::json!({
            "driver": "sqlite",
            "connection_string": ":memory:"
        }))
        .send()
        .await
        .expect("connect request");
    assert_eq!(res.status(), 200, "connect should succeed");
    let body: serde_json::Value = res.json().await.expect("connect body");
    let connection_id = body["connection_id"].as_str().expect("connection_id").to_string();
    assert!(connection_id.starts_with("sqlite-"), "connection_id prefixed");

    // 2. Create table
    let res = client
        .post(format!("{}/api/db/execute", base))
        .json(&serde_json::json!({
            "connection_id": connection_id,
            "sql": "CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)",
            "values": []
        }))
        .send()
        .await
        .expect("create table request");
    assert_eq!(res.status(), 200, "CREATE TABLE should succeed");

    // 3. Simple SELECT 1
    let res = client
        .post(format!("{}/api/db/query", base))
        .json(&serde_json::json!({
            "connection_id": connection_id,
            "sql": "SELECT 1 as val",
            "values": []
        }))
        .send()
        .await
        .expect("select 1 request");
    assert_eq!(res.status(), 200);
    let body: serde_json::Value = res.json().await.expect("select 1 body");
    assert_eq!(body["columns"], serde_json::json!(["val"]), "columns");
    assert_eq!(body["rows"][0][0], serde_json::json!(1), "row value");

    // 4. INSERT with params
    let res = client
        .post(format!("{}/api/db/execute", base))
        .json(&serde_json::json!({
            "connection_id": connection_id,
            "sql": "INSERT INTO test (name) VALUES (?)",
            "values": ["hello"]
        }))
        .send()
        .await
        .expect("insert request");
    assert_eq!(res.status(), 200, "INSERT should succeed");
    let body: serde_json::Value = res.json().await.expect("insert body");
    assert_eq!(body["rows_affected"], 1, "rows_affected");

    // 5. SELECT * FROM test
    let res = client
        .post(format!("{}/api/db/query", base))
        .json(&serde_json::json!({
            "connection_id": connection_id,
            "sql": "SELECT * FROM test",
            "values": []
        }))
        .send()
        .await
        .expect("select * request");
    assert_eq!(res.status(), 200);
    let body: serde_json::Value = res.json().await.expect("select * body");
    assert_eq!(body["rows"].as_array().unwrap().len(), 1, "one row");
    // columns: id, name
    let name_col = body["columns"]
        .as_array()
        .unwrap()
        .iter()
        .position(|c| c == "name")
        .expect("name column");
    assert_eq!(body["rows"][0][name_col], "hello", "name value");

    // 6. Disconnect
    let res = client
        .post(format!("{}/api/db/disconnect", base))
        .json(&serde_json::json!({ "connection_id": connection_id }))
        .send()
        .await
        .expect("disconnect request");
    assert_eq!(res.status(), 200, "disconnect should succeed");

    // 7. Query after disconnect → 404
    let res = client
        .post(format!("{}/api/db/query", base))
        .json(&serde_json::json!({
            "connection_id": connection_id,
            "sql": "SELECT 1",
            "values": []
        }))
        .send()
        .await
        .expect("query after disconnect");
    assert_eq!(res.status(), 404, "should be 404 after disconnect");
    let body: serde_json::Value = res.json().await.expect("error body");
    assert_eq!(body["code"], "CONNECTION_NOT_FOUND", "error code");
}

#[tokio::test]
async fn test_query_nonexistent_connection_returns_404() {
    let base = spawn_test_server().await;
    let client = reqwest::Client::new();

    let res = client
        .post(format!("{}/api/db/query", base))
        .json(&serde_json::json!({
            "connection_id": "does-not-exist",
            "sql": "SELECT 1",
            "values": []
        }))
        .send()
        .await
        .expect("request");
    assert_eq!(res.status(), 404);
    let body: serde_json::Value = res.json().await.expect("body");
    assert_eq!(body["code"], "CONNECTION_NOT_FOUND");
}

#[tokio::test]
async fn test_transaction() {
    let base = spawn_test_server().await;
    let client = reqwest::Client::new();

    // Connect
    let res = client
        .post(format!("{}/api/db/connect", base))
        .json(&serde_json::json!({
            "driver": "sqlite",
            "connection_string": ":memory:"
        }))
        .send()
        .await
        .expect("connect");
    let body: serde_json::Value = res.json().await.unwrap();
    let cid = body["connection_id"].as_str().unwrap().to_string();

    // Transaction: create + insert
    let res = client
        .post(format!("{}/api/db/transaction", base))
        .json(&serde_json::json!({
            "connection_id": cid,
            "statements": [
                { "sql": "CREATE TABLE tx_test (v TEXT)", "params": [] },
                { "sql": "INSERT INTO tx_test VALUES (?)", "params": ["row1"] }
            ]
        }))
        .send()
        .await
        .expect("transaction");
    assert_eq!(res.status(), 200, "transaction should succeed");

    // Verify insert
    let res = client
        .post(format!("{}/api/db/query", base))
        .json(&serde_json::json!({
            "connection_id": cid,
            "sql": "SELECT v FROM tx_test",
            "values": []
        }))
        .send()
        .await
        .expect("query");
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["rows"][0][0], "row1");
}
