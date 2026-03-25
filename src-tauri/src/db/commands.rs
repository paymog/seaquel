use log::{debug, info};
use tauri::{command, State};

use super::{
    duckdb::DuckdbDriver, mssql::MssqlDriver, mysql::MysqlDriver, postgres::PostgresDriver,
    sqlite::SqliteDriver, ConnectConfig, ConnectResult, ConnectionManager, DbError, Driver,
    DriverType, ExecuteResult, QueryResult,
};

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
    info!("db_connect: driver={}", driver_name);

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

    info!("db_connect: connected as {}", connection_id);
    Ok(ConnectResult { connection_id })
}

#[command]
pub async fn db_query(
    connection_id: String,
    sql: String,
    values: Vec<serde_json::Value>,
    manager: State<'_, ConnectionManager>,
) -> Result<QueryResult, DbError> {
    debug!("db_query on {}", connection_id);
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
    debug!("db_execute on {}", connection_id);
    let connections = manager.connections.read().await;
    let driver = connections
        .get(&connection_id)
        .ok_or_else(|| DbError::connection_not_found(&connection_id))?;
    driver.execute(&sql, values).await
}

#[command]
pub async fn db_disconnect(
    connection_id: String,
    manager: State<'_, ConnectionManager>,
) -> Result<(), DbError> {
    info!("db_disconnect: {}", connection_id);
    let mut connections = manager.connections.write().await;
    if let Some(driver) = connections.remove(&connection_id) {
        driver.close().await?;
    }
    Ok(())
}

#[command]
pub async fn db_test(config: ConnectConfig) -> Result<(), DbError> {
    debug!("db_test: driver={:?}", config.driver);
    let driver = connect_driver(&config).await?;
    driver.close().await
}
