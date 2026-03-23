<script lang="ts">
	import WorkflowSidebar from "./workflow-sidebar.svelte";
	import WorkflowWorkspace from "./workflow-workspace.svelte";
</script>

<!-- Use flex-1 to fill the parent flex container -->
<div class="flex flex-1 min-h-0 w-full overflow-hidden">
	<!-- Workflow-specific sidebar for adding nodes, saved workflows, etc. -->
	<WorkflowSidebar />

	<!-- Workflow workspace - needs flex container for child to use flex-1 -->
	<div class="flex flex-col flex-1 min-h-0 min-w-0">
		<WorkflowWorkspace />
	</div>
</div>
