export const DASHBOARD_FLOWS = [
  "person",
  "membership",
  "payment",
  "admin",
  "announcements",
  "distributions",
  "reports",
  "accounting",
] as const;

export type DashboardFlow = (typeof DASHBOARD_FLOWS)[number];

export const DEFAULT_DASHBOARD_FLOW: DashboardFlow = "person";

export function normalizeDashboardFlow(value: string | null | undefined): DashboardFlow {
  return DASHBOARD_FLOWS.includes(value as DashboardFlow)
    ? (value as DashboardFlow)
    : DEFAULT_DASHBOARD_FLOW;
}

export function dashboardFlowHref(flow: DashboardFlow) {
  return `/?flow=${flow}`;
}
