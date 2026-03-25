import type { AIMessage, DashboardWidget } from "$lib/types";
import type { DatabaseState } from "./state.svelte.js";
import type { AIChatManager } from "./ai-chat-manager.svelte.js";
import type { DashboardManager } from "./dashboard-manager.svelte.js";
import type { DashboardTabManager } from "./dashboard-tabs.svelte.js";
import { sendAIMessage as sendAIMessageService } from "$lib/services/ai";
import { resolveMentions } from "$lib/services/ai-mentions";
import { aiSettingsStore } from "$lib/stores/ai-settings.svelte";

/**
 * Manages UI state: AI panel, view switching.
 */
export class UIStateManager {
  aiAllowAllQueries = $state(false);
  private aiAbortController: AbortController | null = null;

  constructor(
    private state: DatabaseState,
    private schedulePersistence: (projectId: string | null) => void,
    private executeRawQuery: (query: string) => Promise<Record<string, unknown>[]>,
    private aiChatManager: AIChatManager,
    private persistAIChatMessages: (chatId: string) => Promise<void>,
    private dashboardManager: DashboardManager,
    private dashboardTabs: DashboardTabManager,
  ) {}

  setAIAllowAll() {
    this.aiAllowAllQueries = true;
  }

  resetAISessionState() {
    this.aiAllowAllQueries = false;
  }

  cancelAIStream() {
    if (this.aiAbortController) {
      this.aiAbortController.abort();
      this.aiAbortController = null;
    }
    this.state.isAIStreaming = false;
  }

  toggleAI() {
    this.state.isAIOpen = !this.state.isAIOpen;
  }

  sendAIMessage(content: string) {
    const chatId = this.aiChatManager.ensureActiveChat();
    if (!chatId) return;

    const messages = this.state.aiMessagesByChat[chatId] ?? [];
    const isFirstMessage = messages.filter((m) => m.role === "user").length === 0;

    const userMessage: AIMessage = {
      id: crypto.randomUUID(),
      chatId,
      role: "user",
      content,
      timestamp: new Date(),
    };
    this._setMessages(chatId, [...messages, userMessage]);

    if (isFirstMessage) {
      this.aiChatManager.updateChatTitle(chatId, content);
    }

    const enrichedContent = resolveMentions(
      content,
      this.state.activeSchema,
      this.state.savedQueriesByProject[this.state.activeProjectId ?? ""] ?? [],
      this.state.dashboardsByProject[this.state.activeProjectId ?? ""] ?? [],
    );

    this._dispatchToAI(content, chatId, enrichedContent);
  }

  retryPendingMessage(messageId: string) {
    const chatId = this.state.activeAIChatId;
    if (!chatId) return;
    const messages = this.state.aiMessagesByChat[chatId] ?? [];
    const msg = messages.find((m) => m.id === messageId);
    if (!msg?.pendingModelSelection) return;
    const content = msg.pendingModelSelection;
    this._setMessages(
      chatId,
      messages.filter((m) => m.id !== messageId),
    );
    this._dispatchToAI(content, chatId);
  }

  private _getMessages(chatId: string): AIMessage[] {
    return this.state.aiMessagesByChat[chatId] ?? [];
  }

  private _setMessages(chatId: string, messages: AIMessage[]) {
    this.state.aiMessagesByChat = {
      ...this.state.aiMessagesByChat,
      [chatId]: messages,
    };
  }

  private _updateMessage(chatId: string, messageId: string, updater: (m: AIMessage) => AIMessage) {
    this._setMessages(
      chatId,
      this._getMessages(chatId).map((m) => (m.id === messageId ? updater(m) : m)),
    );
  }

  private _dispatchToAI(content: string, chatId: string, enrichedContent?: string) {
    const settings = aiSettingsStore.settings;
    const activeConn = this.state.activeConnection;
    const shareSchema =
      activeConn?.aiShareSchema !== undefined
        ? activeConn.aiShareSchema
        : settings.shareSchemaGlobally;
    const shareData =
      activeConn?.aiShareData !== undefined ? activeConn.aiShareData : settings.shareDataGlobally;

    const activeProviderId = activeConn?.activeAIProviderId ?? null;
    const activeModel = activeConn?.activeAIModel ?? null;

    if (!activeProviderId || !activeModel) {
      const noModelMsg: AIMessage = {
        id: crypto.randomUUID(),
        chatId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
        pendingModelSelection: content,
      };
      this._setMessages(chatId, [...this._getMessages(chatId), noModelMsg]);
      return;
    }

    const assistantMessageId = crypto.randomUUID();
    const assistantMessage: AIMessage = {
      id: assistantMessageId,
      chatId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
    };
    this._setMessages(chatId, [...this._getMessages(chatId), assistantMessage]);
    this.state.isAIStreaming = true;

    if (this.aiAbortController) this.aiAbortController.abort();
    this.aiAbortController = new AbortController();
    const { signal } = this.aiAbortController;

    const rawMessages = this._getMessages(chatId).filter(
      (m) => m.id !== assistantMessageId && !m.pendingModelSelection,
    );
    const messagesForApi = enrichedContent
      ? rawMessages.map((msg, i) => {
          if (i === rawMessages.length - 1 && msg.role === "user") {
            return { ...msg, content: enrichedContent };
          }
          return msg;
        })
      : rawMessages;

    void sendAIMessageService({
      messages: messagesForApi,
      schema: this.state.activeSchema,
      shareSchema,
      shareData,
      providerId: activeProviderId,
      model: activeModel,
      connectionName: activeConn?.name ?? "Unknown",
      databaseType: activeConn?.type,
      executeQuery: this.executeRawQuery,
      aiAllowAllQueries: this.aiAllowAllQueries,
      signal,
      onApprovalRequired: (query, connName, approve, deny) => {
        this._updateMessage(chatId, assistantMessageId, (m) => ({
          ...m,
          pendingApproval: { query, connectionName: connName, approve, deny },
        }));
      },
      onChunk: (delta: string) => {
        this._updateMessage(chatId, assistantMessageId, (m) => ({
          ...m,
          content: m.content + delta,
        }));
      },
      onDone: () => {
        this.state.isAIStreaming = false;
        this._updateMessage(chatId, assistantMessageId, (m) => ({
          ...m,
          pendingApproval: null,
        }));
        this.aiChatManager.updateChatTimestamp(chatId);
        void this.persistAIChatMessages(chatId);
      },
      onError: (err: string) => {
        this.state.isAIStreaming = false;
        const errorContent =
          err === "no_provider"
            ? "No AI provider configured. Please add one in **Settings → AI**."
            : err === "no_api_key"
              ? "No API key configured. Please add your key in **Settings → AI**."
              : err === "rate_limit"
                ? "Rate limit reached. Please wait a moment and try again."
                : `Error: ${err}`;
        this._updateMessage(chatId, assistantMessageId, (m) => ({
          ...m,
          content: errorContent,
          pendingApproval: null,
        }));
        void this.persistAIChatMessages(chatId);
      },
      onCreateDashboard: async (name: string) => {
        const dashboard = await this.dashboardManager.createDashboard(name);
        if (!dashboard) return null;
        this.dashboardTabs.add(dashboard.id, name);
        return { dashboardId: dashboard.id };
      },
      onAddWidget: async (
        dashboardId: string,
        widget: Omit<DashboardWidget, "id" | "result" | "isLoading" | "error" | "lastRefreshed">,
      ) => {
        const widgetId = `widget-${crypto.randomUUID()}`;
        const fullWidget = { ...widget, id: widgetId } as DashboardWidget;
        await this.dashboardManager.addWidget(dashboardId, fullWidget);
        await this.dashboardManager.executeWidget(dashboardId, widgetId);
        return { widgetId };
      },
      onGetDashboard: (dashboardId: string) => {
        const dashboard = this.dashboardManager.getDashboard(dashboardId);
        if (!dashboard) return null;
        return {
          id: dashboard.id,
          name: dashboard.name,
          widgets: dashboard.widgets.map(
            ({ result: _, isLoading: __, error: ___, lastRefreshed: ____, ...rest }) => rest,
          ),
        };
      },
      onUpdateWidget: async (
        dashboardId: string,
        widgetId: string,
        updates: Partial<DashboardWidget>,
      ) => {
        const queryChanged = updates.query !== undefined;
        await this.dashboardManager.updateWidget(dashboardId, widgetId, updates);
        if (queryChanged) {
          await this.dashboardManager.executeWidget(dashboardId, widgetId);
        }
      },
      onRemoveWidget: async (dashboardId: string, widgetId: string) => {
        await this.dashboardManager.removeWidget(dashboardId, widgetId);
      },
    });
  }

  setActiveView(
    view:
      | "query"
      | "schema"
      | "explain"
      | "erd"
      | "statistics"
      | "workflow"
      | "visualize"
      | "connection"
      | "dashboard"
      | "starter",
  ) {
    this.state.activeView = view;
    this.schedulePersistence(this.state.activeProjectId);
  }
}
