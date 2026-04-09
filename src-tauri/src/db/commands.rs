use log::{debug, info};
use tauri::{command, State};

use super::{
    duckdb::DuckdbDriver, mssql::MssqlDriver, mysql::MysqlDriver, postgres::PostgresDriver,
    sqlite::SqliteDriver, BatchStatement, ConnectConfig, ConnectResult, ConnectionManager, DbError,
    Driver, DriverType, ExecuteResult, QueryResult,
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
        .insert(connection_id.clone(), driver);

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
