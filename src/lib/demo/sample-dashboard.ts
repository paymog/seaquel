/**
 * Sample dashboard configuration for the browser demo.
 * Creates an "E-Commerce Overview" dashboard with various chart types.
 */

import type { DashboardWidget } from "$lib/types";

const DEMO_WIDGETS: DashboardWidget[] = [
  // === ROW 1: KPI Widgets ===
  {
    id: "widget-demo-kpi-revenue",
    title: "Total Revenue",
    x: 20,
    y: 20,
    width: 220,
    height: 140,
    querySource: "custom",
    query:
      "SELECT SUM(total_amount) as total_revenue, SUM(CASE WHEN status = 'completed' THEN total_amount ELSE 0 END) as completed_revenue FROM demo.orders",
    widgetType: "kpi",
    kpiConfig: {
      label: "Total Revenue",
      valueColumn: "total_revenue",
      format: "currency",
    },
  },
  {
    id: "widget-demo-kpi-orders",
    title: "Total Orders",
    x: 260,
    y: 20,
    width: 220,
    height: 140,
    querySource: "custom",
    query: "SELECT COUNT(*) as total_orders FROM demo.orders",
    widgetType: "kpi",
    kpiConfig: {
      label: "Total Orders",
      valueColumn: "total_orders",
      format: "number",
    },
  },
  {
    id: "widget-demo-kpi-customers",
    title: "Customers",
    x: 500,
    y: 20,
    width: 220,
    height: 140,
    querySource: "custom",
    query: "SELECT COUNT(*) as total_customers FROM demo.customers",
    widgetType: "kpi",
    kpiConfig: {
      label: "Customers",
      valueColumn: "total_customers",
      format: "number",
    },
  },
  {
    id: "widget-demo-kpi-avg-order",
    title: "Avg Order Value",
    x: 740,
    y: 20,
    width: 220,
    height: 140,
    querySource: "custom",
    query: "SELECT ROUND(AVG(total_amount), 2) as avg_order_value FROM demo.orders",
    widgetType: "kpi",
    kpiConfig: {
      label: "Avg Order Value",
      valueColumn: "avg_order_value",
      format: "currency",
    },
  },

  // === ROW 2: Bar + Pie Charts ===
  {
    id: "widget-demo-bar-revenue",
    title: "Revenue by Product",
    x: 20,
    y: 180,
    width: 460,
    height: 340,
    querySource: "custom",
    query: `SELECT p.name, ROUND(SUM(oi.quantity * oi.unit_price), 2) as revenue
FROM demo.order_items oi
JOIN demo.products p ON oi.product_id = p.id
GROUP BY p.name
ORDER BY revenue DESC`,
    widgetType: "chart",
    chartConfig: {
      type: "bar",
      xAxis: "name",
      yAxis: ["revenue"],
      dataScope: "all",
      colors: { revenue: "#f97316" },
    },
  },
  {
    id: "widget-demo-pie-status",
    title: "Orders by Status",
    x: 500,
    y: 180,
    width: 460,
    height: 340,
    querySource: "custom",
    query: `SELECT
  status,
  COUNT(*) as count
FROM demo.orders
GROUP BY status
ORDER BY count DESC`,
    widgetType: "chart",
    chartConfig: {
      type: "pie",
      xAxis: "status",
      yAxis: ["count"],
      dataScope: "all",
      colors: {
        completed: "#22c55e",
        shipped: "#3b82f6",
        processing: "#f59e0b",
        pending: "#94a3b8",
      },
    },
  },

  // === ROW 3: Area + Scatter Charts ===
  {
    id: "widget-demo-area-monthly",
    title: "Monthly Revenue",
    x: 20,
    y: 540,
    width: 460,
    height: 340,
    querySource: "custom",
    query: `SELECT
  strftime(created_at, '%Y-%m') as month,
  ROUND(SUM(total_amount), 2) as revenue
FROM demo.orders
GROUP BY month
ORDER BY month`,
    widgetType: "chart",
    chartConfig: {
      type: "area",
      xAxis: "month",
      yAxis: ["revenue"],
      dataScope: "all",
      colors: { revenue: "#8b5cf6" },
    },
  },
  {
    id: "widget-demo-scatter-price",
    title: "Product Price vs Units Sold",
    x: 500,
    y: 540,
    width: 460,
    height: 340,
    querySource: "custom",
    query: `SELECT
  p.name,
  p.price,
  COALESCE(SUM(oi.quantity), 0) as units_sold
FROM demo.products p
LEFT JOIN demo.order_items oi ON p.id = oi.product_id
GROUP BY p.name, p.price
ORDER BY p.price`,
    widgetType: "chart",
    chartConfig: {
      type: "scatter",
      xAxis: "name",
      yAxis: ["price", "units_sold"],
      dataScope: "all",
      colors: { price: "#06b6d4", units_sold: "#06b6d4" },
    },
  },

  // === ROW 4: Line chart + Text widget ===
  {
    id: "widget-demo-line-categories",
    title: "Products by Category",
    x: 20,
    y: 900,
    width: 460,
    height: 340,
    querySource: "custom",
    query: `SELECT
  category,
  COUNT(*) as product_count,
  ROUND(AVG(price), 2) as avg_price
FROM demo.products
GROUP BY category
ORDER BY product_count DESC`,
    widgetType: "chart",
    chartConfig: {
      type: "bar",
      xAxis: "category",
      yAxis: ["product_count", "avg_price"],
      dataScope: "all",
      colors: { product_count: "#3b82f6", avg_price: "#f43f5e" },
    },
  },
  {
    id: "widget-demo-line-spending",
    title: "Top Customers by Spending",
    x: 500,
    y: 900,
    width: 460,
    height: 340,
    querySource: "custom",
    query: `SELECT
  c.first_name || ' ' || c.last_name as customer,
  COUNT(o.id) as orders,
  ROUND(SUM(o.total_amount), 2) as total_spent
FROM demo.customers c
JOIN demo.orders o ON c.id = o.customer_id
GROUP BY c.id, c.first_name, c.last_name
ORDER BY total_spent DESC`,
    widgetType: "chart",
    chartConfig: {
      type: "line",
      xAxis: "customer",
      yAxis: ["total_spent"],
      dataScope: "all",
      colors: { total_spent: "#10b981" },
    },
  },
];

/**
 * Create a demo dashboard with pre-configured widgets.
 * Should be called after the demo connection is established.
 */
export async function createDemoDashboard(db: {
  dashboards: {
    createDashboard: (name: string) => Promise<{ id: string } | null>;
    addWidget: (dashboardId: string, widget: DashboardWidget) => Promise<void>;
    executeAllWidgets: (dashboardId: string) => Promise<void>;
  };
  dashboardTabs: {
    add: (dashboardId?: string, dashboardName?: string) => string | null;
  };
}): Promise<void> {
  const dashboard = await db.dashboards.createDashboard("E-Commerce Overview");
  if (!dashboard) return;

  // Add all widgets
  for (const widget of DEMO_WIDGETS) {
    await db.dashboards.addWidget(dashboard.id, widget);
  }

  // Open the dashboard tab
  db.dashboardTabs.add(dashboard.id, "E-Commerce Overview");

  // Execute all widget queries to populate data
  await db.dashboards.executeAllWidgets(dashboard.id);
}
