<script lang="ts">
	import { NodeResizer } from "@xyflow/svelte";
	import type { DashboardWidget } from "$lib/types";
	import DashboardWidgetComponent from "../dashboard-widget.svelte";

	interface Props {
		id: string;
		data: {
			widget: DashboardWidget;
			onEditWidget: (widget: DashboardWidget) => void;
			onRefreshWidget: (widgetId: string) => void;
			onDuplicateWidget: (widget: DashboardWidget) => void;
			onDeleteWidget: (widgetId: string) => void;
			onResizeEnd: (widgetId: string, size: { width: number; height: number }) => void;
		};
		selected?: boolean;
	}

	let { id, data, selected = false }: Props = $props();

	let hovered = $state(false);

	function handleResizeEnd(_event: unknown, params: { width: number; height: number }) {
		data.onResizeEnd(id, { width: params.width, height: params.height });
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="h-full w-full"
	onpointerenter={() => (hovered = true)}
	onpointerleave={() => (hovered = false)}
>
	<NodeResizer
		minWidth={200}
		minHeight={100}
		isVisible={hovered || selected}
		lineClass="!border-primary"
		handleClass="!bg-primary !border-primary"
		onResizeEnd={handleResizeEnd}
	/>

	<DashboardWidgetComponent
		widget={data.widget}
		isEditing={selected}
		onclick={() => data.onEditWidget(data.widget)}
		onRefresh={() => data.onRefreshWidget(id)}
		onDuplicate={() => data.onDuplicateWidget(data.widget)}
		onDelete={() => data.onDeleteWidget(id)}
	/>
</div>
