use async_trait::async_trait;
use serde_json::Value as JsonValue;
use sqlx::{migrate::MigrateDatabase, Column, Executor, Pool, Row, Sqlite};

use super::{ConnectConfig, DbError, Driver, ExecuteResult, QueryResult};

pub struct SqliteDriver {
    pool: Pool<Sqlite>,
}

impl SqliteDriver {
    pub async fn connect(config: &ConnectConfig) -> Result<Self, DbError> {
        let conn_str = config
            .connection_string
            .as_deref()
            .ok_or_else(|| DbError::connection_error("connection_string is required for SQLite"))?;

        // Ensure the database file exists for SQLite
        if !sqlx::sqlite::Sqlite::database_exists(conn_str)
            .await
            .unwrap_or(false)
        {
            sqlx::sqlite::Sqlite::create_database(conn_str)
                .await
                .map_err(|e| DbError::connection_error(e))?;
        }

        let pool = Pool::<Sqlite>::connect(conn_str)
            .await
            .map_err(|e| DbError::connection_error(e))?;

        Ok(Self { pool })
    }
}

fn bind_params<'q>(
    mut query: sqlx::query::Query<'q, Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    values: &'q [JsonValue],
) -> sqlx::query::Query<'q, Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
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

#[async_trait]
impl Driver for SqliteDriver {
    async fn query(
        &self,
        sql: &str,
        params: Vec<JsonValue>,
    ) -> Result<QueryResult, DbError> {
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
                values.push(super::decode::sqlite::to_json(v)?);
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
        params: Vec<JsonValue>,
    ) -> Result<ExecuteResult, DbError> {
        let query = sqlx::query(sql);
        let query = bind_params(query, &params);

        let result = self
            .pool
            .execute(query)
            .await
            .map_err(|e| DbError::execute_error(e))?;

        Ok(ExecuteResult {
            rows_affected: result.rows_affected(),
            last_insert_id: Some(result.last_insert_rowid()),
        })
    }

    async fn close(&self) -> Result<(), DbError> {
        self.pool.close().await;
        Ok(())
    }
}
