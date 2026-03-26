/**
 * Settings tab types for app and project settings.
 * Settings tabs are displayed inline like any other tab.
 * @module types/settings-tab
 */

/**
 * The kind of settings tab.
 * - "app": Global app settings (theme, AI, features, etc.)
 * - "project": Project-specific settings (name, sharing, delete)
 */
export type SettingsTabKind = "app" | "project";

/**
 * Represents a settings tab shown inline in the tab bar.
 */
export interface SettingsTab {
  /** Unique tab identifier */
  id: string;
  /** Tab display name */
  name: string;
  /** Which settings to show */
  kind: SettingsTabKind;
  /** Active section/view within settings (for app settings navigation) */
  activeView?: string;
}
