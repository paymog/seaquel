import { openChildWindow } from "./child-window";

/**
 * Opens the log viewer in a separate window.
 * If the window is already open, focuses it instead.
 */
export async function openLogViewer(): Promise<void> {
  await openChildWindow({
    label: "log-viewer",
    url: "/windows/log-viewer",
    title: "Seaquel Logs",
    width: 900,
    height: 600,
    minWidth: 500,
    minHeight: 300,
  });
}
