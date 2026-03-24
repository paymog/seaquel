import type { AIMessage } from "$lib/types";
import type { DatabaseState } from "./state.svelte.js";
import type { AIChatManager } from "./ai-chat-manager.svelte.js";
import { sendAIMessage as sendAIMessageService } from "$lib/services/ai";
import { aiSettingsStore } from "$lib/stores/ai-settings.svelte";

/**
 * Manages UI state: AI panel, view switching.
 */
export class UIStateManager {
  aiAllowAllQueries = $state(false);

  constructor(
    private state: DatabaseState,
    private schedulePersistence: (projectId: string | null) => void,
    private executeRawQuery: (query: string) => Promise<Record<string, unknown>[]>,
    private aiChatManager: AIChatManager,
    private persistAIChatMessages: (chatId: string) => Promise<void>,
  ) {}

  setAIAllowAll() {
    this.aiAllowAllQueries = true;
  }

  resetAISessionState() {
    this.aiAllowAllQueries = false;
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

    this._dispatchToAI(content, chatId);
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

  private _dispatchToAI(content: string, chatId: string) {
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

    void sendAIMessageService({
      messages: this._getMessages(chatId).filter(
        (m) => m.id !== assistantMessageId && !m.pendingModelSelection,
      ),
      schema: this.state.activeSchema,
      shareSchema,
      shareData,
      providerId: activeProviderId,
      model: activeModel,
      connectionName: activeConn?.name ?? "Unknown",
      databaseType: activeConn?.type,
      executeQuery: this.executeRawQuery,
      aiAllowAllQueries: this.aiAllowAllQueries,
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
      | "dashboard",
  ) {
    this.state.activeView = view;
    this.schedulePersistence(this.state.activeProjectId);
  }
}
