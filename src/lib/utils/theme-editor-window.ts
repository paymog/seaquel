import type { Theme } from "$lib/types/theme";
import { openChildWindow, closeChildWindow, isChildWindowOpen } from "./child-window";

const LABEL = "theme-editor";

/**
 * Opens the theme editor in a separate window.
 * If the window is already open, focuses it instead.
 * @param theme - The theme to edit, or null to create a new theme
 */
export async function openThemeEditor(theme: Theme | null): Promise<void> {
  const url = theme
    ? `/windows/theme-editor?themeId=${encodeURIComponent(theme.id)}`
    : "/windows/theme-editor";

  await openChildWindow({
    label: LABEL,
    url,
    title: theme ? `Edit Theme: ${theme.name}` : "Create New Theme",
    width: 800,
    height: 600,
    minWidth: 700,
    minHeight: 500,
  });
}

/**
 * Closes the theme editor window if it's open.
 */
export async function closeThemeEditor(): Promise<void> {
  await closeChildWindow(LABEL);
}

/**
 * Checks if the theme editor window is currently open.
 */
export function isThemeEditorOpen(): boolean {
  return isChildWindowOpen(LABEL);
}
