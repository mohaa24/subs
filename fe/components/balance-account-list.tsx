"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, CalendarDays, ChevronRight, ReceiptText, Search, WalletCards } from "lucide-react";
import { AbstractBg } from "@/components/abstract-bg";
import { Breadcrumb } from "@/components/breadcrumb";
import { Header } from "@/components/header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, type CashFlowAccountRow, type CashFlowOverview } from "@/lib/api";
import { dashboardFlowHref } from "@/lib/dashboard-flows";
import { useAuth } from "@/lib/auth-context";

type BalanceKind = "receivable" | "payable";
type Period = "this_month" | "this_year" | "all_time";

const periodLabels: Record<Period, string> = {
  this_month: "Current Month",
  this_year: "Current Financial Year",
  all_time: "All Time",
};

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function firstOfYearString() {
  const d = new Date();
  return `${d.getFullYear()}-01-01`;
}

function rangeFor(period: Period) {
  if (period === "this_month") return { fromDate: firstOfMonthString(), toDate: todayString() };
  if (period === "all_time") return { fromDate: "1900-01-01", toDate: todayString() };
  return { fromDate: firstOfYearString(), toDate: todayString() };
}

function formatRs(n: number) {
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n).replace("LKR", "Rs.");
}

function dateLabel(value?: string | null) {
  if (!value) return "No activity";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

const groupLabels: Record<string, string> = {
  loan_receivable: "Loan Receivables",
  service_receivable: "Service Receivables",
  loan_payable: "Loan Payables",
  service_payable: "Service Payables",
};

function config(kind: BalanceKind) {
  return kind === "receivable"
    ? {
        title: "Receivables",
        description: "Review loan and service receivable accounts.",
        overviewPath: "/accounting/cash-in/overview",
        sectionKey: "receivable_collection",
        detailBase: "/cash-in/accounts",
        actionLabel: "Open Collection",
        dashboardFlow: "cash-in" as const,
      }
    : {
        title: "Payables",
        description: "Review loan and service payable accounts.",
        overviewPath: "/accounting/cash-out/overview",
        sectionKey: "payable_payment",
        detailBase: "/cash-out/accounts",
        actionLabel: "Open Payment",
        dashboardFlow: "cash-out" as const,
      };
}

export function BalanceAccountList({ kind }: { kind: BalanceKind }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const cfg = config(kind);
  const [period, setPeriod] = useState<Period>("this_year");
  const [search, setSearch] = useState("");
  const [overview, setOverview] = useState<CashFlowOverview | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, router, user]);

  useEffect(() => {
    if (!user) return;
    const timer = setTimeout(() => void loadData(), 200);
    return () => clearTimeout(timer);
  }, [user, period, search]);

  async function loadData() {
    setLoadingData(true);
    setError("");
    try {
      setOverview(await api<CashFlowOverview>(cfg.overviewPath, {
        params: { ...rangeFor(period), ...(search.trim() ? { q: search.trim() } : {}) },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to load ${cfg.title}`);
    } finally {
      setLoadingData(false);
    }
  }

  const rows = useMemo(() => {
    return overview?.sections.find((section) => section.key === cfg.sectionKey)?.rows ?? [];
  }, [cfg.sectionKey, overview]);

  const grouped = useMemo(() => {
    const next = new Map<string, CashFlowAccountRow[]>();
    for (const row of rows) {
      const key = row.assetSubtype ?? "other";
      next.set(key, [...(next.get(key) ?? []), row]);
    }
    return Array.from(next.entries());
  }, [rows]);

  if (loading || !user) return null;

  return (
    <div className="relative min-h-screen bg-background">
      <AbstractBg />
      <Header />
      <main className="relative z-10 mx-auto max-w-7xl space-y-6 p-6">
        <Breadcrumb items={[
          { label: "Dashboard", href: dashboardFlowHref(cfg.dashboardFlow) },
          { label: cfg.title },
        ]} />

        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">{cfg.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{cfg.description}</p>
          </div>
          <div className="w-56">
            <Label className="text-xs">Period</Label>
            <Select value={period} onValueChange={(value) => setPeriod(value as Period)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(periodLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card>
          <CardContent className="p-4">
            <Label className="text-xs">Search</Label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${cfg.title.toLowerCase()}`} />
            </div>
          </CardContent>
        </Card>

        {error ? <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}

        <div className="space-y-4">
          {loadingData ? <div className="h-24 rounded-md bg-muted animate-pulse" /> : null}
          {!loadingData && grouped.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No accounts found.</p>
          ) : null}
          {grouped.map(([group, groupRows]) => (
            <Card key={group}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ArrowLeftRight className="h-5 w-5 text-muted-foreground" />
                  {groupLabels[group] ?? "Other Accounts"}
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">{groupRows.length}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {groupRows.map((row) => (
                  <div key={row.id} className="rounded-md border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground">{row.name}</div>
                        <div className="text-xs text-muted-foreground">{groupLabels[row.assetSubtype ?? ""] ?? row.assetSubtype}</div>
                      </div>
                      <Button asChild size="icon" variant="ghost" aria-label="Open account">
                        <Link href={`${cfg.detailBase}/${row.id}`}><ChevronRight className="h-4 w-4" /></Link>
                      </Button>
                    </div>
                    <div className="mt-4 grid gap-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-1.5 text-muted-foreground"><ReceiptText className="h-3.5 w-3.5" />YTD Total</span>
                        <span className="font-semibold">{formatRs(row.periodTotal)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-1.5 text-muted-foreground"><WalletCards className="h-3.5 w-3.5" />This Month</span>
                        <span className="font-semibold">{formatRs(row.thisMonthTotal)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-1.5 text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" />Last Recorded</span>
                        <span className="font-medium">{dateLabel(row.lastRecordedAt)}</span>
                      </div>
                    </div>
                    <Button asChild className="mt-4 w-full" size="sm">
                      <Link href={`${cfg.detailBase}/${row.id}`}>{cfg.actionLabel}</Link>
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
