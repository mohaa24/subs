"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, CalendarDays, ChevronRight, Info, ReceiptText, Search, WalletCards } from "lucide-react";
import { AbstractBg } from "@/components/abstract-bg";
import { Breadcrumb } from "@/components/breadcrumb";
import { Header } from "@/components/header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, type CashAccountDetail, type CashFlowAccountRow, type CashFlowOverview } from "@/lib/api";
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

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "P";
}

function pill(status?: string | null) {
  return status === "closed"
    ? "bg-slate-100 text-slate-600"
    : "bg-emerald-100 text-emerald-700";
}

function typePill() {
  return "bg-primary/10 text-primary";
}

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
        title: "Payable (Money to Pay)",
        description: "Money that your organisation owes to other people or organisations.",
        overviewPath: "/accounting/cash-out/overview",
        sectionKey: "payable_repayment",
        detailBase: "/cash-out/accounts",
        actionLabel: "Open Payable",
        dashboardFlow: "cash-out" as const,
      };
}

type PayableRow = Omit<CashFlowAccountRow, "status"> & {
  openingBalance: number;
  totalBorrowed: number;
  totalRepaid: number;
  outstandingBalance: number;
  status: "open" | "closed";
};

export function BalanceAccountList({ kind }: { kind: BalanceKind }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const cfg = config(kind);
  const [period, setPeriod] = useState<Period>("this_year");
  const [search, setSearch] = useState("");
  const [overview, setOverview] = useState<CashFlowOverview | null>(null);
  const [payableRows, setPayableRows] = useState<PayableRow[]>([]);
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
      const data = await api<CashFlowOverview>(cfg.overviewPath, {
        params: { ...rangeFor(period), ...(search.trim() ? { q: search.trim() } : {}) },
      });
      setOverview(data);
      if (kind === "payable") {
        const rows = data.sections.find((section) => section.key === cfg.sectionKey)?.rows ?? [];
        const next = await Promise.all(rows.map(async (row) => {
          const detail = await api<CashAccountDetail>(`/accounting/cash-out/accounts/${row.id}`, {
            params: rangeFor(period),
          });
          const borrowed = detail.summary.totalBorrowed ?? detail.summary.totalPayable ?? 0;
          const repaid = detail.summary.totalRepaid ?? detail.summary.totalPaid ?? 0;
          const outstanding = detail.summary.outstandingBalance ?? 0;
          return {
            ...row,
            openingBalance: Number((outstanding - borrowed + repaid).toFixed(2)),
            totalBorrowed: Number(borrowed.toFixed(2)),
            totalRepaid: Number(repaid.toFixed(2)),
            outstandingBalance: Number(outstanding.toFixed(2)),
            status: (detail.account.isActive && !detail.account.closedAt ? "open" : "closed") as "open" | "closed",
          };
        }));
        setPayableRows(next);
      } else {
        setPayableRows([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to load ${cfg.title}`);
    } finally {
      setLoadingData(false);
    }
  }

  const rows = useMemo(() => {
    if (kind === "payable") return payableRows;
    return overview?.sections.find((section) => section.key === cfg.sectionKey)?.rows ?? [];
  }, [cfg.sectionKey, kind, overview, payableRows]);

  const totals = useMemo(() => {
    if (kind !== "payable") {
      return null;
    }
    const payable = rows as PayableRow[];
    return payable.reduce((acc, row) => ({
      openingBalance: acc.openingBalance + row.openingBalance,
      totalBorrowed: acc.totalBorrowed + row.totalBorrowed,
      totalRepaid: acc.totalRepaid + row.totalRepaid,
      outstandingBalance: acc.outstandingBalance + row.outstandingBalance,
    }), { openingBalance: 0, totalBorrowed: 0, totalRepaid: 0, outstandingBalance: 0 });
  }, [kind, rows]);
  const payableList = kind === "payable" ? (rows as PayableRow[]) : [];

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

        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold text-foreground">{cfg.title}</h1>
              <span
                className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                title={cfg.description}
                aria-label={cfg.description}
              >
                <Info className="h-4 w-4" />
              </span>
            </div>
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

        {kind === "payable" ? (
          <div className="grid gap-3 md:grid-cols-4">
            <Metric icon={WalletCards} label="Total Opening" value={formatRs(totals?.openingBalance ?? 0)} />
            <Metric icon={ReceiptText} label="Total Borrowed" value={formatRs(totals?.totalBorrowed ?? 0)} />
            <Metric icon={ArrowLeftRight} label="Total Repaid" value={formatRs(totals?.totalRepaid ?? 0)} />
            <Metric icon={CalendarDays} label="Outstanding Balance" value={formatRs(totals?.outstandingBalance ?? 0)} />
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            <Metric icon={ReceiptText} label="YTD Total" value={formatRs(overview?.totals.periodTotal ?? 0)} />
            <Metric icon={WalletCards} label="Accounts / Funds" value={String(overview?.totals.accountCount ?? 0)} />
            <Metric icon={CalendarDays} label="Period" value={`${dateLabel(rangeFor(period).fromDate)} - ${dateLabel(rangeFor(period).toDate)}`} />
          </div>
        )}

        <Card>
          <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end">
            <div className="flex-1">
              <Label className="text-xs">Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={kind === "payable" ? "Search payable account..." : `Search ${cfg.title.toLowerCase()}`} />
              </div>
            </div>
            {kind === "payable" ? null : (
              <Button variant="outline" onClick={() => { setSearch(""); void loadData(); }}>Clear</Button>
            )}
          </CardContent>
        </Card>

        {error ? <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}

        {kind !== "payable" ? null : (
          <div className="flex items-center justify-between gap-3 rounded-md border bg-card px-4 py-3 text-xs font-medium text-muted-foreground">
            <div className="grid flex-1 grid-cols-[1.4fr_.8fr_1fr_1fr_1fr_.7fr_40px] gap-3">
              <div>Account Name</div>
              <div>Account Type</div>
              <div>Opening Balance</div>
              <div>Total Borrowed</div>
              <div>Total Repaid</div>
              <div>Outstanding Balance</div>
              <div>Status</div>
              <div />
            </div>
          </div>
        )}

        {kind !== "payable" ? null : (
          <div className="space-y-3">
            {loadingData ? <div className="h-24 rounded-md bg-muted animate-pulse" /> : null}
            {!loadingData && payableList.length === 0 ? <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No payable accounts found.</p> : null}
            <div className="space-y-2">
              {payableList.map((row) => (
                <div
                  key={row.id}
                  className="grid gap-3 rounded-md border bg-card p-4 text-sm transition hover:bg-muted/30 md:grid-cols-[1.4fr_.8fr_1fr_1fr_1fr_1fr_.7fr_40px] md:items-center"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {initials(row.name)}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-foreground">{row.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{groupLabels[row.assetSubtype ?? ""] ?? row.assetSubtype ?? "-"}</div>
                    </div>
                  </div>
                  <div><span className={`rounded px-2 py-1 text-xs font-medium ${typePill()}`}>{groupLabels[row.assetSubtype ?? ""] ?? row.assetSubtype ?? "Payable"}</span></div>
                  <div className="font-semibold">{formatRs(row.openingBalance)}</div>
                  <div className="font-semibold text-emerald-700">{formatRs(row.totalBorrowed)}</div>
                  <div className="font-semibold text-indigo-700">{formatRs(row.totalRepaid)}</div>
                  <div className="font-semibold text-orange-700">{formatRs(row.outstandingBalance)}</div>
                  <div><span className={`rounded px-2 py-1 text-xs capitalize ${pill(row.status)}`}>{row.status}</span></div>
                  <div className="flex items-center justify-end">
                    <Button asChild size="icon" variant="ghost" aria-label="Open account">
                      <Link href={`${cfg.detailBase}/${row.id}`}><ChevronRight className="h-4 w-4" /></Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {kind !== "payable" ? (
          <>
            {error ? <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
            <div className="space-y-4">
              {loadingData ? <div className="h-24 rounded-md bg-muted animate-pulse" /> : null}
              {!loadingData && rows.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No accounts found.</p>
              ) : null}
              {rows.map((row) => (
                <Card key={row.id}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ArrowLeftRight className="h-5 w-5 text-muted-foreground" />
                      {groupLabels[row.assetSubtype ?? ""] ?? "Other Accounts"}
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">1</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="hidden gap-3 rounded-md border bg-card p-3 md:grid md:grid-cols-[1.5fr_1fr_1fr_auto_auto] md:items-center">
                      <div>
                        <div className="font-medium text-foreground">{row.name}</div>
                        <div className="text-xs text-muted-foreground">{groupLabels[row.assetSubtype ?? ""] ?? row.assetSubtype}</div>
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><ReceiptText className="h-3.5 w-3.5" />YTD Total</div>
                        <div className="font-semibold text-foreground">{formatRs(row.periodTotal)}</div>
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><WalletCards className="h-3.5 w-3.5" />This Month</div>
                        <div className="font-semibold text-foreground">{formatRs(row.thisMonthTotal)}</div>
                      </div>
                      <div className="text-xs text-muted-foreground md:text-right">
                        <div className="flex items-center gap-1.5 md:justify-end"><CalendarDays className="h-3.5 w-3.5" />Last Recorded</div>
                        <div className="font-medium text-foreground">{dateLabel(row.lastRecordedAt)}</div>
                      </div>
                      <div className="flex items-center gap-2 md:justify-end">
                        <Button asChild size="sm">
                          <Link href={`${cfg.detailBase}/${row.id}`}>{cfg.actionLabel}</Link>
                        </Button>
                        <Button asChild size="icon" variant="ghost" aria-label="Open account">
                          <Link href={`${cfg.detailBase}/${row.id}`}><ChevronRight className="h-4 w-4" /></Link>
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof ReceiptText; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="truncate text-lg font-semibold text-foreground">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
