<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { mode } from "mode-watcher";
	import { initMonaco, monaco } from "$lib/monaco";

	let {
		original = "",
		modified = "",
		originalWidth = $bindable(0),
		class: className = ""
	}: {
		original?: string;
		modified?: string;
		originalWidth?: number;
		class?: string;
	} = $props();

	// oxlint-disable-next-line eslint(no-unassigned-vars)
	let container: HTMLDivElement;
	let diffEditor = $state<monaco.editor.IDiffEditor | null>(null);
	let originalModel: monaco.editor.ITextModel | null = null;
	let modifiedModel: monaco.editor.ITextModel | null = null;
	let layoutDisposable: monaco.IDisposable | null = null;

	onMount(async () => {
		await initMonaco();

		const theme = mode.current === "dark" ? "seaquel-dark" : "seaquel-light";

		originalModel = monaco.editor.createModel(original, "pgsql");
		modifiedModel = monaco.editor.createModel(modified, "pgsql");

		const editor = monaco.editor.createDiffEditor(container, {
			automaticLayout: true,
			readOnly: true,
			renderSideBySide: true,
			minimap: { enabled: false },
			fontSize: 13,
			fontFamily: "ui-monospace, monospace",
			scrollBeyondLastLine: false,
			padding: { top: 8, bottom: 8 },
			scrollbar: {
				verticalScrollbarSize: 10,
				horizontalScrollbarSize: 10
			},
			theme
		});

		editor.setModel({ original: originalModel, modified: modifiedModel });
		diffEditor = editor;

		// Track original editor width to expose for header alignment
		const updateOriginalWidth = () => {
			const origEditor = editor.getOriginalEditor();
			originalWidth = origEditor.getLayoutInfo().width;
		};
		layoutDisposable = editor.getOriginalEditor().onDidLayoutChange(updateOriginalWidth);
		updateOriginalWidth();
	});

	onDestroy(() => {
		layoutDisposable?.dispose();
		diffEditor?.dispose();
		originalModel?.dispose();
		modifiedModel?.dispose();
	});

	// React to prop changes
	$effect(() => {
		const o = original;
		const m = modified;
		if (originalModel && modifiedModel) {
			originalModel.setValue(o);
			modifiedModel.setValue(m);
		}
	});

	// React to theme changes
	$effect(() => {
		const theme = mode.current === "dark" ? "seaquel-dark" : "seaquel-light";
		if (diffEditor) {
			monaco.editor.setTheme(theme);
		}
	});
</script>

<div bind:this={container} class={["h-full w-full", className].join(" ")}></div>
