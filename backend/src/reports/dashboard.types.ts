export const DASHBOARD_HEADS = [
  "sales",
  "purchases",
  "receivables",
  "payables",
  "profit",
  "loss",
] as const;

export type DashboardHead = (typeof DASHBOARD_HEADS)[number];

/**
 * The initial dashboard payload intentionally contains labels only.
 * Financial figures are never returned until the user explicitly drills into a head.
 */
export interface DashboardOverview {
  heads: Array<{
    key: DashboardHead;
    label: string;
  }>;
}

export interface DashboardDetailRequest {
  head: DashboardHead;
  period: import("./reporting.types.js").ReportPeriod;
}
