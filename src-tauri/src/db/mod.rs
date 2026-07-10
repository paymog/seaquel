#[cfg(feature = "tauri")]
pub mod commands;
pub mod decode;
pub mod duckdb;
pub mod mssql;
pub mod mysql;
pub mod postgres;
pub mod sqlite;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Columnar result format for all drivers
#[derive(Debug, Serialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
}

/// A batch of rows emitted by a streaming query.
/// `columns` is Some on the first batch (so the frontend can render headers)
/// and None on subsequent batches. `is_final` marks the terminal batch, which
/// may carry zero rows.
#[derive(Debug, Serialize, Clone)]
pub struct StreamBatch {
    pub columns: Option<Vec<String>>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub is_final: bool,
}

/// Events sent back to the frontend through a streaming query's Channel.
/// Terminal events (`Done`, `Error`) are sent through the channel rather than
/// as a thrown invoke error so the JS side sees one unified termination path.
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StreamEvent {
    Batch(StreamBatch),
    Done,
    Error { message: String, code: String },
}

/// Result of a write operation
#[derive(Debug, Serialize)]
pub struct ExecuteResult {
    pub rows_affected: u64,
    pub last_insert_id: Option<i64>,
}

/// Result of a connect operation
#[derive(Debug, Serialize)]
pub struct ConnectResult {
    pub connection_id: String,
}

/// Unified error type for all drivers
#[derive(Debug, Serialize, Deserialize)]
pub struct DbError {
    pub message: String,
    pub code: String,
}

impl std::fmt::Display for DbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for DbError {}

impl DbError {
    pub fn connection_not_found(id: &str) -> Self {
        Self {
            message: format!("Connection not found: {}", id),
            code: "CONNECTION_NOT_FOUND".to_string(),
        }
    }

    pub fn connection_error(msg: impl std::fmt::Display) -> Self {
        Self {
            message: format!("Failed to connect: {}", msg),
            code: "CONNECTION_ERROR".to_string(),
        }
    }

    pub fn query_error(msg: impl std::fmt::Display) -> Self {
        Self {
            message: format!("Query failed: {}", msg),
            code: "QUERY_ERROR".to_string(),
        }
    }

    pub fn execute_error(msg: impl std::fmt::Display) -> Self {
        Self {
            message: format!("Execute failed: {}", msg),
            code: "EXECUTE_ERROR".to_string(),
        }
    }
}

/// Driver type discriminant
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum DriverType {
    Postgres,
    Mysql,
    Sqlite,
    Mssql,
    Duckdb,
}

/// Connection configuration — superset of all driver needs
#[derive(Debug, Deserialize)]
pub struct ConnectConfig {
    pub driver: DriverType,
    /// Connection string for sqlx-based drivers (postgres, mysql, sqlite)
    pub connection_string: Option<String>,
    /// Individual fields for MSSQL
    pub host: Option<String>,
    pub port: Option<u16>,
    pub database: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub encrypt: Option<bool>,
    pub trust_cert: Option<bool>,
    /// File path for DuckDB
    pub path: Option<String>,
}

/// A single statement in a batch/transaction
#[derive(Debug, Deserialize)]
pub struct BatchStatement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<serde_json::Value>,
}

/// Trait that all drivers implement
#[async_trait]
pub trait Driver: Send + Sync {
    async fn query(
        &self,
        sql: &str,
        params: Vec<serde_json::Value>,
    ) -> Result<QueryResult, DbError>;

    async fn execute(
        &self,
        sql: &str,
        params: Vec<serde_json::Value>,
    ) -> Result<ExecuteResult, DbError>;

    /// Execute multiple statements in a single transaction on one connection.
    /// Default implementation falls back to individual execute calls.
    async fn transaction(&self, statements: Vec<BatchStatement>) -> Result<(), DbError> {
        for stmt in statements {
            self.execute(&stmt.sql, stmt.params).await?;
        }
        Ok(())
    }

    /// Stream query results in batches. Drivers that can genuinely stream
    /// (the sqlx-based ones) override this. The default implementation runs
    /// the blocking `query()` and emits a single terminal batch, so DuckDB
    /// and MSSQL get a correct-but-non-streaming path for free.
    fn query_stream<'a>(
        &'a self,
        sql: String,
        params: Vec<serde_json::Value>,
    ) -> futures::stream::BoxStream<'a, Result<StreamBatch, DbError>> {
        Box::pin(async_stream::try_stream! {
            let result = self.query(&sql, params).await?;
            yield StreamBatch {
                columns: Some(result.columns),
                rows: result.rows,
                is_final: true,
            };
        })
    }

    async fn close(&self) -> Result<(), DbError>;
}

/// Macro to generate the common sqlx Driver implementation.
///
/// Each sqlx-based driver (Postgres, MySQL, SQLite) has near-identical
/// `bind_params`, `query`, `execute`, and `close` implementations.
/// The only differences are the sqlx database type, the arguments type,
/// the decode module, and how `last_insert_id` is extracted from the
/// execute result.
macro_rules! impl_sqlx_driver {
    (
        $driver_name:ident,
        $db:ty,
        $args:ty,
        decode_fn = $decode_fn:path,
        last_insert_id = $last_insert_id:expr
    ) => {
        fn bind_params<'q>(
            mut query: sqlx::query::Query<'q, $db, $args>,
            values: &'q [serde_json::Value],
        ) -> sqlx::query::Query<'q, $db, $args> {
            use serde_json::Value as JsonValue;
            for value in values {
                if value.is_null() {
                    query = query.bind(None::<JsonValue>);
                } else if let Some(b) = value.as_bool() {
                    // Bind JS booleans as native `bool`. sqlx encodes this as
                    // BOOLEAN for Postgres and as TINYINT 0/1 for MySQL/SQLite.
                    // Without this branch the fallback serializes to JSON text
                    // ("true"/"false") and MySQL rejects it for tinyint columns.
                    query = query.bind(b);
                } else if value.is_string() {
                    query = query.bind(value.as_str().unwrap().to_owned());
                } else if let Some(number) = value.as_number() {
                    query = query.bind(number.as_f64().unwrap_or_default());
                } else {
                    query = query.bind(value.clone());
                }
            }
            query
        }

        #[async_trait::async_trait]
        impl Driver for $driver_name {
            async fn query(
                &self,
                sql: &str,
                params: Vec<serde_json::Value>,
            ) -> Result<QueryResult, DbError> {
                use sqlx::{Column, Executor, Row};

                let query = sqlx::query(sql);
                let query = bind_params(query, &params);

                let rows = self
                    .pool
                    .fetch_all(query)
                    .await
                    .map_err(|e| DbError::query_error(e))?;

                let columns: Vec<String> = if let Some(first) = rows.first() {
                    first.columns().iter().map(|c| c.name().to_string()).collect()
                } else {
                    vec![]
                };

                let mut result_rows = Vec::with_capacity(rows.len());
                for row in &rows {
                    let mut values = Vec::with_capacity(columns.len());
                    for i in 0..row.columns().len() {
                        let v = row.try_get_raw(i).map_err(|e| DbError::query_error(e))?;
                        values.push($decode_fn(v)?);
                    }
                    result_rows.push(values);
                }

                Ok(QueryResult {
                    columns,
                    rows: result_rows,
                })
            }

            fn query_stream<'a>(
                &'a self,
                sql: String,
                params: Vec<serde_json::Value>,
            ) -> futures::stream::BoxStream<'a, Result<super::StreamBatch, super::DbError>> {
                Box::pin(async_stream::try_stream! {
                    use sqlx::{Column, Row};
                    use futures::StreamExt;

                    const BATCH_SIZE: usize = 5000;

                    let sqlx_query = sqlx::query(&sql);
                    let sqlx_query = bind_params(sqlx_query, &params);

                    let mut stream = sqlx_query.fetch(&self.pool);

                    let mut buffer: Vec<Vec<serde_json::Value>> = Vec::with_capacity(BATCH_SIZE);
                    let mut captured_columns: Option<Vec<String>> = None;
                    let mut first_batch = true;

                    while let Some(row_result) = stream.next().await {
                        let row = row_result.map_err(|e| super::DbError::query_error(e))?;

                        if captured_columns.is_none() {
                            captured_columns = Some(
                                row.columns().iter().map(|c| c.name().to_string()).collect(),
                            );
                        }
                        let col_count = row.columns().len();
                        let mut values = Vec::with_capacity(col_count);
                        for i in 0..col_count {
                            let v = row.try_get_raw(i).map_err(|e| super::DbError::query_error(e))?;
                            values.push($decode_fn(v)?);
                        }
                        buffer.push(values);

                        if buffer.len() >= BATCH_SIZE {
                            let batch_cols = if first_batch { captured_columns.clone() } else { None };
                            first_batch = false;
                            yield super::StreamBatch {
                                columns: batch_cols,
                                rows: std::mem::take(&mut buffer),
                                is_final: false,
                            };
                        }
                    }

                    // Terminal batch — empty buffer is fine, but still needs to carry
                    // the columns if no row ever arrived (empty result set).
                    let final_cols = if first_batch {
                        Some(captured_columns.unwrap_or_default())
                    } else {
                        None
                    };
                    yield super::StreamBatch {
                        columns: final_cols,
                        rows: buffer,
                        is_final: true,
                    };
                })
            }

            async fn execute(
                &self,
                sql: &str,
                params: Vec<serde_json::Value>,
            ) -> Result<ExecuteResult, DbError> {
                use sqlx::Executor;

                let query = sqlx::query(sql);
                let query = bind_params(query, &params);

                let result = self
                    .pool
                    .execute(query)
                    .await
                    .map_err(|e| DbError::execute_error(e))?;

                Ok(ExecuteResult {
                    rows_affected: result.rows_affected(),
                    last_insert_id: ($last_insert_id)(&result),
                })
            }

            async fn transaction(&self, statements: Vec<super::BatchStatement>) -> Result<(), super::DbError> {
                use sqlx::{Acquire, Executor};

                let mut conn = self
                    .pool
                    .acquire()
                    .await
                    .map_err(|e| DbError::execute_error(e))?;

                let mut tx = conn
                    .begin()
                    .await
                    .map_err(|e| DbError::execute_error(e))?;

                for stmt in &statements {
                    let query = sqlx::query(&stmt.sql);
                    let query = bind_params(query, &stmt.params);
                    tx.execute(query)
                        .await
                        .map_err(|e| DbError::execute_error(e))?;
                }

                tx.commit()
                    .await
                    .map_err(|e| DbError::execute_error(e))?;

                Ok(())
            }

            async fn close(&self) -> Result<(), DbError> {
                self.pool.close().await;
                Ok(())
            }
        }
    };
}

pub(crate) use impl_sqlx_driver;

/// Single connection manager for all drivers
pub struct ConnectionManager {
    pub connections: RwLock<HashMap<String, Arc<dyn Driver>>>,
    /// Cancellation flags for in-flight streaming queries, keyed by a client-
    /// supplied query ID. `db_query_stream` registers a flag on entry and
    /// removes it on exit; `db_cancel_stream` flips the flag so the running
    /// stream loop breaks out on its next iteration.
    pub cancellation_flags: RwLock<HashMap<String, Arc<AtomicBool>>>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: RwLock::new(HashMap::new()),
            cancellation_flags: RwLock::new(HashMap::new()),
        }
    }
}

impl Default for ConnectionManager {
    fn default() -> Self {
        Self::new()
    }
}
