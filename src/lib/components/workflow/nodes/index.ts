import type { NodeTypes } from "@xyflow/svelte";
import WorkflowTableNode from "./table-node.svelte";
import WorkflowQueryNode from "./query-node.svelte";
import WorkflowResultNode from "./result-node.svelte";
import WorkflowChartNode from "./chart-node.svelte";

export { WorkflowTableNode, WorkflowQueryNode, WorkflowResultNode, WorkflowChartNode };

export const workflowNodeTypes: NodeTypes = {
  tableNode: WorkflowTableNode,
  queryNode: WorkflowQueryNode,
  resultNode: WorkflowResultNode,
  chartNode: WorkflowChartNode,
};
