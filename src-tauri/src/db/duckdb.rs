use async_trait::async_trait;
use duckdb::{types::ValueRef, Connection};
use std::sync::Mutex;

use super::{ConnectConfig, DbError, Driver, ExecuteResult, QueryResult};

pub struct DuckdbDriver {
    connection: Mutex<Connection>,
}

impl DuckdbDriver {
    pub fn connect(config: &ConnectConfig) -> Result<Self, DbError> {
        let path = config.path.as_deref().unwrap_or(":memory:");

        let conn = if path == ":memory:" || path.is_empty() {
            Connection::open_in_memory()
        } else {
            Connection::open(path)
        }
        .map_err(|e| DbError::connection_error(e))?;

        Ok(Self {
            connection: Mutex::new(conn),
        })
    }
}

/// Convert a DuckDB ValueRef to a serde_json::Value
fn convert_value_to_json(value: ValueRef) -> serde_json::Value {
    match value {
        ValueRef::Null => serde_json::Value::Null,
        ValueRef::Boolean(b) => serde_json::json!(b),
        ValueRef::TinyInt(i) => serde_json::json!(i),
        ValueRef::SmallInt(i) => serde_json::json!(i),
        ValueRef::Int(i) => serde_json::json!(i),
        ValueRef::BigInt(i) => serde_json::json!(i),
        ValueRef::HugeInt(i) => serde_json::json!(i.to_string()),
        ValueRef::UTinyInt(i) => serde_json::json!(i),
        ValueRef::USmallInt(i) => serde_json::json!(i),
        ValueRef::UInt(i) => serde_json::json!(i),
        ValueRef::UBigInt(i) => serde_json::json!(i),
        ValueRef::Float(f) => serde_json::json!(f),
        ValueRef::Double(f) => serde_json::json!(f),
        ValueRef::Decimal(d) => serde_json::json!(d.to_string()),
        ValueRef::Text(s) => serde_json::json!(String::from_utf8_lossy(s)),
        ValueRef::Blob(b) => {
            serde_json::json!(base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                b
            ))
        }
        ValueRef::Date32(d) => serde_json::json!(d),
        ValueRef::Time64(..) => serde_json::json!(format!("{:?}", value)),
        ValueRef::Timestamp(..) => serde_json::json!(format!("{:?}", value)),
        ValueRef::Interval { .. } => serde_json::json!(format!("{:?}", value)),
        ValueRef::List(..) => serde_json::json!(format!("{:?}", value)),
        ValueRef::Enum(..) => serde_json::json!(format!("{:?}", value)),
        ValueRef::Struct(..) => serde_json::json!(format!("{:?}", value)),
        ValueRef::Map(..) => serde_json::json!(format!("{:?}", value)),
        ValueRef::Array(..) => serde_json::json!(format!("{:?}", value)),
        ValueRef::Union(..) => serde_json::json!(format!("{:?}", value)),
    }
}

#[async_trait]
impl Driver for DuckdbDriver {
    async fn query(
        &self,
        sql: &str,
        params: Vec<serde_json::Value>,
    ) -> Result<QueryResult, DbError> {
        if !params.is_empty() {
            return Err(DbError::execute_error("Parameter binding is not supported for the DuckDB driver. Use inline values instead."));
        }
        let sql = sql.to_string();

        // DuckDB is synchronous — we can't hold a MutexGuard across await,
        // but since this is a std::sync::Mutex (not tokio), we do the work inline.
        let conn = self.connection.lock().map_err(|e| DbError {
            message: format!("Failed to lock connection: {}", e),
            code: "LOCK_ERROR".to_string(),
        })?;

        let mut stmt = conn.prepare(&sql).map_err(|e| DbError::query_error(e))?;

        let mut result_rows = stmt.query([]).map_err(|e| DbError::query_error(e))?;

        let column_count = result_rows
            .as_ref()
            .map(|s| s.column_count())
            .unwrap_or(0);
        let columns: Vec<String> = (0..column_count)
            .map(|i| {
                result_rows
                    .as_ref()
                    .and_then(|s| s.column_name(i).ok())
                    .map(|s| s.to_string())
                    .unwrap_or_default()
            })
            .collect();

        let mut rows: Vec<Vec<serde_json::Value>> = Vec::new();
        while let Some(row) = result_rows.next().map_err(|e| DbError::query_error(e))? {
            let mut values = Vec::with_capacity(column_count);
            for i in 0..column_count {
                let value = row.get_ref(i).map_err(|e| DbError::query_error(e))?;
                values.push(convert_value_to_json(value));
            }
            rows.push(values);
        }

        Ok(QueryResult { columns, rows })
    }

    async fn execute(
        &self,
        sql: &str,
        params: Vec<serde_json::Value>,
    ) -> Result<ExecuteResult, DbError> {
        if !params.is_empty() {
            return Err(DbError::execute_error("Parameter binding is not supported for the DuckDB driver. Use inline values instead."));
        }
        let conn = self.connection.lock().map_err(|e| DbError {
            message: format!("Failed to lock connection: {}", e),
            code: "LOCK_ERROR".to_string(),
        })?;

        let rows_affected = conn
            .execute(sql, [])
            .map_err(|e| DbError::execute_error(e))?;

        Ok(ExecuteResult {
            rows_affected: rows_affected as u64,
            last_insert_id: None,
        })
    }

    async fn close(&self) -> Result<(), DbError> {
        // DuckDB Connection is closed on drop
        Ok(())
    }
}
