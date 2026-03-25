import type { SharedProject } from "$lib/types";

export type ImportableSharedProject = SharedProject & { selected: boolean };

class SharedProjectImportStore {
  isOpen = $state(false);
  isImporting = $state(false);
  folderPath = $state<string | null>(null);
  discoveredProjects = $state<ImportableSharedProject[]>([]);

  openWithResults(path: string, projects: SharedProject[]): void {
    this.folderPath = path;
    this.discoveredProjects = projects.map((p) => ({ ...p, selected: true }));
    this.isOpen = true;
  }

  toggleProject(index: number): void {
    if (this.discoveredProjects[index]) {
      this.discoveredProjects[index].selected = !this.discoveredProjects[index].selected;
      this.discoveredProjects = [...this.discoveredProjects];
    }
  }

  selectAll(): void {
    this.discoveredProjects = this.discoveredProjects.map((p) => ({ ...p, selected: true }));
  }

  deselectAll(): void {
    this.discoveredProjects = this.discoveredProjects.map((p) => ({ ...p, selected: false }));
  }

  reset(): void {
    this.isOpen = false;
    this.isImporting = false;
    this.folderPath = null;
    this.discoveredProjects = [];
  }
}

export const sharedProjectImportStore = new SharedProjectImportStore();
