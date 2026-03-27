<script lang="ts">
	import type { Snippet } from "svelte";
	import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";

	type Props = {
		open?: boolean;
		title: string;
		description?: string;
		cancelText: string;
		confirmText: string;
		onconfirm: () => void;
		children?: Snippet;
	};

	let {
		open = $bindable(false),
		title,
		description,
		cancelText,
		confirmText,
		onconfirm,
		children
	}: Props = $props();
</script>

<AlertDialog.Root bind:open>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{title}</AlertDialog.Title>
			<AlertDialog.Description>
				{#if children}
					{@render children()}
				{:else}
					{description}
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>{cancelText}</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={onconfirm}
				class="bg-destructive text-white hover:bg-destructive/90"
			>
				{confirmText}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
