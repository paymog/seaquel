/**
 * Pane layout types for split pane support.
 * Panes allow side-by-side tab groups within the main content area.
 * @module types/pane
 */

/**
 * A single pane containing an ordered set of tabs.
 * Each pane renders its own tab bar and content view.
 */
export interface Pane {
  /** Unique identifier */
  id: string;
  /** Ordered tab IDs within this pane */
  tabIds: string[];
  /** Currently visible tab in this pane */
  activeTabId: string | null;
}

/**
 * Layout of all panes for a project.
 * Panes are arranged horizontally (left-to-right).
 */
export interface PaneLayout {
  /** Ordered panes (left-to-right) */
  panes: Pane[];
  /** Which pane currently has focus */
  activePaneId: string;
}
