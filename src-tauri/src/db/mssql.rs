use async_native_tls::TlsStream;
use async_trait::async_trait;
use log::{error, info, trace};
use tiberius::{AuthMethod, Client, Config, Query, Row};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_util::compat::{Compat, TokioAsyncReadCompatExt};

use super::{ConnectConfig, DbError, Driver, ExecuteResult, QueryResult};

/// Support both TLS and non-TLS connections
enum MssqlClient {
    Tls(Client<TlsStream<Compat<TcpStream>>>),
    Plain(Client<Compat<TcpStream>>),
}

impl MssqlClient {
    async fn query_rows(&mut self, sql: &str) -> Result<Vec<Row>, tiberius::error::Error> {
        let query = Query::new(sql);
        match self {
            MssqlClient::Tls(client) => {
                let stream = query.query(client).await?;
                stream.into_first_result().await
            }
            MssqlClient::Plain(client) => {
                let stream = query.query(client).await?;
                stream.into_first_result().await
            }
        }
    }

    async fn execute_sql(
        &mut self,
        sql: &str,
    ) -> Result<tiberius::ExecuteResult, tiberius::error::Error> {
        match self {
            MssqlClient::Tls(client) => client.execute(sql, &[]).await,
            MssqlClient::Plain(client) => client.execute(sql, &[]).await,
        }
    }
}

pub struct MssqlDriver {
    client: Mutex<MssqlClient>,
}

impl MssqlDriver {
    pub async fn connect(config: &ConnectConfig) -> Result<Self, DbError> {
        let host = config.host.as_deref().unwrap_or("localhost");
        let port = config.port.unwrap_or(1433);
        let database = config.database.as_deref().unwrap_or("master");
        let username = config.username.as_deref().unwrap_or("");
        let password = config.password.as_deref().unwrap_or("");
        let encrypt = config.encrypt.unwrap_or(true);

        info!("MSSQL connecting (encrypt={})", encrypt);

        let mut tiberius_config = Config::new();
        tiberius_config.host(host);
        tiberius_config.port(port);
        tiberius_config.database(database);
        tiberius_config.authentication(AuthMethod::sql_server(username, password));
        tiberius_config.encryption(tiberius::EncryptionLevel::NotSupported);

        // Connect with timeout
        let tcp = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            TcpStream::connect(tiberius_config.get_addr()),
        )
        .await
        .map_err(|_| DbError {
            message: "Connection timed out".to_string(),
            code: "TIMEOUT".to_string(),
        })?
        .map_err(|e| DbError::connection_error(e))?;

        tcp.set_nodelay(true).map_err(|e| DbError {
            message: format!("Failed to set TCP nodelay: {}", e),
            code: "TCP_ERROR".to_string(),
        })?;

        let tcp_compat = tcp.compat();

        let client = if encrypt {
            let tls_connector = async_native_tls::TlsConnector::new()
                .danger_accept_invalid_certs(config.trust_cert.unwrap_or(false))
                .use_sni(true);

            let tls_stream = tls_connector
                .connect(host, tcp_compat)
                .await
                .map_err(|e| DbError {
                    message: format!("TLS connection failed: {}. Try setting SSL Mode to 'disable' for localhost servers without TLS.", e),
                    code: "TLS_ERROR".to_string(),
                })?;

            let inner_client = Client::connect(tiberius_config, tls_stream)
                .await
                .map_err(|e| DbError {
                    message: format!("Failed to connect to SQL Server: {}", e),
                    code: "AUTH_ERROR".to_string(),
                })?;

            MssqlClient::Tls(inner_client)
        } else {
            let inner_client = Client::connect(tiberius_config, tcp_compat)
                .await
                .map_err(|e| DbError {
                    message: format!("Failed to connect to SQL Server: {}", e),
                    code: "AUTH_ERROR".to_string(),
                })?;

            MssqlClient::Plain(inner_client)
        };

        Ok(Self {
            client: Mutex::new(client),
        })
    }
}

/// Convert a tiberius Row to a vector of JSON values (positional)
fn row_to_values(row: &Row) -> Vec<serde_json::Value> {
    row.columns()
        .iter()
        .map(|col| {
            let col_name = col.name();
            if let Some(v) = row.try_get::<&str, _>(col_name).ok().flatten() {
                serde_json::json!(v)
            } else if let Some(v) = row.try_get::<i64, _>(col_name).ok().flatten() {
                serde_json::json!(v)
            } else if let Some(v) = row.try_get::<i32, _>(col_name).ok().flatten() {
                serde_json::json!(v)
            } else if let Some(v) = row.try_get::<i16, _>(col_name).ok().flatten() {
                serde_json::json!(v)
            } else if let Some(v) = row.try_get::<u8, _>(col_name).ok().flatten() {
                serde_json::json!(v)
            } else if let Some(v) = row.try_get::<f64, _>(col_name).ok().flatten() {
                serde_json::json!(v)
            } else if let Some(v) = row.try_get::<f32, _>(col_name).ok().flatten() {
                serde_json::json!(v)
            } else if let Some(v) = row.try_get::<bool, _>(col_name).ok().flatten() {
                serde_json::json!(v)
            } else if let Some(v) = row.try_get::<&[u8], _>(col_name).ok().flatten() {
                use base64::{engine::general_purpose::STANDARD, Engine as _};
                serde_json::json!(STANDARD.encode(v))
            } else {
                serde_json::Value::Null
            }
        })
        .collect()
}

#[async_trait]
impl Driver for MssqlDriver {
    async fn query(
        &self,
        sql: &str,
        _params: Vec<serde_json::Value>,
    ) -> Result<QueryResult, DbError> {
        let mut client = self.client.lock().await;

        let rows = client.query_rows(sql).await.map_err(|e| {
            error!("MSSQL query error");
            trace!("MSSQL query error: {}", e);
            DbError::query_error(e)
        })?;

        let columns: Vec<String> = if !rows.is_empty() {
            rows[0]
                .columns()
                .iter()
                .map(|c| c.name().to_string())
                .collect()
        } else {
            vec![]
        };

        let result_rows: Vec<Vec<serde_json::Value>> =
            rows.iter().map(|row| row_to_values(row)).collect();

        Ok(QueryResult {
            columns,
            rows: result_rows,
        })
    }

    async fn execute(
        &self,
        sql: &str,
        _params: Vec<serde_json::Value>,
    ) -> Result<ExecuteResult, DbError> {
        let mut client = self.client.lock().await;

        let result = client.execute_sql(sql).await.map_err(|e| {
            error!("MSSQL execute error");
            trace!("MSSQL execute error: {}", e);
            DbError::execute_error(e)
        })?;

        let rows_affected: u64 = result.rows_affected().iter().sum();

        Ok(ExecuteResult {
            rows_affected,
            last_insert_id: None,
        })
    }

    async fn close(&self) -> Result<(), DbError> {
        // tiberius Client doesn't have an explicit close method;
        // dropping the client closes the connection
        Ok(())
    }
}
