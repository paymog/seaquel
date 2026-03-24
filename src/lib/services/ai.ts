import type { SchemaTable } from "$lib/types";
import type { AIMessage } from "$lib/types/query";
import type { DatabaseType } from "$lib/types/database";
import { aiSettingsStore } from "$lib/stores/ai-settings.svelte";
import { getKeyringService } from "$lib/services/keyring";

// --- Tool definition ---

const RUN_QUERY_TOOL = {
  name: "run_query",
  description:
    "Run a read-only SQL SELECT query against the connected database. Use this to fetch data that helps answer the user's question. Only SELECT and WITH queries are allowed.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "A read-only SELECT or WITH query",
      },
    },
    required: ["query"],
  },
};

// --- Read-only query validation ---

function validateReadOnlyQuery(query: string): string | null {
  const trimmed = query.trim();
  const upper = trimmed.toUpperCase();
  if (!/^(SELECT|WITH)\b/.test(upper)) {
    return "Only read-only SELECT queries are permitted";
  }
  const dml = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/;
  if (dml.test(upper)) {
    return "Only read-only SELECT queries are permitted";
  }
  return null;
}

// --- Run query and format result ---

async function runAndFormat(
  query: string,
  executeQuery: (q: string) => Promise<Record<string, unknown>[]>,
): Promise<string> {
  try {
    const rows = await executeQuery(query);
    if (rows.length === 0) return "Query returned no rows.";
    const columns = Object.keys(rows[0]);
    return buildDataContext(rows, columns);
  } catch (err) {
    return `Query error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// --- Context builders ---

export function buildSchemaContext(tables: SchemaTable[]): string {
  if (tables.length === 0) return "";
  const lines: string[] = ["Database schema:"];
  for (const table of tables) {
    lines.push(`\nTable: ${table.name}`);
    for (const col of table.columns) {
      const nullable = col.nullable ? "" : " NOT NULL";
      lines.push(`  ${col.name} ${col.type}${nullable}`);
    }
    if (table.indexes && table.indexes.length > 0) {
      for (const idx of table.indexes) {
        lines.push(`  INDEX ${idx.name} (${idx.columns.join(", ")})`);
      }
    }
  }
  return lines.join("\n");
}

export function buildDataContext(rows: Record<string, unknown>[], columns: string[]): string {
  if (rows.length === 0 || columns.length === 0) return "";
  const sample = rows.slice(0, 5);
  const header = `| ${columns.join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const dataRows = sample.map(
    // oxlint-disable-next-line typescript-eslint(no-base-to-string)
    (row) => `| ${columns.map((c) => String(row[c] ?? "NULL")).join(" | ")} |`,
  );
  return ["Sample data:", header, separator, ...dataRows].join("\n");
}

const DATABASE_LABELS: Record<DatabaseType, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
  mariadb: "MariaDB",
  mssql: "SQL Server",
  duckdb: "DuckDB",
};

function buildSystemPrompt(schemaCtx: string, dbType?: DatabaseType): string {
  const dbLabel = dbType ? DATABASE_LABELS[dbType] : "SQL";
  const parts = [
    `You are a helpful SQL assistant for a ${dbLabel} database. Always use ${dbLabel}-compatible syntax.`,
  ];
  if (schemaCtx) parts.push(schemaCtx);
  parts.push(
    "Provide clear, concise SQL queries and explanations. When writing SQL, wrap it in a markdown code block.",
  );
  return parts.join("\n\n");
}

// --- Message sending ---

export interface SendAIMessageParams {
  providerId: string;
  model: string;
  messages: AIMessage[];
  schema: SchemaTable[];
  shareSchema: boolean;
  shareData: boolean;
  connectionName: string;
  databaseType?: DatabaseType;
  executeQuery: (query: string) => Promise<Record<string, unknown>[]>;
  aiAllowAllQueries: boolean;
  onApprovalRequired: (
    query: string,
    connectionName: string,
    approve: () => void,
    deny: () => void,
  ) => void;
  onChunk: (delta: string) => void;
  onDone: () => void;
  onError: (msg: string) => void;
}

interface TurnResult {
  assistantText: string;
  toolCall: { id: string; name: string; input: Record<string, unknown> } | null;
}

export async function sendAIMessage(params: SendAIMessageParams): Promise<void> {
  const {
    messages,
    schema,
    shareSchema,
    shareData,
    connectionName,
    databaseType,
    executeQuery,
    aiAllowAllQueries,
    onApprovalRequired,
    onChunk,
    onDone,
    onError,
  } = params;

  const { providerId, model } = params;
  const activeConfig = aiSettingsStore.getProvider(providerId);
  if (!activeConfig) {
    onError("no_provider");
    return;
  }
  const apiKey = (await getKeyringService().getAIApiKeyForProvider(activeConfig.id)) ?? "";
  const { type: provider, baseUrl } = activeConfig;
  if (provider === "anthropic" && !apiKey) {
    onError("no_api_key");
    return;
  }

  const schemaCtx = shareSchema ? buildSchemaContext(schema) : "";
  const systemPrompt = buildSystemPrompt(schemaCtx, databaseType);
  const tools = shareData ? [RUN_QUERY_TOOL] : [];

  type ApiMessage = Record<string, unknown>;
  let apiMessages: ApiMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));

  console.log("[AI] sendAIMessage: sending via", provider, model);

  if (provider === "anthropic") {
    let toolCallCount = 0;
    while (true) {
      const turnResult = await streamAnthropicTurn({
        apiKey,
        model,
        systemPrompt,
        messages: apiMessages as { role: string; content: unknown }[],
        tools,
        onChunk,
        onError,
      });

      if (!turnResult) return;

      if (!turnResult.toolCall) {
        onDone();
        return;
      }

      toolCallCount++;
      if (toolCallCount > 10) {
        onError("Tool call limit exceeded (max 10 per message)");
        return;
      }

      const { id: toolUseId, name: toolName, input } = turnResult.toolCall;

      if (toolName !== "run_query") {
        const assistantContent: unknown[] = [];
        if (turnResult.assistantText) {
          assistantContent.push({ type: "text", text: turnResult.assistantText });
        }
        assistantContent.push({ type: "tool_use", id: toolUseId, name: toolName, input });
        apiMessages = [
          ...apiMessages,
          { role: "assistant", content: assistantContent },
          {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: toolUseId, content: "Unknown tool" }],
          },
        ];
        continue;
      }

      const query = typeof input.query === "string" ? input.query : "";
      const validationError = validateReadOnlyQuery(query);
      if (validationError) {
        const assistantContent: unknown[] = [];
        if (turnResult.assistantText) {
          assistantContent.push({ type: "text", text: turnResult.assistantText });
        }
        assistantContent.push({ type: "tool_use", id: toolUseId, name: toolName, input });
        apiMessages = [
          ...apiMessages,
          { role: "assistant", content: assistantContent },
          {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: toolUseId, content: validationError }],
          },
        ];
        continue;
      }

      let toolResultContent: string;
      if (aiAllowAllQueries) {
        toolResultContent = await runAndFormat(query, executeQuery);
      } else {
        toolResultContent = await new Promise<string>((resolve) => {
          onApprovalRequired(
            query,
            connectionName,
            async () => {
              resolve(await runAndFormat(query, executeQuery));
            },
            () => resolve("User denied query execution"),
          );
        });
      }

      const assistantContent: unknown[] = [];
      if (turnResult.assistantText) {
        assistantContent.push({ type: "text", text: turnResult.assistantText });
      }
      assistantContent.push({ type: "tool_use", id: toolUseId, name: toolName, input });
      apiMessages = [
        ...apiMessages,
        { role: "assistant", content: assistantContent },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: toolUseId, content: toolResultContent }],
        },
      ];
    }
  } else {
    // OpenAI-compatible multi-turn loop
    const base = (baseUrl ?? "").replace(/\/$/, "") || "https://api.openai.com/v1";
    let toolCallCount = 0;

    while (true) {
      const turnResult = await streamOpenAICompatTurn({
        apiKey,
        model,
        baseUrl: base,
        systemPrompt,
        messages: apiMessages as { role: string; content: unknown }[],
        tools,
        onChunk,
        onError,
      });

      if (!turnResult) return;

      if (!turnResult.toolCall) {
        onDone();
        return;
      }

      toolCallCount++;
      if (toolCallCount > 10) {
        onError("Tool call limit exceeded (max 10 per message)");
        return;
      }

      const { id: toolCallId, name: toolName, input } = turnResult.toolCall;

      const assistantMsg: Record<string, unknown> = {
        role: "assistant",
        tool_calls: [
          {
            id: toolCallId,
            type: "function",
            function: { name: toolName, arguments: JSON.stringify(input) },
          },
        ],
      };
      if (turnResult.assistantText) {
        assistantMsg.content = turnResult.assistantText;
      }

      if (toolName !== "run_query") {
        apiMessages = [
          ...apiMessages,
          assistantMsg,
          { role: "tool" as const, tool_call_id: toolCallId, content: "Unknown tool" },
        ];
        continue;
      }

      const query = typeof input.query === "string" ? input.query : "";
      const validationError = validateReadOnlyQuery(query);
      if (validationError) {
        apiMessages = [
          ...apiMessages,
          assistantMsg,
          { role: "tool" as const, tool_call_id: toolCallId, content: validationError },
        ];
        continue;
      }

      let toolResultContent: string;
      if (aiAllowAllQueries) {
        toolResultContent = await runAndFormat(query, executeQuery);
      } else {
        toolResultContent = await new Promise<string>((resolve) => {
          onApprovalRequired(
            query,
            connectionName,
            async () => {
              resolve(await runAndFormat(query, executeQuery));
            },
            () => resolve("User denied query execution"),
          );
        });
      }

      apiMessages = [
        ...apiMessages,
        assistantMsg,
        { role: "tool" as const, tool_call_id: toolCallId, content: toolResultContent },
      ];
    }
  }
}

// --- SQL generation (non-streaming, for inline editor prompt) ---

export interface GenerateSQLParams {
  providerId: string;
  model: string;
  request: string;
  existingQuery: string;
  schema: SchemaTable[];
  shareSchema: boolean;
  databaseType?: DatabaseType;
}

export async function generateSQL(params: GenerateSQLParams): Promise<string> {
  const { request, existingQuery, schema, shareSchema, databaseType } = params;

  const { providerId, model } = params;
  const activeConfig = aiSettingsStore.getProvider(providerId);
  if (!activeConfig) throw new Error("no_provider");
  const apiKey = (await getKeyringService().getAIApiKeyForProvider(activeConfig.id)) ?? "";
  const { type: provider, baseUrl } = activeConfig;
  // Anthropic always requires a key; openai-compatible providers (e.g. Ollama) may not
  if (provider === "anthropic" && !apiKey) throw new Error("no_api_key");

  const schemaCtx = shareSchema ? buildSchemaContext(schema) : "";
  const systemPrompt = buildSystemPrompt(schemaCtx, databaseType);

  const userMessage = existingQuery.trim()
    ? `${request}\n\nExisting query for context:\n\`\`\`sql\n${existingQuery}\n\`\`\``
    : request;
  console.log("[AI] generateSQL: generating via", provider, model);

  let content: string;
  if (provider === "anthropic") {
    content = await fetchAnthropic({
      apiKey,
      model,
      systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });
  } else {
    const base = (baseUrl ?? "").replace(/\/$/, "") || "https://api.openai.com/v1";
    content = await fetchOpenAICompat({
      apiKey,
      model,
      baseUrl: base,
      systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });
  }

  // Extract SQL from markdown code block if present
  const match = content.match(/```(?:sql)?\n([\s\S]*?)```/);
  return match ? match[1].trim() : content.trim();
}

// --- Streaming implementations ---

async function streamAnthropicTurn(params: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: { role: string; content: unknown }[];
  tools: (typeof RUN_QUERY_TOOL)[];
  onChunk: (delta: string) => void;
  onError: (msg: string) => void;
}): Promise<TurnResult | null> {
  const { apiKey, model, systemPrompt, messages, tools, onChunk, onError } = params;

  const body: Record<string, unknown> = {
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages,
    stream: true,
  };
  if (tools.length > 0) body.tools = tools;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    onError(res.status === 429 ? "rate_limit" : errText);
    return null;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    onError("no_stream");
    return null;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  let assistantText = "";
  let toolUseId: string | null = null;
  let toolUseName: string | null = null;
  let toolInputJson = "";
  let stopReason: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      try {
        const event = JSON.parse(data);

        if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
          toolUseId = event.content_block.id;
          toolUseName = event.content_block.name;
          toolInputJson = "";
        } else if (event.type === "content_block_delta") {
          if (event.delta?.type === "text_delta") {
            assistantText += event.delta.text;
            onChunk(event.delta.text);
          } else if (event.delta?.type === "input_json_delta") {
            toolInputJson += event.delta.partial_json;
          }
        } else if (event.type === "message_delta") {
          stopReason = event.delta?.stop_reason ?? null;
        }
      } catch {
        /* skip malformed */
      }
    }
  }

  if (stopReason === "tool_use" && toolUseId && toolUseName) {
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(toolInputJson);
    } catch {
      /* malformed */
    }
    return { assistantText, toolCall: { id: toolUseId, name: toolUseName, input } };
  }

  return { assistantText, toolCall: null };
}

interface StreamOpenAICompatTurnParams {
  apiKey: string;
  model: string;
  baseUrl: string;
  systemPrompt: string;
  messages: { role: string; content: unknown }[];
  tools: (typeof RUN_QUERY_TOOL)[];
  onChunk: (delta: string) => void;
  onError: (msg: string) => void;
}

async function streamOpenAICompatTurn(
  params: StreamOpenAICompatTurnParams,
): Promise<TurnResult | null> {
  const { apiKey, model, baseUrl, systemPrompt, messages, tools, onChunk, onError } = params;

  const openaiTools = tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));

  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
    stream: true,
  };
  if (openaiTools.length > 0) body.tools = openaiTools;

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers["authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    onError(res.status === 429 ? "rate_limit" : errText);
    return null;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    onError("no_stream");
    return null;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let assistantText = "";

  const toolCallMap = new Map<number, { id: string; name: string; args: string }>();
  let finishReason: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      try {
        const event = JSON.parse(data);
        const delta = event.choices?.[0]?.delta;
        const reason = event.choices?.[0]?.finish_reason;
        if (reason) finishReason = reason;

        if (delta?.content) {
          assistantText += delta.content;
          onChunk(delta.content);
        }
        if (delta?.tool_calls?.length) {
          for (const tc of delta.tool_calls) {
            const idx: number = tc.index ?? 0;
            if (!toolCallMap.has(idx)) {
              toolCallMap.set(idx, { id: "", name: "", args: "" });
            }
            const entry = toolCallMap.get(idx)!;
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.name = tc.function.name;
            if (tc.function?.arguments) entry.args += tc.function.arguments;
          }
        }
      } catch {
        /* skip */
      }
    }
  }

  const primaryTc = toolCallMap.get(0);
  if (finishReason === "tool_calls" && primaryTc?.id && primaryTc?.name) {
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(primaryTc.args);
    } catch {
      /* malformed */
    }
    return { assistantText, toolCall: { id: primaryTc.id, name: primaryTc.name, input } };
  }

  return { assistantText, toolCall: null };
}

// --- Non-streaming implementations (for generateSQL) ---

interface FetchParams {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: { role: string; content: string }[];
}

async function fetchAnthropic(params: FetchParams): Promise<string> {
  const { apiKey, model, systemPrompt, messages } = params;
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, max_tokens: 2048, system: systemPrompt, messages }),
    });
  } catch (err) {
    console.error("[AI] Anthropic network error:", err);
    throw new Error("Could not connect to api.anthropic.com. Check your network connection.");
  }
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    console.error("[AI] Anthropic fetch error:", res.status, err);
    throw new Error(res.status === 429 ? "rate_limit" : err);
  }
  const json = await res.json();
  return json.content?.[0]?.text ?? "";
}

interface FetchOpenAIParams extends FetchParams {
  baseUrl: string;
}

async function fetchOpenAICompat(params: FetchOpenAIParams): Promise<string> {
  const { apiKey, model, baseUrl, systemPrompt, messages } = params;
  const fetchHeaders: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) fetchHeaders["authorization"] = `Bearer ${apiKey}`;
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: fetchHeaders,
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
    });
  } catch (err) {
    console.error("[AI] OpenAI-compat network error:", err);
    throw new Error(
      `Could not connect to ${baseUrl}. Check that the server is running and that it allows requests from this app (CORS).`,
    );
  }
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    console.error("[AI] OpenAI-compat fetch error:", res.status, err);
    throw new Error(res.status === 429 ? "rate_limit" : err);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}
