<script lang="ts">
  import { aiSettingsStore } from "$lib/stores/ai-settings.svelte";
  import { settingsDialogStore } from "$lib/stores/settings-dialog.svelte.js";
  import { m } from "$lib/paraglide/messages.js";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";

  interface Props {
    providerId: string | null;
    model: string | null;
    onSelect: (providerId: string, model: string) => void;
  }

  let { providerId, model, onSelect }: Props = $props();

  let open = $state(false);
  let modelsByProvider = $state<Record<string, string[]>>({});
  let loadingByProvider = $state<Record<string, boolean>>({});

  async function fetchAll(signal: AbortSignal) {
    for (const p of aiSettingsStore.settings.providers) {
      if (signal.aborted) return;
      if (modelsByProvider[p.id]) continue;
      loadingByProvider = { ...loadingByProvider, [p.id]: true };
      const models = await aiSettingsStore.fetchModels(p.id);
      if (signal.aborted) return;
      modelsByProvider = { ...modelsByProvider, [p.id]: models };
      loadingByProvider = { ...loadingByProvider, [p.id]: false };
    }
  }

  let fetchController: AbortController | null = null;

  function toggle() {
    open = !open;
    if (open) {
      fetchController?.abort();
      fetchController = new AbortController();
      modelsByProvider = {};
      loadingByProvider = {};
      fetchAll(fetchController.signal);
    } else {
      fetchController?.abort();
      fetchController = null;
    }
  }

  const activeProvider = $derived(
    providerId ? aiSettingsStore.getProvider(providerId) : null
  );

  const label = $derived(
    activeProvider && model
      ? `${activeProvider.name} / ${model}`
      : m.ai_model_switcher_no_model()
  );
</script>

<div class="relative">
  <button
    type="button"
    class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    onclick={toggle}
  >
    <span class="truncate max-w-48">{label}</span>
    <ChevronDownIcon class="size-3 shrink-0" />
  </button>

  {#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="fixed inset-0 z-40" onclick={() => (open = false)}></div>
    <div class="absolute bottom-full mb-1 left-0 z-50 min-w-56 max-w-72 bg-popover border rounded-md shadow-md overflow-hidden">
      {#if aiSettingsStore.settings.providers.length === 0}
        <div class="p-3 text-xs text-muted-foreground">
          {m.settings_ai_configure_prompt()}
          <button
            type="button"
            class="underline ml-1"
            onclick={() => { open = false; settingsDialogStore.open("ai-provider"); }}
          >{m.settings_ai_configure_link()}</button>
        </div>
      {:else}
        {#each aiSettingsStore.settings.providers as p (p.id)}
          <div>
            <div class="px-3 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50 border-b">
              {p.name}
            </div>
            {#if loadingByProvider[p.id]}
              <div class="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                <LoaderCircleIcon class="size-3 animate-spin" />
                <span>{m.settings_ai_fetching_models()}</span>
              </div>
            {:else if (modelsByProvider[p.id] ?? []).length === 0}
              <div class="px-3 py-2 text-xs text-muted-foreground italic">
                {m.settings_ai_fetch_models_error()}
              </div>
            {:else}
              {#each modelsByProvider[p.id] as modelId (modelId)}
                <button
                  type="button"
                  class={[
                    "w-full text-left px-3 py-1.5 text-xs hover:bg-accent",
                    providerId === p.id && model === modelId ? "font-semibold text-foreground" : "text-muted-foreground"
                  ]}
                  onclick={() => { onSelect(p.id, modelId); open = false; }}
                >
                  {modelId}
                </button>
              {/each}
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</div>
