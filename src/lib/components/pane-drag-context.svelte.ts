import { setContext, getContext } from "svelte";

const EDGE_ZONE_PX = 80;

export interface SplitTarget {
  paneId: string;
  direction: "left" | "right";
}

export interface MoveTarget {
  paneId: string;
  index: number;
  /** Absolute X position for the insertion indicator line */
  indicatorX: number;
  /** Top Y of the tab bar for positioning the indicator */
  indicatorY: number;
  /** Height of the tab bar */
  indicatorH: number;
}

export interface DragEndResult {
  tabId: string;
  sourcePaneId: string;
  splitTarget?: SplitTarget;
  moveTarget?: MoveTarget;
}

/**
 * Shared drag state for cross-pane tab dragging.
 * Tracks pointer position globally during drag to detect:
 * - Edge zones: drag to pane edge → split
 * - Tab bar zones: drag to another pane's tab bar → move tab between panes
 */
export class PaneDragState {
  isDragging = $state(false);
  draggedTabId = $state<string | undefined>(undefined);
  dragSourcePaneId = $state<string | undefined>(undefined);
  splitTarget = $state<SplitTarget | null>(null);
  moveTarget = $state<MoveTarget | null>(null);

  private paneElements = new Map<string, HTMLElement>();
  private tabBarElements = new Map<string, HTMLElement>();
  private onPointerMove: ((e: PointerEvent) => void) | null = null;

  /** Register a pane's DOM element for edge-zone hit-testing. */
  registerPane(paneId: string, el: HTMLElement) {
    this.paneElements.set(paneId, el);
  }

  unregisterPane(paneId: string) {
    this.paneElements.delete(paneId);
  }

  /** Register a pane's tab bar element for move-target hit-testing. */
  registerTabBar(paneId: string, el: HTMLElement) {
    this.tabBarElements.set(paneId, el);
  }

  unregisterTabBar(paneId: string) {
    this.tabBarElements.delete(paneId);
  }

  startDrag(tabId: string, paneId: string) {
    this.isDragging = true;
    this.draggedTabId = tabId;
    this.dragSourcePaneId = paneId;
    this.splitTarget = null;
    this.moveTarget = null;

    this.onPointerMove = (e: PointerEvent) => {
      this.updateTargets(e.clientX, e.clientY);
    };
    document.addEventListener("pointermove", this.onPointerMove);
  }

  endDrag(): DragEndResult | null {
    const tabId = this.draggedTabId;
    const sourcePaneId = this.dragSourcePaneId;
    const split = this.splitTarget;
    const move = this.moveTarget;

    this.isDragging = false;
    this.draggedTabId = undefined;
    this.dragSourcePaneId = undefined;
    this.splitTarget = null;
    this.moveTarget = null;

    if (this.onPointerMove) {
      document.removeEventListener("pointermove", this.onPointerMove);
      this.onPointerMove = null;
    }

    if (!tabId || !sourcePaneId) return null;

    if (split) return { tabId, sourcePaneId, splitTarget: split };
    if (move) return { tabId, sourcePaneId, moveTarget: move };
    return null;
  }

  private updateTargets(clientX: number, clientY: number) {
    // First check: is the pointer over a different pane's tab bar? → move target
    for (const [paneId, el] of this.tabBarElements) {
      if (paneId === this.dragSourcePaneId) continue;
      const rect = el.getBoundingClientRect();
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        // Calculate insertion index from tab positions
        const { index, indicatorX } = this.calcInsertIndex(el, clientX);
        this.splitTarget = null;
        this.moveTarget = {
          paneId,
          index,
          indicatorX,
          indicatorY: rect.top,
          indicatorH: rect.height,
        };
        return;
      }
    }

    // Second check: is the pointer in a pane's edge zone? → split target
    for (const [paneId, el] of this.paneElements) {
      const rect = el.getBoundingClientRect();
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        const distFromLeft = clientX - rect.left;
        const distFromRight = rect.right - clientX;

        if (distFromLeft < EDGE_ZONE_PX) {
          this.moveTarget = null;
          this.splitTarget = { paneId, direction: "left" };
          return;
        }
        if (distFromRight < EDGE_ZONE_PX) {
          this.moveTarget = null;
          this.splitTarget = { paneId, direction: "right" };
          return;
        }
      }
    }

    this.splitTarget = null;
    this.moveTarget = null;
  }

  /**
   * Find the insertion index by comparing pointer X against
   * the midpoints of tab elements inside the tab bar's dnd container.
   */
  private calcInsertIndex(
    tabBarEl: HTMLElement,
    clientX: number,
  ): { index: number; indicatorX: number } {
    // The dnd container is the first child div of the scrollable tab bar
    const dndContainer = tabBarEl.firstElementChild;
    if (!dndContainer) return { index: 0, indicatorX: tabBarEl.getBoundingClientRect().left };

    const tabs = Array.from(dndContainer.children) as HTMLElement[];
    if (tabs.length === 0) return { index: 0, indicatorX: tabBarEl.getBoundingClientRect().left };

    for (let i = 0; i < tabs.length; i++) {
      const tabRect = tabs[i].getBoundingClientRect();
      const midX = tabRect.left + tabRect.width / 2;
      if (clientX < midX) {
        return { index: i, indicatorX: tabRect.left };
      }
    }

    // After all tabs
    const lastRect = tabs[tabs.length - 1].getBoundingClientRect();
    return { index: tabs.length, indicatorX: lastRect.right };
  }
}

const DRAG_CONTEXT_KEY = "pane-drag-state";

export function setPaneDragState(): PaneDragState {
  const state = new PaneDragState();
  setContext(DRAG_CONTEXT_KEY, state);
  return state;
}

export function usePaneDragState(): PaneDragState | undefined {
  return getContext<PaneDragState | undefined>(DRAG_CONTEXT_KEY);
}
