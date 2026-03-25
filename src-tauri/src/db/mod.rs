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
use tokio::sync::RwLock;

/// Columnar result format for all drivers
#[derive(Debug, Serialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
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
    pub connections: RwLock<HashMap<String, Box<dyn Driver>>>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: RwLock::new(HashMap::new()),
        }
    }
}

impl Default for ConnectionManager {
    fn default() -> Self {
        Self::new()
    }
}
