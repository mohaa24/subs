"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { Header } from "@/components/header";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

const PUBLIC_PATHS = ["/login", "/reset-password", "/membership-export"];
const ACCESS_RULES: { prefix: string; permissions?: string[]; adminOnly?: boolean; superOnly?: boolean }[] = [
  { prefix: "/roles", adminOnly: true }, { prefix: "/users", adminOnly: true },
  { prefix: "/settings/financial-setup", superOnly: true }, { prefix: "/organizations", adminOnly: true },
  { prefix: "/persons", permissions: ["VIEW_PERSONS"] }, { prefix: "/members", permissions: ["VIEW_MEMBERSHIPS"] },
  { prefix: "/payments/history", permissions: ["VIEW_MEMBER_PAYMENTS"] }, { prefix: "/payments", permissions: ["VIEW_MEMBER_DUES", "VIEW_MEMBER_PAYMENTS"] },
  { prefix: "/cash-in", permissions: ["VIEW_CASH_IN"] }, { prefix: "/cash-out", permissions: ["VIEW_CASH_OUT"] },
  { prefix: "/banking", permissions: ["VIEW_BANKING"] }, { prefix: "/funds", permissions: ["VIEW_SPECIAL_FUNDS"] },
  { prefix: "/receivables", permissions: ["VIEW_RECEIVABLES"] }, { prefix: "/payables", permissions: ["VIEW_PAYABLES"] },
  { prefix: "/accounting", permissions: ["VIEW_CHART_OF_ACCOUNTS"] }, { prefix: "/journals", permissions: ["VIEW_JOURNALS"] },
  { prefix: "/member-reports", permissions: ["VIEW_MEMBER_REPORTS"] }, { prefix: "/reports/payments", permissions: ["VIEW_MEMBER_REPORTS"] },
  { prefix: "/finance-reports", permissions: ["VIEW_FINANCIAL_REPORTS"] }, { prefix: "/reports/", permissions: ["VIEW_FINANCIAL_REPORTS", "VIEW_MEMBER_REPORTS"] },
  { prefix: "/announcements", permissions: ["VIEW_ANNOUNCEMENTS"] }, { prefix: "/distributions", permissions: ["VIEW_DISTRIBUTIONS"] },
  { prefix: "/settings/messages", permissions: ["VIEW_SMS_SETTINGS"] }, { prefix: "/settings/zones", permissions: ["VIEW_ORGANIZATION_SETTINGS", "MANAGE_ZONES"] },
  { prefix: "/settings/due-types", permissions: ["VIEW_ORGANIZATION_SETTINGS", "MANAGE_DUE_TYPES"] }, { prefix: "/settings/form-config", permissions: ["MANAGE_FORM_SETTINGS"] },
  { prefix: "/audit-log", permissions: ["VIEW_AUDIT_LOG"] },
];

export function AccessBoundary({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading, hasPermission } = useAuth();
  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path)) || loading || !user) return children;
  const rule = ACCESS_RULES.find((item) => pathname.startsWith(item.prefix)) ?? (pathname === "/" ? { prefix: "/", permissions: ["VIEW_DASHBOARD"] } : null);
  const allowed = !rule || (rule.superOnly ? user.role === "super_user" : rule.adminOnly ? user.role === "admin" || user.role === "super_user" : hasPermission(...(rule.permissions ?? [])));
  if (allowed) return children;
  return <div className="min-h-screen bg-background"><Header /><main className="mx-auto flex max-w-xl flex-col items-center px-6 py-24 text-center">
    <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100"><ShieldAlert className="h-7 w-7 text-amber-700" /></div>
    <h1 className="text-2xl font-semibold">Access not available</h1>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">Your current role does not include access to this page. Contact your organisation administrator if you need it.</p>
    <Button asChild className="mt-6"><Link href="/">Return to dashboard</Link></Button>
  </main></div>;
}
