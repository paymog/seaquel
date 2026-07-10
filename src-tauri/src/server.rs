//! HTTP + WebSocket server — exposed as `seaquel_lib::server` so both the
//! binary and the integration tests can share `build_router` / `run_server`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
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

// ── Router builder ────────────────────────────────────────────────────────────

/// Build the application router.  Exposed `pub` so tests and the binary can
/// both call it without duplicating handler wiring.
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
        .route("/api/db/stream", get(handle_stream))
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
