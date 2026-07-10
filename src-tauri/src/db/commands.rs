use log::{debug, info};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{command, ipc::Channel, State};

use super::{
    duckdb::DuckdbDriver, mssql::MssqlDriver, mysql::MysqlDriver, postgres::PostgresDriver,
    sqlite::SqliteDriver, BatchStatement, ConnectConfig, ConnectResult, ConnectionManager, DbError,
    Driver, DriverType, ExecuteResult, QueryResult, StreamEvent,
};

fn sql_keyword(sql: &str) -> &str {
    sql.trim_start().split_whitespace().next().unwrap_or("?")
}

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

#[command]
pub async fn db_connect(
    config: ConnectConfig,
    manager: State<'_, ConnectionManager>,
) -> Result<ConnectResult, DbError> {
    let driver_name = format!("{:?}", config.driver);
    info!(activity = "db.connect", driver = driver_name.as_str(); "Connecting");

    let connection_id = format!(
        "{}-{}",
        driver_name.to_lowercase(),
        uuid::Uuid::new_v4()
    );

    let driver = connect_driver(&config).await?;

    manager
        .connections
        .write()
        .await
        .insert(connection_id.clone(), Arc::from(driver));

    info!(activity = "db.connect", driver = driver_name.as_str(), connection_id = connection_id.as_str(); "Connected");
    Ok(ConnectResult { connection_id })
}

#[command]
pub async fn db_query(
    connection_id: String,
    sql: String,
    values: Vec<serde_json::Value>,
    manager: State<'_, ConnectionManager>,
) -> Result<QueryResult, DbError> {
    let keyword = sql_keyword(&sql).to_uppercase();
    debug!(activity = "db.query", connection_id = connection_id.as_str(), keyword = keyword.as_str(), sql_len = sql.len(), params = values.len(); "Query");
    let connections = manager.connections.read().await;
    let driver = connections
        .get(&connection_id)
        .ok_or_else(|| DbError::connection_not_found(&connection_id))?;
    driver.query(&sql, values).await
}

#[command]
pub async fn db_query_stream(
    query_id: String,
    connection_id: String,
    sql: String,
    values: Vec<serde_json::Value>,
    on_event: Channel<StreamEvent>,
    manager: State<'_, ConnectionManager>,
) -> Result<(), DbError> {
    use futures::StreamExt;

    let keyword = sql_keyword(&sql).to_uppercase();
    debug!(activity = "db.query_stream", query_id = query_id.as_str(), connection_id = connection_id.as_str(), keyword = keyword.as_str(), sql_len = sql.len(), params = values.len(); "Query stream");

    // Register a cancellation flag keyed by query_id. `db_cancel_stream` flips
    // this when the user clicks Cancel; the stream loop below checks it on
    // every iteration and breaks out early, releasing the sqlx connection.
    let cancel_flag = Arc::new(AtomicBool::new(false));
    manager
        .cancellation_flags
        .write()
        .await
        .insert(query_id.clone(), cancel_flag.clone());

    // Wrap the main body in an async block so the `?` operator and early
    // `return` still run the cleanup below. Whatever happens (success,
    // connection-not-found, stream error, user cancel), we always remove
    // the flag from the manager on the way out.
    let outcome: Result<(), DbError> = async {
        let connections = manager.connections.read().await;
        let driver = connections
            .get(&connection_id)
            .ok_or_else(|| DbError::connection_not_found(&connection_id))?;

        let mut stream = driver.query_stream(sql, values);
        while let Some(batch_result) = stream.next().await {
            if cancel_flag.load(Ordering::Relaxed) {
                // Drop `stream` implicitly on function exit, which cancels
                // the underlying sqlx fetch and releases the connection.
                return Ok(());
            }
            match batch_result {
                Ok(batch) => {
                    // Channel::send returns Err if the JS side has dropped
                    // the channel. Terminate the loop — same effect as the
                    // explicit cancel path.
                    if on_event.send(StreamEvent::Batch(batch)).is_err() {
                        return Ok(());
                    }
                }
                Err(e) => {
                    let _ = on_event.send(StreamEvent::Error {
                        message: e.message.clone(),
                        code: e.code.clone(),
                    });
                    return Ok(());
                }
            }
        }
        let _ = on_event.send(StreamEvent::Done);
        Ok(())
    }
    .await;

    manager.cancellation_flags.write().await.remove(&query_id);

    outcome
}

#[command]
pub async fn db_cancel_stream(
    query_id: String,
    manager: State<'_, ConnectionManager>,
) -> Result<(), DbError> {
    debug!(activity = "db.cancel_stream", query_id = query_id.as_str(); "Cancel stream");
    let flags = manager.cancellation_flags.read().await;
    if let Some(flag) = flags.get(&query_id) {
        flag.store(true, Ordering::Relaxed);
    }
    // If the flag isn't there, the stream either never started or already
    // finished — nothing to cancel, no error.
    Ok(())
}

#[command]
pub async fn db_execute(
    connection_id: String,
    sql: String,
    values: Vec<serde_json::Value>,
    manager: State<'_, ConnectionManager>,
) -> Result<ExecuteResult, DbError> {
    let keyword = sql_keyword(&sql).to_uppercase();
    debug!(activity = "db.execute", connection_id = connection_id.as_str(), keyword = keyword.as_str(), sql_len = sql.len(), params = values.len(); "Execute");
    let connections = manager.connections.read().await;
    let driver = connections
        .get(&connection_id)
        .ok_or_else(|| DbError::connection_not_found(&connection_id))?;
    driver.execute(&sql, values).await
}

#[command]
pub async fn db_transaction(
    connection_id: String,
    statements: Vec<BatchStatement>,
    manager: State<'_, ConnectionManager>,
) -> Result<(), DbError> {
    debug!(activity = "db.transaction", connection_id = connection_id.as_str(), statements = statements.len(); "Executing transaction");
    let connections = manager.connections.read().await;
    let driver = connections
        .get(&connection_id)
        .ok_or_else(|| DbError::connection_not_found(&connection_id))?;
    driver.transaction(statements).await
}

#[command]
pub async fn db_disconnect(
    connection_id: String,
    manager: State<'_, ConnectionManager>,
) -> Result<(), DbError> {
    info!(activity = "db.disconnect", connection_id = connection_id.as_str(); "Disconnecting");
    let mut connections = manager.connections.write().await;
    if let Some(driver) = connections.remove(&connection_id) {
        driver.close().await?;
    }
    Ok(())
}

#[command]
pub async fn db_test(config: ConnectConfig) -> Result<(), DbError> {
    debug!(activity = "db.test", driver = format!("{:?}", config.driver).as_str(); "Testing connection");
    let driver = connect_driver(&config).await?;
    driver.close().await
}
