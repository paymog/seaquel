import type { NodeTypes } from "@xyflow/svelte";
import DashboardWidgetNode from "./dashboard-widget-node.svelte";

export const dashboardNodeTypes: NodeTypes = {
  dashboardWidget: DashboardWidgetNode,
};
