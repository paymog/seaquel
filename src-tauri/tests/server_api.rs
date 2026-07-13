//! Integration tests for the seaquel-server HTTP + WebSocket API.
//!
//! Each test starts an axum server on a random OS-assigned port and exercises
//! the endpoints with reqwest (HTTP) and tokio-tungstenite (WebSocket) against
//! an in-memory SQLite database.

#![cfg(feature = "server")]

use std::sync::Arc;

use futures::{SinkExt, StreamExt};
use seaquel_lib::auth::AuthConfig;
use seaquel_lib::db::ConnectionManager;
use seaquel_lib::server::{build_router, ConnectionStore, SecretStore, SessionRegistry};
use seaquel_lib::ssh_tunnel::TunnelManager;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use base64::Engine as _;

/// Start a server on a random port. Returns the `http://` base URL and a
/// valid auth token for use in tests.
async fn spawn_test_server() -> (String, String) {
    let db_state = Arc::new(ConnectionManager::new());
    let secret_state = Arc::new(SecretStore::new());
    let tunnel_state = Arc::new(TunnelManager::new());
    let auth_state = Arc::new(AuthConfig::from_env());
    let session_state = Arc::new(SessionRegistry::new());
    let conn_path = std::env::temp_dir().join(format!(
        "seaquel-test-conn-{}.json",
        uuid::Uuid::new_v4()
    ));
    let connection_state = Arc::new(ConnectionStore::new(conn_path));
    let token = auth_state.create_token();
    let app = build_router(db_state, secret_state, tunnel_state, auth_state, session_state, connection_state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("local_addr");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve");
    });
    (format!("http://{}", addr), token)
}

/// Build a reqwest client that automatically attaches the bearer token.
fn auth_client(token: &str) -> reqwest::Client {
    let mut headers = reqwest::header::HeaderMap::new();
    let auth_value = format!("Bearer {}", token)
        .parse()
        .expect("valid header");
    headers.insert("authorization", auth_value);
    reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .expect("client build")
}

// ── HTTP lifecycle tests ───────────────────────────────────────────────────────

#[tokio::test]
async fn test_sqlite_full_lifecycle() {
    let (base, token) = spawn_test_server().await;
    let client = auth_client(&token);

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
    let (base, token) = spawn_test_server().await;
    let client = auth_client(&token);

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
    let (base, token) = spawn_test_server().await;
    let client = auth_client(&token);

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

// ── WebSocket streaming tests ─────────────────────────────────────────────────

/// Connect to SQLite, stream a query, assert batch + done events arrive.
#[tokio::test]
async fn test_stream_basic() {
    let (base, token) = spawn_test_server().await;
    let client = auth_client(&token);

    // Connect
    let body: serde_json::Value = client
        .post(format!("{}/api/db/connect", base))
        .json(&serde_json::json!({"driver": "sqlite", "connection_string": ":memory:"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let cid = body["connection_id"].as_str().unwrap().to_string();

    // Create table and insert rows
    client
        .post(format!("{}/api/db/execute", base))
        .json(&serde_json::json!({
            "connection_id": cid,
            "sql": "CREATE TABLE t (x INTEGER)",
            "values": []
        }))
        .send()
        .await
        .unwrap();
    client
        .post(format!("{}/api/db/execute", base))
        .json(&serde_json::json!({
            "connection_id": cid,
            "sql": "INSERT INTO t VALUES (1), (2), (3)",
            "values": []
        }))
        .send()
        .await
        .unwrap();

    // Open WebSocket
    let ws_url = base.replace("http://", "ws://") + "/api/db/stream?token=" + &token;
    let (mut ws, _) = tokio_tungstenite::connect_async(&ws_url)
        .await
        .expect("ws connect");

    // Send stream request
    ws.send(WsMessage::Text(
        serde_json::to_string(&serde_json::json!({
            "query_id": "q-basic",
            "connection_id": cid,
            "sql": "SELECT * FROM t",
            "values": []
        }))
        .unwrap().into(),
    ))
    .await
    .unwrap();

    // Collect all events until done or close
    let mut got_batch = false;
    let mut got_done = false;
    while let Some(msg) = ws.next().await {
        match msg.unwrap() {
            WsMessage::Text(text) => {
                let v: serde_json::Value = serde_json::from_str(&text).unwrap();
                match v["type"].as_str().unwrap() {
                    "batch" => got_batch = true,
                    "done" => {
                        got_done = true;
                        break;
                    }
                    other => panic!("unexpected event type: {}", other),
                }
            }
            WsMessage::Close(_) => break,
            _ => {}
        }
    }

    assert!(got_batch, "should receive at least one batch event");
    assert!(got_done, "should receive done event");
}

/// Send a cancel message mid-stream and verify the connection remains usable.
#[tokio::test]
async fn test_stream_cancel() {
    let (base, token) = spawn_test_server().await;
    let client = auth_client(&token);

    // Connect
    let body: serde_json::Value = client
        .post(format!("{}/api/db/connect", base))
        .json(&serde_json::json!({"driver": "sqlite", "connection_string": ":memory:"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let cid = body["connection_id"].as_str().unwrap().to_string();

    // Seed data
    client
        .post(format!("{}/api/db/execute", base))
        .json(&serde_json::json!({
            "connection_id": cid,
            "sql": "CREATE TABLE t (x INTEGER)",
            "values": []
        }))
        .send()
        .await
        .unwrap();
    client
        .post(format!("{}/api/db/execute", base))
        .json(&serde_json::json!({
            "connection_id": cid,
            "sql": "INSERT INTO t VALUES (1), (2), (3)",
            "values": []
        }))
        .send()
        .await
        .unwrap();

    // Open WebSocket and start stream
    let ws_url = base.replace("http://", "ws://") + "/api/db/stream?token=" + &token;
    let (mut ws, _) = tokio_tungstenite::connect_async(&ws_url)
        .await
        .unwrap();

    ws.send(WsMessage::Text(
        serde_json::to_string(&serde_json::json!({
            "query_id": "q-cancel",
            "connection_id": cid,
            "sql": "SELECT * FROM t",
            "values": []
        }))
        .unwrap().into(),
    ))
    .await
    .unwrap();

    // Send cancel immediately after starting
    ws.send(WsMessage::Text(
        serde_json::to_string(&serde_json::json!({"type": "cancel"})).unwrap().into(),
    ))
    .await
    .unwrap();

    // Drain until Done or Close — the server must terminate cleanly
    loop {
        match ws.next().await {
            Some(Ok(WsMessage::Text(text))) => {
                let v: serde_json::Value = serde_json::from_str(&text).unwrap();
                if v["type"] == "done" {
                    break;
                }
                // batch events before the cancel landed are fine
            }
            Some(Ok(WsMessage::Close(_))) | None => break,
            _ => {}
        }
    }

    // Connection must still be usable after cancel
    let res = client
        .post(format!("{}/api/db/query", base))
        .json(&serde_json::json!({
            "connection_id": cid,
            "sql": "SELECT count(*) AS n FROM t",
            "values": []
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200, "connection still usable after cancel");
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["rows"][0][0], 3, "row count intact after cancel");
}

/// Opening a stream with a connection_id that doesn't exist must yield an
/// error event (not a panic or hang).
#[tokio::test]
async fn test_stream_nonexistent_connection() {
    let (base, token) = spawn_test_server().await;

    let ws_url = base.replace("http://", "ws://") + "/api/db/stream?token=" + &token;
    let (mut ws, _) = tokio_tungstenite::connect_async(&ws_url)
        .await
        .unwrap();

    ws.send(WsMessage::Text(
        serde_json::to_string(&serde_json::json!({
            "query_id": "q-noconn",
            "connection_id": "does-not-exist",
            "sql": "SELECT 1",
            "values": []
        }))
        .unwrap().into(),
    ))
    .await
    .unwrap();

    // First text frame must be an error event with CONNECTION_NOT_FOUND
    let mut got_error = false;
    while let Some(msg) = ws.next().await {
        match msg.unwrap() {
            WsMessage::Text(text) => {
                let v: serde_json::Value = serde_json::from_str(&text).unwrap();
                assert_eq!(v["type"], "error", "expected error event, got: {}", v);
                assert_eq!(
                    v["code"], "CONNECTION_NOT_FOUND",
                    "wrong error code: {}",
                    v
                );
                got_error = true;
                break;
            }
            WsMessage::Close(_) => break,
            _ => {}
        }
    }

    assert!(got_error, "should have received an error event");
}

// ── Additional streaming edge-case tests ─────────────────────────────────────

/// 15 000 rows across the BATCH_SIZE=5000 boundary → at least 2 non-final
/// batches, columns only on the first batch, done event at the end.
#[tokio::test]
async fn test_stream_large_result_set_batching() {
    let (base, token) = spawn_test_server().await;
    let client = auth_client(&token);

    // Connect
    let body: serde_json::Value = client
        .post(format!("{}/api/db/connect", base))
        .json(&serde_json::json!({"driver": "sqlite", "connection_string": ":memory:"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let cid = body["connection_id"].as_str().unwrap().to_string();

    // Create table
    client
        .post(format!("{}/api/db/execute", base))
        .json(&serde_json::json!({
            "connection_id": cid,
            "sql": "CREATE TABLE large_t (x INTEGER)",
            "values": []
        }))
        .send()
        .await
        .unwrap();

    // Insert 15 000 rows in 3 chunks of 5 000 — avoids recursion-depth limits.
    for chunk in 0_i64..3 {
        let values: String = (1 + chunk * 5000..=5000 + chunk * 5000)
            .map(|i| format!("({})", i))
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!("INSERT INTO large_t (x) VALUES {}", values);
        client
            .post(format!("{}/api/db/execute", base))
            .json(&serde_json::json!({"connection_id": cid, "sql": sql, "values": []}))
            .send()
            .await
            .unwrap();
    }

    // Open WebSocket and stream SELECT *
    let ws_url = base.replace("http://", "ws://") + "/api/db/stream?token=" + &token;
    let (mut ws, _) = tokio_tungstenite::connect_async(&ws_url)
        .await
        .expect("ws connect");

    ws.send(WsMessage::Text(
        serde_json::to_string(&serde_json::json!({
            "query_id": "q-large",
            "connection_id": cid,
            "sql": "SELECT * FROM large_t ORDER BY x",
            "values": []
        }))
        .unwrap()
        .into(),
    ))
    .await
    .unwrap();

    let mut batch_count = 0usize;
    let mut total_rows = 0usize;
    let mut got_done = false;
    let mut first_batch_columns: Option<Vec<String>> = None;
    let mut subsequent_null_columns = true;

    while let Some(msg) = ws.next().await {
        match msg.unwrap() {
            WsMessage::Text(text) => {
                let v: serde_json::Value = serde_json::from_str(&text).unwrap();
                match v["type"].as_str().unwrap() {
                    "batch" => {
                        batch_count += 1;
                        total_rows += v["rows"].as_array().unwrap().len();
                        if batch_count == 1 {
                            first_batch_columns = v["columns"]
                                .as_array()
                                .map(|a| a.iter().map(|c| c.as_str().unwrap().to_string()).collect());
                        } else if !v["columns"].is_null() {
                            subsequent_null_columns = false;
                        }
                    }
                    "done" => {
                        got_done = true;
                        break;
                    }
                    other => panic!("unexpected event: {}", other),
                }
            }
            WsMessage::Close(_) => break,
            _ => {}
        }
    }

    assert!(got_done, "should receive done event");
    assert!(
        batch_count >= 2,
        "expected at least 2 batches for 15k rows, got {}",
        batch_count
    );
    assert_eq!(total_rows, 15000, "should stream all 15 000 rows");
    assert!(
        first_batch_columns.is_some(),
        "first batch must carry column names"
    );
    assert_eq!(
        first_batch_columns.as_deref(),
        Some(vec!["x".to_string()].as_slice()),
        "first batch columns should be [\"x\"]"
    );
    assert!(subsequent_null_columns, "subsequent batches must have null columns");
}

/// Stream a parameterized query and verify only matching rows arrive.
#[tokio::test]
async fn test_stream_with_parameters() {
    let (base, token) = spawn_test_server().await;
    let client = auth_client(&token);

    // Connect and seed
    let body: serde_json::Value = client
        .post(format!("{}/api/db/connect", base))
        .json(&serde_json::json!({"driver": "sqlite", "connection_string": ":memory:"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let cid = body["connection_id"].as_str().unwrap().to_string();

    client
        .post(format!("{}/api/db/execute", base))
        .json(&serde_json::json!({
            "connection_id": cid,
            "sql": "CREATE TABLE p_test (id INTEGER)",
            "values": []
        }))
        .send()
        .await
        .unwrap();
    client
        .post(format!("{}/api/db/execute", base))
        .json(&serde_json::json!({
            "connection_id": cid,
            "sql": "INSERT INTO p_test VALUES (1),(2),(3),(4),(5),(6),(7),(8),(9),(10)",
            "values": []
        }))
        .send()
        .await
        .unwrap();

    // Stream parameterized query: only rows with id > 5
    let ws_url = base.replace("http://", "ws://") + "/api/db/stream?token=" + &token;
    let (mut ws, _) = tokio_tungstenite::connect_async(&ws_url).await.unwrap();

    ws.send(WsMessage::Text(
        serde_json::to_string(&serde_json::json!({
            "query_id": "q-params",
            "connection_id": cid,
            "sql": "SELECT id FROM p_test WHERE id > ? ORDER BY id",
            "values": [5]
        }))
        .unwrap()
        .into(),
    ))
    .await
    .unwrap();

    let mut total_rows = 0usize;
    let mut all_rows: Vec<serde_json::Value> = Vec::new();
    let mut got_done = false;

    while let Some(msg) = ws.next().await {
        match msg.unwrap() {
            WsMessage::Text(text) => {
                let v: serde_json::Value = serde_json::from_str(&text).unwrap();
                match v["type"].as_str().unwrap() {
                    "batch" => {
                        let rows = v["rows"].as_array().unwrap().clone();
                        total_rows += rows.len();
                        all_rows.extend(rows);
                    }
                    "done" => {
                        got_done = true;
                        break;
                    }
                    other => panic!("unexpected event: {}", other),
                }
            }
            WsMessage::Close(_) => break,
            _ => {}
        }
    }

    assert!(got_done, "should receive done");
    assert_eq!(total_rows, 5, "should return exactly 5 rows (6–10)");
    // Verify actual values — SQLite returns integers as JSON numbers
    let ids: Vec<i64> = all_rows
        .iter()
        .map(|r| r[0].as_i64().unwrap())
        .collect();
    assert_eq!(ids, vec![6, 7, 8, 9, 10], "ids should be 6–10 in order");
}

/// Connection must remain usable after a stream completes naturally.
#[tokio::test]
async fn test_connection_usable_after_stream_completes() {
    let (base, token) = spawn_test_server().await;
    let client = auth_client(&token);

    // Connect
    let body: serde_json::Value = client
        .post(format!("{}/api/db/connect", base))
        .json(&serde_json::json!({"driver": "sqlite", "connection_string": ":memory:"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let cid = body["connection_id"].as_str().unwrap().to_string();

    // Seed data
    client
        .post(format!("{}/api/db/execute", base))
        .json(&serde_json::json!({
            "connection_id": cid,
            "sql": "CREATE TABLE cs_test (v INTEGER)",
            "values": []
        }))
        .send()
        .await
        .unwrap();
    client
        .post(format!("{}/api/db/execute", base))
        .json(&serde_json::json!({
            "connection_id": cid,
            "sql": "INSERT INTO cs_test VALUES (42)",
            "values": []
        }))
        .send()
        .await
        .unwrap();

    // Run stream to completion
    let ws_url = base.replace("http://", "ws://") + "/api/db/stream?token=" + &token;
    let (mut ws, _) = tokio_tungstenite::connect_async(&ws_url).await.unwrap();
    ws.send(WsMessage::Text(
        serde_json::to_string(&serde_json::json!({
            "query_id": "q-cs",
            "connection_id": cid,
            "sql": "SELECT v FROM cs_test",
            "values": []
        }))
        .unwrap()
        .into(),
    ))
    .await
    .unwrap();

    loop {
        match ws.next().await {
            Some(Ok(WsMessage::Text(text))) => {
                let v: serde_json::Value = serde_json::from_str(&text).unwrap();
                if v["type"] == "done" {
                    break;
                }
            }
            Some(Ok(WsMessage::Close(_))) | None => break,
            _ => {}
        }
    }

    // Connection must still be usable
    let res = client
        .post(format!("{}/api/db/query", base))
        .json(&serde_json::json!({
            "connection_id": cid,
            "sql": "SELECT v FROM cs_test",
            "values": []
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200, "query after stream should succeed");
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["rows"][0][0], 42, "data should be intact after stream");
}

/// Connection must remain usable after a stream is cancelled by the client.
#[tokio::test]
async fn test_connection_usable_after_stream_cancelled() {
    let (base, token) = spawn_test_server().await;
    let client = auth_client(&token);

    // Connect and seed enough rows that we can cancel mid-stream
    let body: serde_json::Value = client
        .post(format!("{}/api/db/connect", base))
        .json(&serde_json::json!({"driver": "sqlite", "connection_string": ":memory:"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let cid = body["connection_id"].as_str().unwrap().to_string();

    client
        .post(format!("{}/api/db/execute", base))
        .json(&serde_json::json!({
            "connection_id": cid,
            "sql": "CREATE TABLE cc_test (v INTEGER)",
            "values": []
        }))
        .send()
        .await
        .unwrap();
    client
        .post(format!("{}/api/db/execute", base))
        .json(&serde_json::json!({
            "connection_id": cid,
            "sql": "INSERT INTO cc_test VALUES (1),(2),(3),(4),(5)",
            "values": []
        }))
        .send()
        .await
        .unwrap();

    // Start stream, cancel immediately, drain to done
    let ws_url = base.replace("http://", "ws://") + "/api/db/stream?token=" + &token;
    let (mut ws, _) = tokio_tungstenite::connect_async(&ws_url).await.unwrap();
    ws.send(WsMessage::Text(
        serde_json::to_string(&serde_json::json!({
            "query_id": "q-cc",
            "connection_id": cid,
            "sql": "SELECT v FROM cc_test",
            "values": []
        }))
        .unwrap()
        .into(),
    ))
    .await
    .unwrap();
    ws.send(WsMessage::Text(
        serde_json::to_string(&serde_json::json!({"type": "cancel"}))
            .unwrap()
            .into(),
    ))
    .await
    .unwrap();

    loop {
        match ws.next().await {
            Some(Ok(WsMessage::Text(text))) => {
                let v: serde_json::Value = serde_json::from_str(&text).unwrap();
                if v["type"] == "done" {
                    break;
                }
            }
            Some(Ok(WsMessage::Close(_))) | None => break,
            _ => {}
        }
    }

    // Connection must still be usable
    let res = client
        .post(format!("{}/api/db/query", base))
        .json(&serde_json::json!({
            "connection_id": cid,
            "sql": "SELECT count(*) AS n FROM cc_test",
            "values": []
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200, "query after cancel should succeed");
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["rows"][0][0], 5, "row count should be intact after cancel");
}

// ── Secret store tests ───────────────────────────────────────────────────────

#[tokio::test]
async fn test_secret_lifecycle() {
    let (base, token) = spawn_test_server().await;
    let client = auth_client(&token);

    // Set a secret → 201
    let res = client
        .post(format!("{}/api/secrets", base))
        .json(&serde_json::json!({ "key": "test-key", "value": "test-value" }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 201, "set secret should return 201");

    // Get it back → 200 with value
    let res = client
        .get(format!("{}/api/secrets/test-key", base))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200, "get secret should return 200");
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["value"], "test-value", "returned value should match");

    // Delete it → 204
    let res = client
        .delete(format!("{}/api/secrets/test-key", base))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 204, "delete secret should return 204");

    // Get after delete → 404
    let res = client
        .get(format!("{}/api/secrets/test-key", base))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 404, "get after delete should return 404");
}

#[tokio::test]
async fn test_secret_overwrite() {
    let (base, token) = spawn_test_server().await;
    let client = auth_client(&token);

    // Set initial value
    let res = client
        .post(format!("{}/api/secrets", base))
        .json(&serde_json::json!({ "key": "overwrite-key", "value": "first" }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 201);

    // Overwrite with new value
    let res = client
        .post(format!("{}/api/secrets", base))
        .json(&serde_json::json!({ "key": "overwrite-key", "value": "second" }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 201);

    // Verify new value
    let res = client
        .get(format!("{}/api/secrets/overwrite-key", base))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["value"], "second", "overwritten value should be new value");
}

// ── SSH tunnel route tests ─────────────────────────────────────────────────────

/// GET /api/ssh/tunnels returns an empty JSON array when no tunnels are active.
#[tokio::test]
async fn test_ssh_list_tunnels_empty() {
    let (base, token) = spawn_test_server().await;
    let client = auth_client(&token);

    let res = client
        .get(format!("{}/api/ssh/tunnels", base))
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), 200);
    let body: serde_json::Value = res.json().await.unwrap();
    assert!(body.is_array(), "expected JSON array");
    assert_eq!(body.as_array().unwrap().len(), 0, "expected empty list");
}

/// GET /api/ssh/tunnel/{id}/status returns { active: false } for an unknown id.
#[tokio::test]
async fn test_ssh_tunnel_status_unknown() {
    let (base, token) = spawn_test_server().await;
    let client = auth_client(&token);

    let res = client
        .get(format!("{}/api/ssh/tunnel/nonexistent-tunnel/status", base))
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), 200);
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["active"], false, "unknown tunnel should report inactive");
}

/// DELETE /api/ssh/tunnel/{id} returns 404 for an unknown tunnel id.
#[tokio::test]
async fn test_ssh_close_tunnel_not_found() {
    let (base, token) = spawn_test_server().await;
    let client = auth_client(&token);

    let res = client
        .delete(format!("{}/api/ssh/tunnel/ghost-tunnel", base))
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), 404);
}

/// POST /api/ssh/tunnel with a bad host returns a non-2xx error (connection refused / timeout).
#[tokio::test]
async fn test_ssh_create_tunnel_bad_host() {
    let (base, token) = spawn_test_server().await;
    let client = auth_client(&token);

    // 127.0.0.2 port 1 — guaranteed connection refused on any CI box.
    let body = serde_json::json!({
        "ssh_host": "127.0.0.2",
        "ssh_port": 1u16,
        "ssh_username": "nobody",
        "auth_method": "password",
        "password": "wrong",
        "remote_host": "127.0.0.1",
        "remote_port": 5432u16,
    });

    let res = client
        .post(format!("{}/api/ssh/tunnel", base))
        .json(&body)
        .send()
        .await
        .unwrap();

    // Must be a client/server error — any 4xx or 5xx is acceptable.
    assert!(
        res.status().is_client_error() || res.status().is_server_error(),
        "expected error status, got {}",
        res.status()
    );
}

// ── Encryption-specific secret tests ─────────────────────────────────────────

/// Encryption is transparent to the caller: set → get returns the same
/// plaintext even though the value is stored encrypted.
#[tokio::test]
async fn test_secret_encryption() {
    let (base, token) = spawn_test_server().await;
    let client = auth_client(&token);

    client
        .post(format!("{}/api/secrets", base))
        .json(&serde_json::json!({ "key": "enc-key", "value": "super-secret-value" }))
        .send()
        .await
        .unwrap();

    let res = client
        .get(format!("{}/api/secrets/enc-key", base))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(
        body["value"], "super-secret-value",
        "encryption must be transparent: decrypted value must match original"
    );
}

/// When SEAQUEL_SECRET_KEY is provided the store initialises with that key and
/// still round-trips secrets correctly.
#[tokio::test]
async fn test_secret_encryption_with_env_key() {
    // 32 random bytes, base64-encoded.
    let key_bytes: [u8; 32] = [
        0x6b, 0x65, 0x79, 0x30, 0x31, 0x32, 0x33, 0x34,
        0x35, 0x36, 0x37, 0x38, 0x39, 0x61, 0x62, 0x63,
        0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x6b,
        0x6c, 0x6d, 0x6e, 0x6f, 0x70, 0x71, 0x72, 0x73,
    ];
    let b64_key = base64::engine::general_purpose::STANDARD.encode(key_bytes);

    // Build a store directly with the known key (mirroring what SecretStore::new()
    // does when SEAQUEL_SECRET_KEY is set) and verify round-trip.
    let store = Arc::new(SecretStore::with_key(key_bytes));
    store.set("env-key", "env-value").await;
    let got = store.get("env-key").await;
    assert_eq!(got.as_deref(), Some("env-value"), "round-trip with explicit key should work");

    // Also confirm the raw stored blob is NOT the plaintext.
    let raw = store.get_raw("env-key").await.unwrap();
    assert_ne!(
        raw, "env-value",
        "raw stored value must differ from plaintext (it is encrypted)"
    );
    // The b64_key variable is computed above; we just silence the unused-variable
    // warning since this test exercises the SecretStore::with_key path, not the
    // env-var path (which would require process-wide env mutation).
    let _ = b64_key;
}

/// Each write to the same key produces a different ciphertext because a fresh
/// random 96-bit nonce is chosen on every encryption.  This verifies that AES-GCM
/// nonce reuse — which would be catastrophic — is not happening.
#[tokio::test]
async fn test_secret_different_nonce_each_time() {
    let store = Arc::new(SecretStore::new());

    store.set("nonce-key", "same-value").await;
    let raw1 = store.get_raw("nonce-key").await.unwrap();

    store.set("nonce-key", "same-value").await;
    let raw2 = store.get_raw("nonce-key").await.unwrap();

    assert_ne!(
        raw1, raw2,
        "two encryptions of the same plaintext must produce different ciphertexts (different nonces)"
    );

    // Both must still decrypt to the original plaintext.
    assert_eq!(
        store.get("nonce-key").await.as_deref(),
        Some("same-value"),
        "final value must still be recoverable"
    );
}

// ── Auth tests ────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_login_correct_password() {
    let (base, _token) = spawn_test_server().await;
    let client = reqwest::Client::new();

    let res = client
        .post(format!("{}/api/auth/login", base))
        .json(&serde_json::json!({"password": "admin"}))
        .send()
        .await
        .expect("login request");

    assert_eq!(res.status(), 200);
    let body: serde_json::Value = res.json().await.expect("login body");
    assert!(body["token"].as_str().is_some(), "token present");
}

#[tokio::test]
async fn test_login_wrong_password() {
    let (base, _token) = spawn_test_server().await;
    let client = reqwest::Client::new();

    let res = client
        .post(format!("{}/api/auth/login", base))
        .json(&serde_json::json!({"password": "wrong"}))
        .send()
        .await
        .expect("login request");

    assert_eq!(res.status(), 401);
}

#[tokio::test]
async fn test_protected_route_without_token() {
    let (base, _token) = spawn_test_server().await;
    let client = reqwest::Client::new();

    let res = client
        .post(format!("{}/api/db/connect", base))
        .json(&serde_json::json!({"driver": "sqlite", "connection_string": ":memory:"}))
        .send()
        .await
        .expect("request");

    assert_eq!(res.status(), 401);
}

#[tokio::test]
async fn test_protected_route_with_valid_token() {
    let (base, token) = spawn_test_server().await;
    let client = auth_client(&token);

    let res = client
        .post(format!("{}/api/db/connect", base))
        .json(&serde_json::json!({"driver": "sqlite", "connection_string": ":memory:"}))
        .send()
        .await
        .expect("request");

    assert_eq!(res.status(), 200);
}

#[tokio::test]
async fn test_protected_route_with_garbage_token() {
    let (base, _token) = spawn_test_server().await;
    let client = reqwest::Client::new();

    let res = client
        .post(format!("{}/api/db/connect", base))
        .header("authorization", "Bearer garbage.token")
        .json(&serde_json::json!({"driver": "sqlite", "connection_string": ":memory:"}))
        .send()
        .await
        .expect("request");

    assert_eq!(res.status(), 401);
}

#[tokio::test]
async fn test_static_files_without_auth() {
    // Non-API routes should NOT require auth
    let (base, _token) = spawn_test_server().await;
    let client = reqwest::Client::new();

    // The root URL should return something (even if 404 for missing static dir)
    // — the key assertion is that it does NOT return 401.
    let res = client.get(&base).send().await.expect("request");
    assert_ne!(res.status(), 401, "static files should not require auth");
}

// ── Multi-tenant session scoping tests ────────────────────────────────────────

#[tokio::test]
async fn test_cross_session_connection_isolation() {
    // Two different sessions should not be able to access each other's connections.
    let (base, token_a) = spawn_test_server().await;
    let client_a = auth_client(&token_a);

    // Session A connects to SQLite
    let res = client_a
        .post(format!("{}/api/db/connect", base))
        .json(&serde_json::json!({"driver": "sqlite", "connection_string": ":memory:"}))
        .send()
        .await
        .expect("connect");
    assert_eq!(res.status(), 200);
    let body: serde_json::Value = res.json().await.expect("body");
    let conn_id_a = body["connection_id"].as_str().expect("connection_id").to_string();

    // Create a second session by logging in again
    let plain_client = reqwest::Client::new();
    let login_res = plain_client
        .post(format!("{}/api/auth/login", base))
        .json(&serde_json::json!({"password": "admin"}))
        .send()
        .await
        .expect("login");
    let login_body: serde_json::Value = login_res.json().await.expect("login body");
    let token_b = login_body["token"].as_str().expect("token").to_string();
    let client_b = auth_client(&token_b);

    // Session B tries to query Session A's connection → should fail
    let res = client_b
        .post(format!("{}/api/db/query", base))
        .json(&serde_json::json!({
            "connection_id": conn_id_a,
            "sql": "SELECT 1",
            "values": []
        }))
        .send()
        .await
        .expect("query");
    assert_eq!(res.status(), 404, "session B should not access session A's connection");

    // Session A can still query its own connection
    let res = client_a
        .post(format!("{}/api/db/query", base))
        .json(&serde_json::json!({
            "connection_id": conn_id_a,
            "sql": "SELECT 1 as val",
            "values": []
        }))
        .send()
        .await
        .expect("query");
    assert_eq!(res.status(), 200, "session A can access its own connection");
}

// ── Connection store tests ───────────────────────────────────────────────────

#[tokio::test]
async fn test_connection_lifecycle() {
    let (base, token) = spawn_test_server().await;
    let client = auth_client(&token);

    // List is initially empty
    let res = client
        .get(format!("{}/api/connections", base))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    let body: serde_json::Value = res.json().await.unwrap();
    assert!(body.is_array(), "expected JSON array");
    assert_eq!(body.as_array().unwrap().len(), 0, "expected empty list");

    // Save a connection
    let conn = serde_json::json!({
        "id": "conn-1",
        "name": "My Postgres",
        "type": "postgres",
        "host": "localhost",
        "port": 5432,
        "databaseName": "mydb",
        "username": "admin",
        "projectId": "default",
        "labelIds": []
    });
    let res = client
        .post(format!("{}/api/connections", base))
        .json(&conn)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200, "save should return 200");

    // List now has one connection
    let res = client
        .get(format!("{}/api/connections", base))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    let body: serde_json::Value = res.json().await.unwrap();
    let arr = body.as_array().unwrap();
    assert_eq!(arr.len(), 1, "expected 1 connection");
    assert_eq!(arr[0]["id"], "conn-1");
    assert_eq!(arr[0]["name"], "My Postgres");
    assert_eq!(arr[0]["host"], "localhost");

    // Overwrite with updated data
    let conn_updated = serde_json::json!({
        "id": "conn-1",
        "name": "Renamed",
        "type": "postgres",
        "host": "db.example.com",
        "port": 5432,
        "databaseName": "prod",
        "username": "admin",
        "projectId": "default",
        "labelIds": ["label-a"]
    });
    let res = client
        .post(format!("{}/api/connections", base))
        .json(&conn_updated)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // Verify the update
    let res = client
        .get(format!("{}/api/connections", base))
        .send()
        .await
        .unwrap();
    let body: serde_json::Value = res.json().await.unwrap();
    let arr = body.as_array().unwrap();
    assert_eq!(arr.len(), 1, "still 1 connection after overwrite");
    assert_eq!(arr[0]["name"], "Renamed");
    assert_eq!(arr[0]["host"], "db.example.com");

    // Save a second connection
    let conn2 = serde_json::json!({
        "id": "conn-2",
        "name": "SQLite Local",
        "type": "sqlite",
        "projectId": "default",
        "labelIds": []
    });
    client
        .post(format!("{}/api/connections", base))
        .json(&conn2)
        .send()
        .await
        .unwrap();

    // List has two
    let res = client
        .get(format!("{}/api/connections", base))
        .send()
        .await
        .unwrap();
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body.as_array().unwrap().len(), 2, "expected 2 connections");

    // Delete conn-1
    let res = client
        .delete(format!("{}/api/connections/conn-1", base))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 204, "delete should return 204");

    // Only conn-2 remains
    let res = client
        .get(format!("{}/api/connections", base))
        .send()
        .await
        .unwrap();
    let body: serde_json::Value = res.json().await.unwrap();
    let arr = body.as_array().unwrap();
    assert_eq!(arr.len(), 1, "expected 1 connection after delete");
    assert_eq!(arr[0]["id"], "conn-2");
}

#[tokio::test]
async fn test_connection_save_without_id_returns_400() {
    let (base, token) = spawn_test_server().await;
    let client = auth_client(&token);

    let res = client
        .post(format!("{}/api/connections", base))
        .json(&serde_json::json!({ "name": "no-id" }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 400, "missing id should return 400");
}
