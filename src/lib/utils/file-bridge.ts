/**
 * Unified file save/open bridge.
 * Uses native Tauri dialogs in the desktop app; falls back to
 * browser download / <input type="file"> in the web build.
 * All Tauri calls are guarded by isTauri() — safe to bundle for all targets.
 */
import { save, open } from "@tauri-apps/plugin-dialog";
import { writeTextFile, writeFile, readTextFile } from "@tauri-apps/plugin-fs";
import { isTauri } from "./environment";

/**
 * Save content as a file download (browser) or via native save dialog (Tauri).
 */
export async function saveFile(
  filename: string,
  content: string | Blob,
  mime = "text/plain",
): Promise<void> {
  if (isTauri()) {
    const path = await save({ defaultPath: filename });
    if (path) {
      if (typeof content === "string") {
        await writeTextFile(path, content);
      } else {
        await writeFile(path, new Uint8Array(await content.arrayBuffer()));
      }
    }
    return;
  }

  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Open a file picker. Returns the selected File in browser mode,
 * or constructs a File from the path content in Tauri mode.
 * Returns null if the user cancels.
 */
export async function pickFile(accept?: string): Promise<File | null> {
  if (isTauri()) {
    const selected = await open({ multiple: false });
    if (typeof selected === "string") {
      const content = await readTextFile(selected);
      const name = selected.split(/[\\/]/).pop() ?? "file";
      return new File([content], name);
    }
    return null;
  }

  const { promise, resolve } = Promise.withResolvers<File | null>();
  const input = document.createElement("input");
  input.type = "file";
  if (accept) input.accept = accept;
  input.onchange = () => resolve(input.files?.[0] ?? null);
  input.click();
  return promise;
}
