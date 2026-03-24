import type { ToolDefinition } from "./tool-definitions.js";

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface TurnResult {
  assistantText: string;
  toolCall: ToolCall | null;
}

type ApiMessage = Record<string, unknown>;

export interface StreamTurnParams {
  systemPrompt: string;
  messages: ApiMessage[];
  tools: ToolDefinition[];
  onChunk: (delta: string) => void;
  onError: (msg: string) => void;
  signal?: AbortSignal;
}

/**
 * Provider abstraction that unifies Anthropic and OpenAI-compatible APIs.
 * Each provider implements streaming, non-streaming, and message formatting.
 */
export interface AIProvider {
  streamTurn(params: StreamTurnParams): Promise<TurnResult | null>;
  formatAssistantToolUse(text: string, toolCall: ToolCall): ApiMessage;
  formatToolResult(toolCallId: string, content: string): ApiMessage;
  fetchNonStreaming(params: {
    systemPrompt: string;
    messages: { role: string; content: string }[];
  }): Promise<string>;
}

// --- Anthropic ---

export function createAnthropicProvider(apiKey: string, model: string): AIProvider {
  return {
    async streamTurn(params) {
      return streamAnthropicTurn({ apiKey, model, ...params, signal: params.signal });
    },
    formatAssistantToolUse(text, toolCall) {
      const content: unknown[] = [];
      if (text) content.push({ type: "text", text });
      content.push({
        type: "tool_use",
        id: toolCall.id,
        name: toolCall.name,
        input: toolCall.input,
      });
      return { role: "assistant", content };
    },
    formatToolResult(toolCallId, content) {
      return {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: toolCallId, content }],
      };
    },
    async fetchNonStreaming(params) {
      return fetchAnthropic({ apiKey, model, ...params });
    },
  };
}

async function streamAnthropicTurn(params: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: ApiMessage[];
  tools: ToolDefinition[];
  onChunk: (delta: string) => void;
  onError: (msg: string) => void;
  signal?: AbortSignal;
}): Promise<TurnResult | null> {
  const { apiKey, model, systemPrompt, messages, tools, onChunk, onError, signal } = params;

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
    signal,
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

async function fetchAnthropic(params: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: { role: string; content: string }[];
}): Promise<string> {
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

// --- OpenAI-compatible ---

export function createOpenAICompatProvider(
  apiKey: string,
  model: string,
  baseUrl: string,
): AIProvider {
  const base = baseUrl.replace(/\/$/, "") || "https://api.openai.com/v1";
  return {
    async streamTurn(params) {
      return streamOpenAICompatTurn({
        apiKey,
        model,
        baseUrl: base,
        ...params,
        signal: params.signal,
      });
    },
    formatAssistantToolUse(text, toolCall) {
      const msg: Record<string, unknown> = {
        role: "assistant",
        tool_calls: [
          {
            id: toolCall.id,
            type: "function",
            function: { name: toolCall.name, arguments: JSON.stringify(toolCall.input) },
          },
        ],
      };
      if (text) msg.content = text;
      return msg;
    },
    formatToolResult(toolCallId, content) {
      return { role: "tool" as const, tool_call_id: toolCallId, content };
    },
    async fetchNonStreaming(params) {
      return fetchOpenAICompat({ apiKey, model, baseUrl: base, ...params });
    },
  };
}

async function streamOpenAICompatTurn(params: {
  apiKey: string;
  model: string;
  baseUrl: string;
  systemPrompt: string;
  messages: ApiMessage[];
  tools: ToolDefinition[];
  onChunk: (delta: string) => void;
  onError: (msg: string) => void;
  signal?: AbortSignal;
}): Promise<TurnResult | null> {
  const { apiKey, model, baseUrl, systemPrompt, messages, tools, onChunk, onError, signal } =
    params;

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
    signal,
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

async function fetchOpenAICompat(params: {
  apiKey: string;
  model: string;
  baseUrl: string;
  systemPrompt: string;
  messages: { role: string; content: string }[];
}): Promise<string> {
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
