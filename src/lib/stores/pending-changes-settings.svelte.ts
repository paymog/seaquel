import { getDatabase } from "$lib/storage/db";
import { appStateRepo } from "$lib/storage/repository";

const SETTING_KEY = "pending_changes_enabled";

class PendingChangesSettingsStore {
  enabled = $state(true);

  async load(): Promise<void> {
    try {
      const db = await getDatabase();
      const raw = await appStateRepo.get(db, SETTING_KEY);
      if (raw !== null) {
        this.enabled = raw !== "false";
      }
    } catch {
      // Default to enabled if storage fails
    }
  }

  async setEnabled(value: boolean): Promise<void> {
    this.enabled = value;
    try {
      const db = await getDatabase();
      await appStateRepo.set(db, SETTING_KEY, String(value));
    } catch {
      // Silently fail — setting is still updated in memory
    }
  }
}

export const pendingChangesSettingsStore = new PendingChangesSettingsStore();
