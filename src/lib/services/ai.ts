import type { SchemaTable } from "$lib/types";
import type { AIMessage } from "$lib/types/query";
import type { DatabaseType } from "$lib/types/database";
import type { DashboardWidget, KpiConfig, TextConfig } from "$lib/types/dashboard";
import type { ChartConfig } from "$lib/types/chart";
import { aiSettingsStore } from "$lib/stores/ai-settings.svelte";
import { getKeyringService } from "$lib/services/keyring";

interface DashboardGetResult {
  id: string;
  name: string;
  widgets: Array<{
    id: string;
    title: string;
    x: number;
    y: number;
    width: number;
    height: number;
    widgetType: string;
    query: string;
    chartConfig?: ChartConfig;
    kpiConfig?: KpiConfig;
    textConfig?: TextConfig;
  }>;
}

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

const CREATE_DASHBOARD_TOOL = {
  name: "create_dashboard",
  description: "Create a new empty dashboard. Returns the dashboard ID to use when adding widgets.",
  input_schema: {
    type: "object" as const,
    properties: {
      name: {
        type: "string",
        description: "Name for the new dashboard",
      },
    },
    required: ["name"],
  },
};

const ADD_WIDGET_TOOL = {
  name: "add_widget",
  description:
    "Add a widget to a dashboard. Provide position (x, y), size (width, height), widget type, and the relevant config for that type.",
  input_schema: {
    type: "object" as const,
    properties: {
      dashboard_id: {
        type: "string",
        description: "ID of the dashboard to add the widget to",
      },
      title: {
        type: "string",
        description: "Display title for the widget",
      },
      x: {
        type: "number",
        description: "X position in pixels on the canvas",
      },
      y: {
        type: "number",
        description: "Y position in pixels on the canvas",
      },
      width: {
        type: "number",
        description: "Width in pixels",
      },
      height: {
        type: "number",
        description: "Height in pixels",
      },
      widget_type: {
        type: "string",
        enum: ["chart", "kpi", "text"],
        description: "Type of widget",
      },
      query: {
        type: "string",
        description: "SQL SELECT query that powers this widget (not needed for text widgets)",
      },
      chart_config: {
        type: "object",
        description: "Configuration for chart widgets",
        properties: {
          type: {
            type: "string",
            enum: ["bar", "line", "pie", "scatter", "area"],
            description: "Chart type",
          },
          xAxis: {
            type: "string",
            description: "Column name for the X axis",
          },
          yAxis: {
            type: "array",
            items: { type: "string" },
            description: "Column names for the Y axis values",
          },
          colors: {
            type: "object",
            description: "Custom colors per Y-axis column (column name → hex color)",
          },
        },
      },
      kpi_config: {
        type: "object",
        description: "Configuration for KPI widgets",
        properties: {
          label: {
            type: "string",
            description: "Label for the KPI value",
          },
          valueColumn: {
            type: "string",
            description: "Column name containing the KPI value",
          },
          format: {
            type: "string",
            enum: ["number", "percentage"],
            description: "How to format the value",
          },
          prefix: {
            type: "string",
            description: "Prefix to display before the value (e.g. $)",
          },
          suffix: {
            type: "string",
            description: "Suffix to display after the value (e.g. %)",
          },
        },
        required: ["label", "valueColumn"],
      },
      text_config: {
        type: "object",
        description: "Configuration for text widgets",
        properties: {
          content: {
            type: "string",
            description: "Text content to display",
          },
        },
        required: ["content"],
      },
    },
    required: ["dashboard_id", "title", "x", "y", "width", "height", "widget_type"],
  },
};

const GET_DASHBOARD_TOOL = {
  name: "get_dashboard",
  description:
    "Retrieve a dashboard and all its widgets. Use this to inspect the current state before making updates.",
  input_schema: {
    type: "object" as const,
    properties: {
      dashboard_id: {
        type: "string",
        description: "ID of the dashboard to retrieve",
      },
    },
    required: ["dashboard_id"],
  },
};

const UPDATE_WIDGET_TOOL = {
  name: "update_widget",
  description:
    "Update an existing widget on a dashboard. Only the fields you provide will be changed.",
  input_schema: {
    type: "object" as const,
    properties: {
      dashboard_id: {
        type: "string",
        description: "ID of the dashboard containing the widget",
      },
      widget_id: {
        type: "string",
        description: "ID of the widget to update",
      },
      title: {
        type: "string",
        description: "New display title",
      },
      x: {
        type: "number",
        description: "New X position in pixels",
      },
      y: {
        type: "number",
        description: "New Y position in pixels",
      },
      width: {
        type: "number",
        description: "New width in pixels",
      },
      height: {
        type: "number",
        description: "New height in pixels",
      },
      widget_type: {
        type: "string",
        enum: ["chart", "kpi", "text"],
        description: "New widget type",
      },
      query: {
        type: "string",
        description: "New SQL query",
      },
      chart_config: {
        type: "object",
        description: "New chart configuration",
        properties: {
          type: {
            type: "string",
            enum: ["bar", "line", "pie", "scatter", "area"],
          },
          xAxis: { type: "string" },
          yAxis: { type: "array", items: { type: "string" } },
          colors: { type: "object" },
        },
      },
      kpi_config: {
        type: "object",
        description: "New KPI configuration",
        properties: {
          label: { type: "string" },
          valueColumn: { type: "string" },
          format: { type: "string", enum: ["number", "percentage"] },
          prefix: { type: "string" },
          suffix: { type: "string" },
        },
        required: ["label", "valueColumn"],
      },
      text_config: {
        type: "object",
        description: "New text configuration",
        properties: {
          content: { type: "string" },
        },
        required: ["content"],
      },
    },
    required: ["dashboard_id", "widget_id"],
  },
};

const REMOVE_WIDGET_TOOL = {
  name: "remove_widget",
  description: "Remove a widget from a dashboard.",
  input_schema: {
    type: "object" as const,
    properties: {
      dashboard_id: {
        type: "string",
        description: "ID of the dashboard containing the widget",
      },
      widget_id: {
        type: "string",
        description: "ID of the widget to remove",
      },
    },
    required: ["dashboard_id", "widget_id"],
  },
};

const DASHBOARD_TOOL_NAMES = new Set([
  "create_dashboard",
  "add_widget",
  "get_dashboard",
  "update_widget",
  "remove_widget",
]);

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

function buildSystemPrompt(
  schemaCtx: string,
  dbType?: DatabaseType,
  hasDashboardTools?: boolean,
): string {
  const dbLabel = dbType ? DATABASE_LABELS[dbType] : "SQL";
  const parts = [
    `You are a helpful SQL assistant for a ${dbLabel} database. Always use ${dbLabel}-compatible syntax.`,
  ];
  if (schemaCtx) parts.push(schemaCtx);
  parts.push(
    "Provide clear, concise SQL queries and explanations. When writing SQL, wrap it in a markdown code block.",
  );
  if (hasDashboardTools) {
    parts.push(
      `Dashboard creation guidelines:
- Use create_dashboard first, then add_widget for each widget.
- Layout conventions (pixel units): KPI widgets are 220×140, chart widgets are 460×340, text widgets vary. Use 20px gaps between widgets. The canvas is roughly 980px wide.
- Widget types: "kpi" requires kpi_config (label, valueColumn, optional format/prefix/suffix). "chart" requires chart_config (type, xAxis, yAxis array; chart type should match the data). "text" requires text_config (content).
- Chart config: xAxis is the category column, yAxis is an array of value columns, type should be "bar", "line", "pie", "scatter", or "area" depending on data.
- Always provide a SQL query for kpi and chart widgets. Text widgets do not need a query.
- Use get_dashboard to inspect the current state before updating or removing widgets.`,
    );
  }
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
  onCreateDashboard?: (name: string) => Promise<{ dashboardId: string } | null>;
  onAddWidget?: (
    dashboardId: string,
    widget: Omit<DashboardWidget, "id" | "result" | "isLoading" | "error" | "lastRefreshed">,
  ) => Promise<{ widgetId: string } | null>;
  onGetDashboard?: (dashboardId: string) => DashboardGetResult | null;
  onUpdateWidget?: (
    dashboardId: string,
    widgetId: string,
    updates: Partial<DashboardWidget>,
  ) => Promise<void>;
  onRemoveWidget?: (dashboardId: string, widgetId: string) => Promise<void>;
}

interface TurnResult {
  assistantText: string;
  toolCall: { id: string; name: string; input: Record<string, unknown> } | null;
}

async function handleDashboardToolCall(
  toolName: string,
  input: Record<string, unknown>,
  params: SendAIMessageParams,
): Promise<string> {
  if (
    !params.onCreateDashboard ||
    !params.onAddWidget ||
    !params.onGetDashboard ||
    !params.onUpdateWidget ||
    !params.onRemoveWidget
  ) {
    return JSON.stringify({ error: "Dashboard tools not available" });
  }
  try {
    switch (toolName) {
      case "create_dashboard": {
        const name = typeof input.name === "string" ? input.name : "Untitled Dashboard";
        const result = await params.onCreateDashboard(name);
        if (!result) return JSON.stringify({ error: "Failed to create dashboard" });
        return JSON.stringify({ dashboard_id: result.dashboardId });
      }
      case "add_widget": {
        // oxlint-disable-next-line typescript-eslint(no-base-to-string)
        const dashboardId = String(input.dashboard_id ?? "");
        const widgetType = (input.widget_type as "chart" | "kpi" | "text") ?? "chart";
        const widget: Omit<
          DashboardWidget,
          "id" | "result" | "isLoading" | "error" | "lastRefreshed"
        > = {
          // oxlint-disable-next-line typescript-eslint(no-base-to-string)
          title: String(input.title ?? ""),
          x: Number(input.x ?? 0),
          y: Number(input.y ?? 0),
          width: Number(input.width ?? 460),
          height: Number(input.height ?? 340),
          widgetType,
          querySource: "custom",
          query: typeof input.query === "string" ? input.query : "",
          chartConfig:
            widgetType === "chart" && input.chart_config
              ? {
                  type:
                    ((input.chart_config as Record<string, unknown>).type as ChartConfig["type"]) ??
                    "bar",
                  xAxis: ((input.chart_config as Record<string, unknown>).xAxis as string) ?? null,
                  yAxis: ((input.chart_config as Record<string, unknown>).yAxis as string[]) ?? [],
                  dataScope: "all",
                  colors: (input.chart_config as Record<string, unknown>).colors as
                    | Record<string, string>
                    | undefined,
                }
              : undefined,
          kpiConfig:
            widgetType === "kpi" && input.kpi_config
              ? {
                  // oxlint-disable-next-line typescript-eslint(no-base-to-string)
                  label: String((input.kpi_config as Record<string, unknown>).label ?? ""),
                  valueColumn: String(
                    // oxlint-disable-next-line typescript-eslint(no-base-to-string)
                    (input.kpi_config as Record<string, unknown>).valueColumn ?? "",
                  ),
                  format: (input.kpi_config as Record<string, unknown>)
                    .format as KpiConfig["format"],
                  prefix: (input.kpi_config as Record<string, unknown>).prefix as
                    | string
                    | undefined,
                  suffix: (input.kpi_config as Record<string, unknown>).suffix as
                    | string
                    | undefined,
                }
              : undefined,
          textConfig:
            widgetType === "text" && input.text_config
              ? // oxlint-disable-next-line typescript-eslint(no-base-to-string)
                { content: String((input.text_config as Record<string, unknown>).content ?? "") }
              : undefined,
        };
        const result = await params.onAddWidget(dashboardId, widget);
        if (!result) return JSON.stringify({ error: "Failed to add widget" });
        return JSON.stringify({ widget_id: result.widgetId });
      }
      case "get_dashboard": {
        // oxlint-disable-next-line typescript-eslint(no-base-to-string)
        const dashboardId = String(input.dashboard_id ?? "");
        const result = params.onGetDashboard(dashboardId);
        if (!result) return JSON.stringify({ error: "Dashboard not found" });
        return JSON.stringify(result);
      }
      case "update_widget": {
        // oxlint-disable-next-line typescript-eslint(no-base-to-string)
        const dashboardId = String(input.dashboard_id ?? "");
        // oxlint-disable-next-line typescript-eslint(no-base-to-string)
        const widgetId = String(input.widget_id ?? "");
        const updates: Partial<DashboardWidget> = {};
        // oxlint-disable-next-line typescript-eslint(no-base-to-string)
        if (input.title !== undefined) updates.title = String(input.title);
        if (input.x !== undefined) updates.x = Number(input.x);
        if (input.y !== undefined) updates.y = Number(input.y);
        if (input.width !== undefined) updates.width = Number(input.width);
        if (input.height !== undefined) updates.height = Number(input.height);
        if (input.widget_type !== undefined)
          updates.widgetType = input.widget_type as DashboardWidget["widgetType"];
        // oxlint-disable-next-line typescript-eslint(no-base-to-string)
        if (input.query !== undefined) updates.query = String(input.query);
        if (input.chart_config !== undefined) {
          const cc = input.chart_config as Record<string, unknown>;
          updates.chartConfig = {
            type: (cc.type as ChartConfig["type"]) ?? "bar",
            xAxis: (cc.xAxis as string) ?? null,
            yAxis: (cc.yAxis as string[]) ?? [],
            dataScope: "all",
            colors: cc.colors as Record<string, string> | undefined,
          };
        }
        if (input.kpi_config !== undefined) {
          const kc = input.kpi_config as Record<string, unknown>;
          updates.kpiConfig = {
            // oxlint-disable-next-line typescript-eslint(no-base-to-string)
            label: String(kc.label ?? ""),
            // oxlint-disable-next-line typescript-eslint(no-base-to-string)
            valueColumn: String(kc.valueColumn ?? ""),
            format: kc.format as KpiConfig["format"],
            prefix: kc.prefix as string | undefined,
            suffix: kc.suffix as string | undefined,
          };
        }
        if (input.text_config !== undefined) {
          const tc = input.text_config as Record<string, unknown>;
          // oxlint-disable-next-line typescript-eslint(no-base-to-string)
          updates.textConfig = { content: String(tc.content ?? "") };
        }
        await params.onUpdateWidget(dashboardId, widgetId, updates);
        return JSON.stringify({ success: true });
      }
      case "remove_widget": {
        // oxlint-disable-next-line typescript-eslint(no-base-to-string)
        const dashboardId = String(input.dashboard_id ?? "");
        // oxlint-disable-next-line typescript-eslint(no-base-to-string)
        const widgetId = String(input.widget_id ?? "");
        await params.onRemoveWidget(dashboardId, widgetId);
        return JSON.stringify({ success: true });
      }
      default:
        return JSON.stringify({ error: "Unknown dashboard tool" });
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
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
  const systemPrompt = buildSystemPrompt(schemaCtx, databaseType, !!params.onCreateDashboard);
  const dataTools = shareData ? [RUN_QUERY_TOOL] : [];
  const dashboardTools = params.onCreateDashboard
    ? [
        CREATE_DASHBOARD_TOOL,
        ADD_WIDGET_TOOL,
        GET_DASHBOARD_TOOL,
        UPDATE_WIDGET_TOOL,
        REMOVE_WIDGET_TOOL,
      ]
    : [];
  const tools = [...dataTools, ...dashboardTools];

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
      if (toolCallCount > 20) {
        onError("Tool call limit exceeded (max 20 per message)");
        return;
      }

      const { id: toolUseId, name: toolName, input } = turnResult.toolCall;

      if (DASHBOARD_TOOL_NAMES.has(toolName)) {
        const dashResult = await handleDashboardToolCall(toolName, input, params);
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
            content: [{ type: "tool_result", tool_use_id: toolUseId, content: dashResult }],
          },
        ];
        continue;
      }

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
      if (toolCallCount > 20) {
        onError("Tool call limit exceeded (max 20 per message)");
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

      if (DASHBOARD_TOOL_NAMES.has(toolName)) {
        const dashResult = await handleDashboardToolCall(toolName, input, params);
        apiMessages = [
          ...apiMessages,
          assistantMsg,
          { role: "tool" as const, tool_call_id: toolCallId, content: dashResult },
        ];
        continue;
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

type ToolDefinition = { name: string; description: string; input_schema: Record<string, unknown> };

async function streamAnthropicTurn(params: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: { role: string; content: unknown }[];
  tools: ToolDefinition[];
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
  tools: ToolDefinition[];
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
