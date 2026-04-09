<script lang="ts">
	import { m } from "$lib/paraglide/messages.js";
	import {
		Select,
		SelectContent,
		SelectItem,
		SelectTrigger,
	} from "$lib/components/ui/select";
	import { editorSettingsStore, type EditorKeybindingMode } from "$lib/stores/editor-settings.svelte.js";
</script>

<div class="space-y-6" data-section="editor">
	<div>
		<h2 class="text-lg font-medium">{m.settings_editor()}</h2>
		<p class="text-sm text-muted-foreground mt-1">
			{m.settings_editor_description()}
		</p>
	</div>

	<div class="space-y-4">
		<div class="flex items-center justify-between">
			<div>
				<p class="text-sm font-medium">{m.settings_editor_keybinding_mode()}</p>
				<p class="text-xs text-muted-foreground">
					{m.settings_editor_keybinding_mode_description()}
				</p>
			</div>
			<Select
				type="single"
				value={editorSettingsStore.keybindingMode}
				onValueChange={(v) => editorSettingsStore.setKeybindingMode(v as EditorKeybindingMode)}
			>
				<SelectTrigger class="w-32">
					{editorSettingsStore.keybindingMode === "vim"
						? m.settings_editor_keybinding_vim()
						: editorSettingsStore.keybindingMode === "emacs"
							? m.settings_editor_keybinding_emacs()
							: m.settings_editor_keybinding_default()}
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="default">{m.settings_editor_keybinding_default()}</SelectItem>
					<SelectItem value="vim">{m.settings_editor_keybinding_vim()}</SelectItem>
					<SelectItem value="emacs">{m.settings_editor_keybinding_emacs()}</SelectItem>
				</SelectContent>
			</Select>
		</div>
	</div>
</div>
