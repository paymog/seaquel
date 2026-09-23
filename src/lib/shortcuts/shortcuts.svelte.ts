import { setContext, getContext } from "svelte";
import { shortcuts, type ShortcutDefinition, type ShortcutKeys } from "./registry.js";
import { isMac } from "./platform.js";

type ShortcutHandler = () => void;

export type QueryEditorExecuteHandlers = {
  executeCurrent: () => void;
  executeAll: () => void;
};

/** Routes execute shortcuts to the focused split-pane query editor. */
class QueryEditorExecuteHandlerRegistry {
  private byTabId = new Map<string, QueryEditorExecuteHandlers>();
  private focusedTabId: string | null = null;

  register(tabId: string, handlers: QueryEditorExecuteHandlers): void {
    this.byTabId.set(tabId, handlers);
  }

  unregister(tabId: string): void {
    this.byTabId.delete(tabId);
    if (this.focusedTabId === tabId) {
      this.focusedTabId = this.resolveDefaultTabId();
    }
  }

  setFocusedTab(tabId: string): void {
    if (this.byTabId.has(tabId)) {
      this.focusedTabId = tabId;
    }
  }

  getTargetTabId(): string | null {
    return this.resolveTargetTabId();
  }

  invokeCurrent(): boolean {
    return this.invoke("executeCurrent");
  }

  invokeAll(): boolean {
    return this.invoke("executeAll");
  }

  private invoke(kind: keyof QueryEditorExecuteHandlers): boolean {
    const tabId = this.resolveTargetTabId();
    if (!tabId) return false;
    const handlers = this.byTabId.get(tabId);
    if (!handlers) return false;
    handlers[kind]();
    return true;
  }

  private resolveTargetTabId(): string | null {
    if (this.focusedTabId && this.byTabId.has(this.focusedTabId)) {
      return this.focusedTabId;
    }
    return this.resolveDefaultTabId();
  }

  private resolveDefaultTabId(): string | null {
    if (this.byTabId.size === 1) {
      return this.byTabId.keys().next().value ?? null;
    }
    return null;
  }
}

class ShortcutManager {
  private handlers = new Map<string, ShortcutHandler>();
  private queryEditorExecute = new QueryEditorExecuteHandlerRegistry();
  showHelp = $state(false);

  registerHandler(id: string, handler: ShortcutHandler) {
    this.handlers.set(id, handler);
  }

  unregisterHandler(id: string) {
    this.handlers.delete(id);
  }

  registerQueryEditorExecute(tabId: string, handlers: QueryEditorExecuteHandlers) {
    this.queryEditorExecute.register(tabId, handlers);
  }

  unregisterQueryEditorExecute(tabId: string) {
    this.queryEditorExecute.unregister(tabId);
  }

  setFocusedQueryEditorTab(tabId: string) {
    this.queryEditorExecute.setFocusedTab(tabId);
  }

  getFocusedQueryEditorTabId(): string | null {
    return this.queryEditorExecute.getTargetTabId();
  }

  invoke(id: string): boolean {
    if (id === "executeQuery") {
      return this.queryEditorExecute.invokeCurrent();
    }
    if (id === "executeAll") {
      return this.queryEditorExecute.invokeAll();
    }

    const handler = this.handlers.get(id);
    if (!handler) return false;
    handler();
    return true;
  }

  handleKeydown = (e: KeyboardEvent) => {
    // Skip if typing in an input/textarea (unless it's a global shortcut)
    const target = e.target as HTMLElement;
    const isInInput =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target.isContentEditable;

    // Check for '?' to show help (but not in inputs)
    if (!isInInput && e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      this.showHelp = true;
      return;
    }

    // Find matching shortcut
    for (const shortcut of shortcuts) {
      if (shortcut.handledExternally) continue;

      if (this.matchesShortcut(e, shortcut.keys)) {
        // Check if we should skip input fields for this shortcut
        if (isInInput && !this.isGlobalShortcut(shortcut)) continue;

        if (
          this.handlers.has(shortcut.id) ||
          shortcut.id === "executeQuery" ||
          shortcut.id === "executeAll"
        ) {
          if (this.invoke(shortcut.id)) {
            e.preventDefault();
            return;
          }
        }
      }
    }
  };

  private matchesShortcut(e: KeyboardEvent, keys: ShortcutKeys): boolean {
    const mac = isMac();
    const modPressed = mac ? e.metaKey : e.ctrlKey;

    // Check mod key
    if (keys.mod && !modPressed) return false;
    if (!keys.mod && modPressed) return false;

    // Check other modifier keys
    if (keys.ctrl && !e.ctrlKey) return false;
    if (keys.alt && !e.altKey) return false;
    if (keys.shift !== undefined && keys.shift !== e.shiftKey) return false;

    // Handle special key matching (brackets with shift produce different characters)
    const keyLower = e.key.toLowerCase();
    const expectedKey = keys.key.toLowerCase();

    if (keyLower === expectedKey) return true;

    // Handle bracket shortcuts with shift (] and } are the same key)
    if (keys.key === "]" && (e.key === "]" || e.key === "}")) return true;
    if (keys.key === "[" && (e.key === "[" || e.key === "{")) return true;

    return false;
  }

  private isGlobalShortcut(shortcut: ShortcutDefinition): boolean {
    // Shortcuts that should work even in input fields
    const globalIds = [
      "toggleSidebar",
      "showShortcuts",
      "commandPalette",
      "saveQuery",
      "formatSql",
      "openSettings",
      "openProjectSettings",
    ];
    return globalIds.includes(shortcut.id);
  }

  toggleHelp() {
    this.showHelp = !this.showHelp;
  }

  closeHelp() {
    this.showHelp = false;
  }
}

const SHORTCUTS_KEY = Symbol("shortcuts");

export function setShortcuts(): ShortcutManager {
  return setContext(SHORTCUTS_KEY, new ShortcutManager());
}

export function useShortcuts(): ShortcutManager {
  return getContext<ShortcutManager>(SHORTCUTS_KEY);
}
