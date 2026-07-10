import { isTauri } from "$lib/utils/environment";
// platform-specific: WebviewWindow only exists inside the Tauri runtime; type is erased at build
import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";

interface ChildWindowConfig {
  label: string;
  url: string;
  title: string;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

const windowRefs = new Map<string, WebviewWindow>();

/**
 * Opens a child window with the given config.
 * If the window is already open, focuses it instead.
 * No-ops in web/server mode — child windows require Tauri.
 */
export async function openChildWindow(config: ChildWindowConfig): Promise<void> {
  if (!isTauri()) return;
  try {
    // platform-specific: WebviewWindow is not available outside the Tauri runtime
    const { WebviewWindow: WV } = await import("@tauri-apps/api/webviewWindow");
    const existing = await WV.getByLabel(config.label);
    if (existing) {
      await existing.setFocus();
      return;
    }

    const window = new WV(config.label, {
      url: config.url,
      title: config.title,
      width: config.width,
      height: config.height,
      minWidth: config.minWidth,
      minHeight: config.minHeight,
      center: true,
      resizable: true,
      decorations: true,
      alwaysOnTop: false,
    });

    windowRefs.set(config.label, window);

    void window.once("tauri://error", (e) => {
      console.error(`Failed to create ${config.label} window:`, e);
      windowRefs.delete(config.label);
    });

    void window.once("tauri://destroyed", () => {
      windowRefs.delete(config.label);
    });
  } catch (error) {
    console.error(`Error opening ${config.label} window:`, error);
  }
}

/**
 * Closes a child window by label if it's open.
 */
export async function closeChildWindow(label: string): Promise<void> {
  const window = windowRefs.get(label);
  if (window) {
    await window.close();
    windowRefs.delete(label);
  }
}

/**
 * Checks if a child window is currently open.
 */
export function isChildWindowOpen(label: string): boolean {
  return windowRefs.has(label);
}
