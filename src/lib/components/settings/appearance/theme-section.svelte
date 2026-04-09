<script lang="ts">
	import { m } from "$lib/paraglide/messages.js";
	import {
		Select,
		SelectContent,
		SelectItem,
		SelectTrigger,
	} from "$lib/components/ui/select";
	import { setMode, resetMode, mode } from "mode-watcher";
	import { setTheme } from "@tauri-apps/api/app";

	async function handleModeChange(value: string) {
		if (value === "system") {
			await setTheme(null);
			resetMode();
		} else {
			await setTheme(value as "light" | "dark");
			setMode(value as "light" | "dark");
		}
	}

	const currentMode = $derived(
		mode.current === "light" ? "light" : mode.current === "dark" ? "dark" : "system"
	);

	const modeLabel = $derived(
		currentMode === "light"
			? m.theme_light()
			: currentMode === "dark"
				? m.theme_dark()
				: m.theme_system()
	);
</script>

<div class="space-y-6" data-section="theme">
	<div>
		<h2 class="text-lg font-medium">{m.settings_theme()}</h2>
		<p class="text-sm text-muted-foreground mt-1">
			{m.settings_theme_description()}
		</p>
	</div>

	<div class="space-y-4">
		<div class="flex items-center justify-between">
			<div>
				<p class="text-sm font-medium">{m.settings_theme_label()}</p>
				<p class="text-xs text-muted-foreground">
					Choose between light, dark, or system mode
				</p>
			</div>
			<Select
				type="single"
				value={currentMode}
				onValueChange={handleModeChange}
			>
				<SelectTrigger class="w-32">
					{modeLabel}
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="light">{m.theme_light()}</SelectItem>
					<SelectItem value="dark">{m.theme_dark()}</SelectItem>
					<SelectItem value="system">{m.theme_system()}</SelectItem>
				</SelectContent>
			</Select>
		</div>
	</div>
</div>
