import type { Node, Edge, Viewport } from "@xyflow/svelte";
import type { WorkflowTimelineEntry, WorkflowNodeData } from "$lib/types/workflow";

/**
 * Workflow state - manages the state of the workflow view
 * Follows the Svelte 5 runes pattern used by DatabaseState
 */
export class WorkflowState {
  // Current workflow nodes and edges
  nodes = $state<Node<WorkflowNodeData>[]>([]);
  edges = $state<Edge[]>([]);

  // Timeline entries for current session
  timeline = $state<WorkflowTimelineEntry[]>([]);

  // Active workflow ID (null = unsaved workflow)
  activeWorkflowId = $state<string | null>(null);

  // Viewport state
  viewport = $state<Viewport>({ x: 0, y: 0, zoom: 1 });

  // Track which connection is active for the workflow
  activeConnectionId = $state<string | null>(null);

  // Check if there are unsaved changes
  hasUnsavedChanges = $derived(this.nodes.length > 0 || this.edges.length > 0);

  // Get node by ID
  getNode(nodeId: string): Node<WorkflowNodeData> | undefined {
    return this.nodes.find((n) => n.id === nodeId);
  }

  // Get edges connected to a node
  getConnectedEdges(nodeId: string): Edge[] {
    return this.edges.filter((e) => e.source === nodeId || e.target === nodeId);
  }
}
