/**
 * Dashboard types for building persistent visual dashboards from query data.
 * @module types/dashboard
 */

import type { ChartConfig } from "./chart";

/**
 * KPI widget configuration for displaying a single prominent number.
 */
export interface KpiConfig {
  label: string;
  valueColumn: string;
  format?: "number" | "currency" | "percentage";
  prefix?: string;
  suffix?: string;
}

/**
 * Text widget configuration for displaying free-form text content.
 */
export interface TextConfig {
  content: string;
}

/**
 * A single widget within a dashboard.
 */
export interface DashboardWidget {
  id: string;
  title: string;
  description?: string;
  // Canvas position (pixel coordinates)
  x: number;
  y: number;
  width: number;
  height: number;
  // Data source
  querySource: "custom" | "saved";
  query: string;
  savedQueryId?: string;
  // Display
  widgetType: "chart" | "kpi" | "text";
  chartConfig?: ChartConfig;
  kpiConfig?: KpiConfig;
  textConfig?: TextConfig;
  // Auto-refresh
  autoRefreshSeconds?: number;
  // Runtime state (not persisted)
  result?: Record<string, unknown>[];
  isLoading?: boolean;
  error?: string;
  lastRefreshed?: Date;
}

/**
 * A dashboard containing multiple widgets.
 */
export interface Dashboard {
  id: string;
  name: string;
  connectionId: string;
  widgets: DashboardWidget[];
  viewport: { x: number; y: number; zoom: number };
  dateFilter?: { start: string; end: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Dashboard tab in the tab system.
 */
export interface DashboardTab {
  id: string;
  name: string;
  connectionId: string;
  dashboardId: string;
}
