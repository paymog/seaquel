import { getDatabase } from "$lib/storage/db";
import { appStateRepo } from "$lib/storage/repository";

export type EditorKeybindingMode = "default" | "vim" | "emacs";

const SETTING_KEY = "editorKeybindingMode";

type ChangeListener = () => void;

class EditorSettingsStore {
  keybindingMode = $state<EditorKeybindingMode>("default");
  private listeners: ChangeListener[] = [];

  async load(): Promise<void> {
    try {
      const db = await getDatabase();
      const raw = await appStateRepo.get(db, SETTING_KEY);
      if (raw === "vim" || raw === "emacs") {
        this.keybindingMode = raw;
      }
    } catch {
      // Default to "default" if storage fails
    }
  }

  async setKeybindingMode(value: EditorKeybindingMode): Promise<void> {
    this.keybindingMode = value;
    this.listeners.forEach((fn) => fn());
    try {
      const db = await getDatabase();
      await appStateRepo.set(db, SETTING_KEY, value);
    } catch {
      // Silently fail — setting is still updated in memory
    }
  }

  onChange(fn: ChangeListener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }
}

export const editorSettingsStore = new EditorSettingsStore();
