"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Landmark, Plus, RefreshCcw } from "lucide-react";
import { Header } from "@/components/header";
import { AbstractBg } from "@/components/abstract-bg";
import { Breadcrumb } from "@/components/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth-context";
import { api, type AccountingAccount, type FundPot } from "@/lib/api";
import { dashboardFlowHref } from "@/lib/dashboard-flows";
import { toast } from "@/hooks/use-toast";

type FundPeriod = "this_month" | "this_year" | "all_time" | "custom";

const periodLabels: Record<FundPeriod, string> = {
  this_month: "Current Month",
  this_year: "Current Year",
  all_time: "All Time",
  custom: "Custom",
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

function periodRange(period: FundPeriod) {
  if (period === "this_month") return { fromDate: firstOfMonthString(), toDate: todayString() };
  if (period === "this_year") return { fromDate: firstOfYearString(), toDate: todayString() };
  return { fromDate: "", toDate: "" };
}

function formatRs(n: number) {
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n).replace("LKR", "Rs.");
}

function formatFundDate(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-LK");
}

function formatFundPeriod(fund: FundPot) {
  if (!fund.periodStart && !fund.periodEnd) return "Recurring";
  if (fund.periodStart && fund.periodEnd) return `${formatFundDate(fund.periodStart)} - ${formatFundDate(fund.periodEnd)}`;
  if (fund.periodStart) return `From ${formatFundDate(fund.periodStart)}`;
  return `Until ${formatFundDate(fund.periodEnd)}`;
}

export default function FundsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const canManageFunds = user?.role === "admin" || user?.role === "super_user";
  const [funds, setFunds] = useState<FundPot[]>([]);
  const [accounts, setAccounts] = useState<AccountingAccount[]>([]);
  const [period, setPeriod] = useState<FundPeriod>("this_month");
  const [fromDate, setFromDate] = useState(firstOfMonthString);
  const [toDate, setToDate] = useState(todayString);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newFund, setNewFund] = useState({
    name: "",
    description: "",
    managerName: "",
    periodStart: "",
    periodEnd: "",
    openingBalance: "",
    openingAssetAccountId: "",
  });

  const cashBankAccounts = useMemo(
    () => accounts.filter((account) => account.accountType === "asset" && account.assetSubtype === "cash_bank" && account.isActive),
    [accounts],
  );

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, router, user]);

  useEffect(() => {
    if (!user) return;
    void loadFunds();
    void loadAccounts();
  }, [user]);

  function periodParams() {
    const params: Record<string, string> = {};
    if (fromDate) params.fromDate = fromDate;
    if (toDate) params.toDate = toDate;
    return params;
  }

  async function loadFunds() {
    setLoadingData(true);
    setError("");
    try {
      const data = await api<FundPot[]>("/accounting/funds", { params: periodParams() });
      setFunds(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load funds");
    } finally {
      setLoadingData(false);
    }
  }

  async function loadAccounts() {
    try {
      const data = await api<AccountingAccount[]>("/accounting/accounts", { params: { includeInactive: "true" } });
      setAccounts(data);
      const firstCashBank = data.find((account) => account.accountType === "asset" && account.assetSubtype === "cash_bank" && account.isActive);
      setNewFund((v) => ({ ...v, openingAssetAccountId: v.openingAssetAccountId || firstCashBank?.id || "" }));
    } catch {
      setAccounts([]);
    }
  }

  function handlePeriodChange(value: string) {
    const next = value as FundPeriod;
    setPeriod(next);
    const range = periodRange(next);
    setFromDate(range.fromDate);
    setToDate(range.toDate);
    setTimeout(() => void loadFunds(), 0);
  }

  async function handleCreateFund(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const openingBalance = Number(newFund.openingBalance || 0);
      const fund = await api<FundPot>("/accounting/funds", {
        method: "POST",
        body: JSON.stringify({
          name: newFund.name,
          description: newFund.description || null,
          managerName: newFund.managerName || null,
          periodStart: newFund.periodStart || null,
          periodEnd: newFund.periodEnd || null,
          openingBalance,
          openingAssetAccountId: openingBalance > 0 ? newFund.openingAssetAccountId : null,
        }),
      });
      setCreateOpen(false);
      setNewFund({
        name: "",
        description: "",
        managerName: "",
        periodStart: "",
        periodEnd: "",
        openingBalance: "",
        openingAssetAccountId: cashBankAccounts[0]?.id || "",
      });
      toast({ title: "Fund created", description: `${fund.name} is ready to use.` });
      router.push(`/funds/${fund.id}`);
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to create fund", description: err instanceof Error ? err.message : "Unable to create fund" });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !user) return null;

  return (
    <div className="min-h-screen bg-background relative">
      <AbstractBg />
      <Header />
      <main className="relative z-10 p-6 max-w-7xl mx-auto space-y-6">
        <Breadcrumb items={[{ label: "Dashboard", href: dashboardFlowHref("funds") }, { label: "Funds Management" }]} />

        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Funds Management</h1>
            <p className="text-sm text-muted-foreground">
              Track restricted collections, expenses, and surplus or deficit transfers.
            </p>
          </div>
          {canManageFunds ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add New Fund
            </Button>
          ) : null}
        </div>

        <Card>
          <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Landmark className="h-5 w-5 text-muted-foreground" />
              Project Fund Summary
            </CardTitle>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-44">
                <Label className="text-xs">Period</Label>
                <Select value={period} onValueChange={handlePeriodChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(periodLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {period === "custom" ? (
                <>
                  <div>
                    <Label className="text-xs">From</Label>
                    <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">To</Label>
                    <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                  </div>
                </>
              ) : null}
              <Button variant="outline" onClick={loadFunds} disabled={loadingData}>
                <RefreshCcw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}
            <table className="w-full min-w-[1040px] text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-2 text-left font-medium">Fund</th>
                  <th className="p-2 text-left font-medium">Manager</th>
                  <th className="p-2 text-left font-medium">Period</th>
                  <th className="p-2 text-right font-medium">Opening</th>
                  <th className="p-2 text-right font-medium">Received</th>
                  <th className="p-2 text-right font-medium">Spent</th>
                  <th className="p-2 text-right font-medium">Net Transferred</th>
                  <th className="p-2 text-right font-medium">Active Remaining</th>
                  <th className="p-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {funds.map((fund) => (
                  <tr
                    key={fund.id}
                    className="cursor-pointer border-t hover:bg-muted/40"
                    onClick={() => router.push(`/funds/${fund.id}`)}
                  >
                    <td className="p-2">
                      <div className="font-medium">{fund.name}</div>
                      {fund.description ? <div className="text-xs text-muted-foreground">{fund.description}</div> : null}
                    </td>
                    <td className="p-2 text-muted-foreground">{fund.managerName || "Not assigned"}</td>
                    <td className="p-2 text-muted-foreground">{formatFundPeriod(fund)}</td>
                    <td className="p-2 text-right tabular-nums">{formatRs(fund.summary?.opening ?? 0)}</td>
                    <td className="p-2 text-right tabular-nums">{formatRs(fund.summary?.received ?? 0)}</td>
                    <td className="p-2 text-right tabular-nums">{formatRs(fund.summary?.spent ?? 0)}</td>
                    <td className="p-2 text-right tabular-nums">{formatRs(fund.summary?.netTransferred ?? 0)}</td>
                    <td className="p-2 text-right font-semibold tabular-nums">{formatRs(fund.summary?.activeRemaining ?? 0)}</td>
                    <td className="p-2 capitalize text-muted-foreground">{fund.status}</td>
                  </tr>
                ))}
                {funds.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-6 text-center text-muted-foreground">No restricted funds created yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </main>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add New Fund</DialogTitle></DialogHeader>
          <form className="space-y-3" onSubmit={handleCreateFund}>
            <div className="space-y-1.5">
              <Label>Fund Name</Label>
              <Input value={newFund.name} onChange={(e) => setNewFund((v) => ({ ...v, name: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea value={newFund.description} onChange={(e) => setNewFund((v) => ({ ...v, description: e.target.value }))} maxLength={500} />
            </div>
            <div className="space-y-1.5">
              <Label>Fund Manager Name</Label>
              <Input value={newFund.managerName} onChange={(e) => setNewFund((v) => ({ ...v, managerName: e.target.value }))} maxLength={160} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Fund Period Start</Label>
                <Input type="date" value={newFund.periodStart} onChange={(e) => setNewFund((v) => ({ ...v, periodStart: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Fund Period End</Label>
                <Input type="date" value={newFund.periodEnd} onChange={(e) => setNewFund((v) => ({ ...v, periodEnd: e.target.value }))} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Leave the fund period blank for recurring funds.</p>
            <div className="space-y-1.5">
              <Label>Opening Balance</Label>
              <Input type="number" min="0" step="0.01" value={newFund.openingBalance} onChange={(e) => setNewFund((v) => ({ ...v, openingBalance: e.target.value }))} />
            </div>
            {Number(newFund.openingBalance || 0) > 0 ? (
              <div className="space-y-1.5">
                <Label>Opening Balance Asset Account</Label>
                <Select value={newFund.openingAssetAccountId} onValueChange={(value) => setNewFund((v) => ({ ...v, openingAssetAccountId: value }))}>
                  <SelectTrigger><SelectValue placeholder="Select cash/bank account" /></SelectTrigger>
                  <SelectContent>{cashBankAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ) : null}
            <Button className="w-full" disabled={submitting}>{submitting ? "Creating..." : "Create Fund"}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
