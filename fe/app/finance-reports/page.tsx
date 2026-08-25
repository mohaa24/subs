"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Banknote,
  FileText,
  Receipt,
  Scale,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { AbstractBg } from "@/components/abstract-bg";
import { Breadcrumb } from "@/components/breadcrumb";
import { Header } from "@/components/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";
import { dashboardFlowHref } from "@/lib/dashboard-flows";

const reports = [
  {
    href: "/reports/profit-loss",
    title: "Profit & Loss Report",
    description: "Compare income and expenses, including special fund results and net margin.",
    icon: Scale,
    tone: "bg-slate-100 text-slate-700",
  },
  {
    href: "/reports/payments",
    title: "Member Payment Report",
    description: "Review member receipts, reversals, payment methods, and due type collections.",
    icon: Receipt,
    tone: "bg-emerald-50 text-emerald-700",
  },
  {
    href: "/reports/cash-movement",
    title: "Cash Movement Report",
    description: "Reconcile money received, paid, transferred, and held.",
    icon: Banknote,
    tone: "bg-sky-50 text-sky-700",
  },
  {
    href: "/reports/income-account",
    title: "Income Account Report",
    description: "Review receipts, reversals, and net income by account.",
    icon: TrendingUp,
    tone: "bg-emerald-50 text-emerald-700",
  },
  {
    href: "/reports/expense-account",
    title: "Expense Account Report",
    description: "Review payments, reversals, and net expenses by account.",
    icon: TrendingDown,
    tone: "bg-blue-50 text-sky-700",
  },
];

export default function FinancialReportsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, router, user]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-background">
      <AbstractBg />
      <Header />
      <main className="relative z-10 mx-auto max-w-6xl p-6">
        <Breadcrumb
          items={[
            { label: "Dashboard", href: dashboardFlowHref("reports") },
            { label: "Financial Reports" },
          ]}
        />
        <div className="mb-5 flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold text-foreground">Financial Reports</h1>
        </div>
        <Card className="border-slate-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Financial Reports</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {reports.map((report) => {
              const Icon = report.icon;
              return (
                <Link
                  key={report.href}
                  href={report.href}
                  className="group flex items-center gap-3 rounded-xl border border-slate-200 p-4 transition-colors hover:border-primary/40 hover:bg-slate-50"
                >
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${report.tone}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-slate-900">{report.title}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{report.description}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5" />
                </Link>
              );
            })}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
