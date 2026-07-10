/**
 * Environment detection utilities.
 * Used to determine runtime context (Tauri desktop vs web browser).
 */

/**
 * Check if running inside Tauri desktop app.
 * Uses __TAURI_INTERNALS__ which is available synchronously in Tauri v2,
 * or falls back to checking __TAURI__ for compatibility.
 */
export function isTauri(): boolean {
  if (typeof window === "undefined") return false;

  // __TAURI_INTERNALS__ is available synchronously in Tauri v2
  if ("__TAURI_INTERNALS__" in window) return true;

  // Fallback: check for __TAURI__ (may be async in some cases)
  if ("__TAURI__" in window) return true;

  // Check if loaded via tauri:// protocol (Tauri v2 default)
  if (window.location.protocol === "tauri:") return true;

  return false;
}

/**
 * Check if running as a self-hosted web app (served by the Rust backend).
 * The app is NOT in Tauri and NOT in demo mode.
 */
export function isServer(): boolean {
  if (typeof window === "undefined") return false;
  const v = import.meta.env.VITE_IS_SERVER;
  // Vite define injects the literal boolean; vi.stubEnv sets a string in tests
  return !isTauri() && (v === true || v === "true");
}

/**
 * Check if running in browser demo mode (not Tauri, not server).
 */
export function isDemo(): boolean {
  return !isTauri() && !isServer();
}

/**
 * Check if running in a browser environment (vs SSR).
 */
export function isBrowser(): boolean {
  return typeof window !== "undefined";
}
