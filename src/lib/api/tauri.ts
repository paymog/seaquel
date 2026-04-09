/**
 * Typed Tauri API layer.
 * Centralizes all Tauri invoke() calls with compile-time type safety.
 * Eliminates magic command strings scattered across the codebase.
 */

import { invoke } from "@tauri-apps/api/core";

// Re-export existing well-typed service modules
export * as git from "$lib/services/git";
export * as sshTunnel from "$lib/services/ssh-tunnel";

// === App Commands ===

export async function copyImageToClipboard(path: string): Promise<void> {
  await invoke("copy_image_to_clipboard", { path });
}

export async function openPath(path: string): Promise<void> {
  await invoke("open_path", { path });
}

export async function getDataDir(): Promise<string> {
  return invoke<string>("get_data_dir");
}

export async function readLogFile(): Promise<string> {
  return invoke<string>("read_log_file");
}

export async function clearLogFile(): Promise<void> {
  return invoke<void>("clear_log_file");
}

export interface UpdateInfo {
  version: string;
  date: string | null;
  size: number | null;
}

export async function installUpdate(): Promise<void> {
  await invoke("install_update");
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  return invoke<UpdateInfo | null>("check_for_update_command");
}

export async function readDbeaverConfig(): Promise<string | null> {
  return invoke<string | null>("read_dbeaver_config");
}

export async function readTablePlusConfig(): Promise<string | null> {
  return invoke<string | null>("read_tableplus_config");
}

export async function getUsername(): Promise<string> {
  return invoke<string>("get_username");
}

// === License Commands ===

export interface LicenseResponse {
  id: string;
  status: string;
  key: string;
  tier: string;
  activation: number;
  activation_limit: number;
  expires_at: string | null;
  instance_id: string | null;
}

export async function activateLicense(key: string, instanceName: string): Promise<LicenseResponse> {
  return invoke<LicenseResponse>("activate_license", { key, instanceName });
}

export async function validateLicense(key: string, instanceId: string): Promise<LicenseResponse> {
  return invoke<LicenseResponse>("validate_license", { key, instanceId });
}

export async function deactivateLicense(key: string, instanceId: string): Promise<LicenseResponse> {
  return invoke<LicenseResponse>("deactivate_license", { key, instanceId });
}
