use log::{error, info, warn};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct LicenseResponse {
    pub id: String,
    pub status: String,
    pub key: String,
    pub tier: String,
    pub activation: u32,
    pub activation_limit: u32,
    pub expires_at: Option<String>,
    pub instance_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LicenseError {
    pub message: String,
    pub code: String,
}

impl std::fmt::Display for LicenseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for LicenseError {}

fn base_url() -> &'static str {
    option_env!("LICENSE_API_URL").unwrap_or(if cfg!(debug_assertions) {
        "http://localhost:5173"
    } else {
        "https://seaquel.app"
    })
}

#[tauri::command]
pub async fn activate_license(
    key: String,
    instance_name: String,
) -> Result<LicenseResponse, LicenseError> {
    info!(activity = "license.activate"; "License activation requested");
    let client = reqwest::Client::new();
    let url = format!("{}/api/licenses/activate", base_url());

    let response = client
        .post(&url)
        .json(&serde_json::json!({
            "key": key,
            "instance_name": instance_name,
        }))
        .send()
        .await
        .map_err(|e| {
            error!(activity = "license.activate", error_code = "NETWORK_ERROR"; "Failed to connect to license server");
            LicenseError {
                message: format!("Failed to connect to license server: {}", e),
                code: "NETWORK_ERROR".to_string(),
            }
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        warn!(activity = "license.activate", status = status.as_u16(), error_code = "ACTIVATION_ERROR"; "License API returned error");
        return Err(LicenseError {
            message: format!("License activation failed ({}): {}", status, body),
            code: "ACTIVATION_ERROR".to_string(),
        });
    }

    info!(activity = "license.activate"; "License activation successful");
    response.json::<LicenseResponse>().await.map_err(|e| {
        error!(activity = "license.activate", error_code = "PARSE_ERROR"; "Invalid response from license server");
        LicenseError {
            message: format!("Invalid response from license server: {}", e),
            code: "PARSE_ERROR".to_string(),
        }
    })
}

#[tauri::command]
pub async fn validate_license(
    key: String,
    instance_id: String,
) -> Result<LicenseResponse, LicenseError> {
    info!(activity = "license.validate"; "License validation requested");
    let client = reqwest::Client::new();
    let url = format!("{}/api/licenses/validate", base_url());

    let response = client
        .post(&url)
        .json(&serde_json::json!({
            "key": key,
            "instance_id": instance_id,
        }))
        .send()
        .await
        .map_err(|e| {
            error!(activity = "license.validate", error_code = "NETWORK_ERROR"; "Failed to connect to license server");
            LicenseError {
                message: format!("Failed to connect to license server: {}", e),
                code: "NETWORK_ERROR".to_string(),
            }
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        warn!(activity = "license.validate", status = status.as_u16(), error_code = "VALIDATION_ERROR"; "License API returned error");
        return Err(LicenseError {
            message: format!("License validation failed ({}): {}", status, body),
            code: "VALIDATION_ERROR".to_string(),
        });
    }

    info!(activity = "license.validate"; "License validation successful");
    response.json::<LicenseResponse>().await.map_err(|e| {
        error!(activity = "license.validate", error_code = "PARSE_ERROR"; "Invalid response from license server");
        LicenseError {
            message: format!("Invalid response from license server: {}", e),
            code: "PARSE_ERROR".to_string(),
        }
    })
}

#[tauri::command]
pub async fn deactivate_license(
    key: String,
    instance_id: String,
) -> Result<LicenseResponse, LicenseError> {
    info!(activity = "license.deactivate"; "License deactivation requested");
    let client = reqwest::Client::new();
    let url = format!("{}/api/licenses/deactivate", base_url());

    let response = client
        .post(&url)
        .json(&serde_json::json!({
            "key": key,
            "instance_id": instance_id,
        }))
        .send()
        .await
        .map_err(|e| {
            error!(activity = "license.deactivate", error_code = "NETWORK_ERROR"; "Failed to connect to license server");
            LicenseError {
                message: format!("Failed to connect to license server: {}", e),
                code: "NETWORK_ERROR".to_string(),
            }
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        warn!(activity = "license.deactivate", status = status.as_u16(), error_code = "DEACTIVATION_ERROR"; "License API returned error");
        return Err(LicenseError {
            message: format!("License deactivation failed ({}): {}", status, body),
            code: "DEACTIVATION_ERROR".to_string(),
        });
    }

    info!(activity = "license.deactivate"; "License deactivation successful");
    response.json::<LicenseResponse>().await.map_err(|e| {
        error!(activity = "license.deactivate", error_code = "PARSE_ERROR"; "Invalid response from license server");
        LicenseError {
            message: format!("Invalid response from license server: {}", e),
            code: "PARSE_ERROR".to_string(),
        }
    })
}
