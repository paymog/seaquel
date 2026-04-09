import { toast } from "svelte-sonner";
import { generateSQL } from "$lib/services/ai";
import { aiSettingsStore } from "$lib/stores/ai-settings.svelte";
import type { QueryEditorContext } from "./types.js";

interface AIPromptError {
  message: string;
  action?: { label: string; fn: () => void };
}

export function createAIInlinePrompt(
  ctx: QueryEditorContext,
  callbacks: { onExecute: () => void },
) {
  const { db } = ctx;

  let open = $state(false);
  let text = $state("");
  let loading = $state(false);
  let error = $state<AIPromptError | null>(null);

  function handleOpen() {
    text = "";
    error = null;
    open = true;
  }

  function close() {
    open = false;
    text = "";
    loading = false;
    error = null;
  }

  async function submit() {
    if (!text.trim() || loading) return;
    loading = true;
    try {
      const activeConn = db.state.activeConnection;
      const shareSchema =
        activeConn?.aiShareSchema !== undefined
          ? activeConn.aiShareSchema
          : aiSettingsStore.settings.shareSchemaGlobally;
      const activeProviderId = activeConn?.activeAIProviderId ?? null;
      const activeModel = activeConn?.activeAIModel ?? null;

      if (!activeProviderId || !activeModel) {
        if (aiSettingsStore.settings.providers.length === 0) {
          error = {
            message: "No AI provider configured.",
            action: {
              label: "Configure",
              fn: () => {
                db.settingsTabs.open("app", "ai-provider");
                close();
              },
            },
          };
        } else {
          error = {
            message: "No model selected. Pick one from the model switcher to the right.",
          };
        }
        loading = false;
        return;
      }

      const sql = await generateSQL({
        request: text,
        existingQuery: ctx.getActiveTab()?.query ?? "",
        schema: db.state.activeSchema ?? [],
        shareSchema,
        providerId: activeProviderId,
        model: activeModel,
        databaseType: db.state.activeConnection?.type,
      });
      ctx.getMonacoRef()?.insertText(sql);
      open = false;
      text = "";
      callbacks.onExecute();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "no_provider") {
        error = {
          message: "No AI provider configured.",
          action: {
            label: "Configure",
            fn: () => {
              db.settingsTabs.open("app", "ai-provider");
              close();
            },
          },
        };
      } else if (msg === "no_api_key") {
        error = {
          message: "No API key configured.",
          action: {
            label: "Settings \u2192 AI",
            fn: () => {
              db.settingsTabs.open("app", "ai-provider");
              close();
            },
          },
        };
      } else if (msg === "rate_limit") {
        error = { message: "Rate limit reached. Please wait and try again." };
      } else {
        error = { message: "Something went wrong. Please try again." };
        toast.error(msg);
      }
    } finally {
      loading = false;
    }
  }

  const focusOnMount = () => (el: HTMLInputElement) => {
    el.focus();
  };

  return {
    get open() {
      return open;
    },
    set open(v: boolean) {
      open = v;
    },
    get text() {
      return text;
    },
    set text(v: string) {
      text = v;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    set error(v: AIPromptError | null) {
      error = v;
    },

    handleOpen,
    submit,
    close,
    focusOnMount,
  };
}
