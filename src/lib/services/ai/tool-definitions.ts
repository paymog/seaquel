export type ToolDefinition = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export const RUN_QUERY_TOOL: ToolDefinition = {
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

export const CREATE_DASHBOARD_TOOL: ToolDefinition = {
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

export const ADD_WIDGET_TOOL: ToolDefinition = {
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

export const GET_DASHBOARD_TOOL: ToolDefinition = {
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

export const UPDATE_WIDGET_TOOL: ToolDefinition = {
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

export const REMOVE_WIDGET_TOOL: ToolDefinition = {
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

export const DASHBOARD_TOOLS = [
  CREATE_DASHBOARD_TOOL,
  ADD_WIDGET_TOOL,
  GET_DASHBOARD_TOOL,
  UPDATE_WIDGET_TOOL,
  REMOVE_WIDGET_TOOL,
];

export const DASHBOARD_TOOL_NAMES = new Set(DASHBOARD_TOOLS.map((t) => t.name));
