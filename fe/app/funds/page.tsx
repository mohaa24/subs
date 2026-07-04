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
import { api, type AccountingAccount, type FundPot, type FundTransaction } from "@/lib/api";
import { dashboardFlowHref } from "@/lib/dashboard-flows";
import { toast } from "@/hooks/use-toast";

type FundPeriod = "this_month" | "this_year" | "all_time" | "custom";
type MemberLookup = { id: string; membershipNo: string; hod?: { fullName: string } | null };

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

function txLabel(type: FundTransaction["transactionType"]) {
  switch (type) {
    case "opening":
      return "Opening";
    case "collection":
      return "Collection";
    case "expense":
      return "Expense";
    case "surplus_transfer":
      return "Surplus Transfer";
    case "deficit_transfer":
      return "Deficit Transfer";
  }
}

function dateLabel(value: string) {
  return new Date(value).toLocaleDateString("en-LK");
}

export default function FundsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const canManageFunds = user?.role === "admin" || user?.role === "super_user";
  const [funds, setFunds] = useState<FundPot[]>([]);
  const [selectedFundId, setSelectedFundId] = useState("");
  const [selectedFund, setSelectedFund] = useState<FundPot | null>(null);
  const [accounts, setAccounts] = useState<AccountingAccount[]>([]);
  const [period, setPeriod] = useState<FundPeriod>("this_month");
  const [fromDate, setFromDate] = useState(firstOfMonthString);
  const [toDate, setToDate] = useState(todayString);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [newFund, setNewFund] = useState({
    name: "",
    description: "",
    openingBalance: "",
    openingAssetAccountId: "",
  });
  const [collection, setCollection] = useState({
    amount: "",
    assetAccountId: "",
    paidByName: "",
    paidByMembershipId: "",
    isMember: false,
    memo: "",
  });
  const [expense, setExpense] = useState({
    amount: "",
    assetAccountId: "",
    description: "",
    memo: "",
  });
  const [memberQuery, setMemberQuery] = useState("");
  const [memberOptions, setMemberOptions] = useState<MemberLookup[]>([]);

  const cashBankAccounts = useMemo(
    () => accounts.filter((account) => account.accountType === "asset" && account.assetSubtype === "cash_bank" && account.isActive),
    [accounts],
  );
  const selectedFundClosed = selectedFund?.status === "closed";
  const collections = selectedFund?.transactions?.filter((tx) => tx.transactionType === "opening" || tx.transactionType === "collection") ?? [];
  const expenses = selectedFund?.transactions?.filter((tx) => tx.transactionType === "expense") ?? [];
  const transfers = selectedFund?.transactions?.filter((tx) => tx.transactionType === "surplus_transfer" || tx.transactionType === "deficit_transfer") ?? [];

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, router, user]);

  useEffect(() => {
    if (!user) return;
    void loadFunds();
    void loadAccounts();
  }, [user]);

  useEffect(() => {
    if (!selectedFundId) {
      setSelectedFund(null);
      return;
    }
    void loadFundDetails(selectedFundId);
  }, [selectedFundId]);

  useEffect(() => {
    if (!collection.isMember || memberQuery.trim().length < 2) {
      setMemberOptions([]);
      return;
    }
    const timer = setTimeout(() => {
      api<MemberLookup[]>("/memberships/lookup", { params: { q: memberQuery.trim() } })
        .then(setMemberOptions)
        .catch(() => setMemberOptions([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [collection.isMember, memberQuery]);

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
      if (!selectedFundId && data[0]) setSelectedFundId(data[0].id);
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
      setCollection((v) => ({ ...v, assetAccountId: v.assetAccountId || firstCashBank?.id || "" }));
      setExpense((v) => ({ ...v, assetAccountId: v.assetAccountId || firstCashBank?.id || "" }));
    } catch {
      setAccounts([]);
    }
  }

  async function loadFundDetails(fundId: string) {
    try {
      const fund = await api<FundPot>(`/accounting/funds/${fundId}`);
      setSelectedFund(fund);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load fund details");
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
          openingBalance,
          openingAssetAccountId: openingBalance > 0 ? newFund.openingAssetAccountId : null,
        }),
      });
      setCreateOpen(false);
      setNewFund({ name: "", description: "", openingBalance: "", openingAssetAccountId: cashBankAccounts[0]?.id || "" });
      setSelectedFundId(fund.id);
      await loadFunds();
      await loadFundDetails(fund.id);
      toast({ title: "Fund created", description: `${fund.name} is ready to use.` });
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to create fund", description: err instanceof Error ? err.message : "Unable to create fund" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddCollection(event: FormEvent) {
    event.preventDefault();
    if (!selectedFund) return;
    setSubmitting(true);
    try {
      await api(`/accounting/funds/${selectedFund.id}/collections`, {
        method: "POST",
        body: JSON.stringify({
          amount: Number(collection.amount),
          assetAccountId: collection.assetAccountId,
          paidByName: collection.paidByName,
          paidByMembershipId: collection.isMember ? collection.paidByMembershipId || null : null,
          memo: collection.memo || null,
        }),
      });
      setCollectionOpen(false);
      setCollection({ amount: "", assetAccountId: cashBankAccounts[0]?.id || "", paidByName: "", paidByMembershipId: "", isMember: false, memo: "" });
      setMemberQuery("");
      await loadFunds();
      await loadFundDetails(selectedFund.id);
      toast({ title: "Collection added", description: "Restricted fund collection has been recorded." });
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to add collection", description: err instanceof Error ? err.message : "Unable to add collection" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddExpense(event: FormEvent) {
    event.preventDefault();
    if (!selectedFund) return;
    setSubmitting(true);
    try {
      await api(`/accounting/funds/${selectedFund.id}/expenses`, {
        method: "POST",
        body: JSON.stringify({
          amount: Number(expense.amount),
          assetAccountId: expense.assetAccountId,
          description: expense.description,
          memo: expense.memo || null,
        }),
      });
      setExpenseOpen(false);
      setExpense({ amount: "", assetAccountId: cashBankAccounts[0]?.id || "", description: "", memo: "" });
      await loadFunds();
      await loadFundDetails(selectedFund.id);
      toast({ title: "Expense added", description: "Restricted fund expense has been recorded." });
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to add expense", description: err instanceof Error ? err.message : "Unable to add expense" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTransferBalance() {
    if (!selectedFund) return;
    if (!window.confirm("Transfer the current remaining balance to this fund's surplus or deficit account?")) return;
    setSubmitting(true);
    try {
      await api(`/accounting/funds/${selectedFund.id}/transfer`, { method: "POST", body: JSON.stringify({}) });
      await loadFunds();
      await loadFundDetails(selectedFund.id);
      toast({ title: "Balance transferred", description: "The fund balance has been moved to surplus or deficit." });
    } catch (err) {
      toast({ variant: "destructive", title: "Transfer failed", description: err instanceof Error ? err.message : "Unable to transfer balance" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCloseFund() {
    if (!selectedFund) return;
    if (!window.confirm("Close this fund? Any remaining balance will be transferred first.")) return;
    setSubmitting(true);
    try {
      await api(`/accounting/funds/${selectedFund.id}/close`, { method: "POST", body: JSON.stringify({}) });
      await loadFunds();
      await loadFundDetails(selectedFund.id);
      toast({ title: "Fund closed", description: "The fund is closed and no further activity can be added." });
    } catch (err) {
      toast({ variant: "destructive", title: "Close failed", description: err instanceof Error ? err.message : "Unable to close fund" });
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
            <table className="w-full min-w-[880px] text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-2 text-left font-medium">Fund</th>
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
                    className={`cursor-pointer border-t hover:bg-muted/40 ${selectedFundId === fund.id ? "bg-primary/5" : ""}`}
                    onClick={() => setSelectedFundId(fund.id)}
                  >
                    <td className="p-2">
                      <div className="font-medium">{fund.name}</div>
                      {fund.description ? <div className="text-xs text-muted-foreground">{fund.description}</div> : null}
                    </td>
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
                    <td colSpan={7} className="p-6 text-center text-muted-foreground">No restricted funds created yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {selectedFund ? (
          <Card>
            <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-base">{selectedFund.name}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Active remaining: <span className="font-semibold">{formatRs(selectedFund.summary?.activeRemaining ?? 0)}</span>
                  {selectedFundClosed ? " · Closed" : ""}
                </p>
              </div>
              {canManageFunds ? (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => setCollectionOpen(true)} disabled={selectedFundClosed || submitting}>Add Collection</Button>
                  <Button onClick={() => setExpenseOpen(true)} disabled={selectedFundClosed || submitting} variant="outline">Add Expense</Button>
                  <Button onClick={handleTransferBalance} disabled={selectedFundClosed || submitting} variant="outline">Transfer Balance</Button>
                  <Button onClick={handleCloseFund} disabled={selectedFundClosed || submitting} variant="destructive">Close Fund</Button>
                </div>
              ) : null}
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-3">
              <FundActivityTable title="Collections" rows={collections} />
              <FundActivityTable title="Expenses" rows={expenses} />
              {transfers.length > 0 ? <FundActivityTable title="Transfers" rows={transfers} /> : null}
            </CardContent>
          </Card>
        ) : null}
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
            <Button className="w-full" disabled={submitting}>{submitting ? "Creating…" : "Create Fund"}</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={collectionOpen} onOpenChange={setCollectionOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Collection</DialogTitle></DialogHeader>
          <form className="space-y-3" onSubmit={handleAddCollection}>
            <div className="space-y-1.5">
              <Label>Amount</Label>
              <Input type="number" min="0" step="0.01" value={collection.amount} onChange={(e) => setCollection((v) => ({ ...v, amount: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label>Received Into</Label>
              <Select value={collection.assetAccountId} onValueChange={(value) => setCollection((v) => ({ ...v, assetAccountId: value }))}>
                <SelectTrigger><SelectValue placeholder="Select cash/bank account" /></SelectTrigger>
                <SelectContent>{cashBankAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={collection.isMember}
                onChange={(e) => setCollection((v) => ({ ...v, isMember: e.target.checked, paidByMembershipId: "", paidByName: "" }))}
              />
              Paid by existing member
            </label>
            {collection.isMember ? (
              <div className="space-y-1.5">
                <Label>Search Member</Label>
                <Input value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="Search by membership number" />
                {memberOptions.length > 0 ? (
                  <Select
                    value={collection.paidByMembershipId}
                    onValueChange={(value) => {
                      const member = memberOptions.find((item) => item.id === value);
                      setCollection((v) => ({
                        ...v,
                        paidByMembershipId: value,
                        paidByName: member ? `${member.membershipNo} - ${member.hod?.fullName ?? "Member"}` : v.paidByName,
                      }));
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Select member" /></SelectTrigger>
                    <SelectContent>
                      {memberOptions.map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.membershipNo} - {member.hod?.fullName ?? "Member"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Paid By</Label>
                <Input value={collection.paidByName} onChange={(e) => setCollection((v) => ({ ...v, paidByName: e.target.value }))} required />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Memo</Label>
              <Input value={collection.memo} onChange={(e) => setCollection((v) => ({ ...v, memo: e.target.value }))} />
            </div>
            <Button className="w-full" disabled={submitting || (collection.isMember && !collection.paidByMembershipId)}>
              {submitting ? "Saving…" : "Add Collection"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={expenseOpen} onOpenChange={setExpenseOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Expense</DialogTitle></DialogHeader>
          <form className="space-y-3" onSubmit={handleAddExpense}>
            <div className="space-y-1.5">
              <Label>Amount</Label>
              <Input type="number" min="0" step="0.01" value={expense.amount} onChange={(e) => setExpense((v) => ({ ...v, amount: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label>Paid From</Label>
              <Select value={expense.assetAccountId} onValueChange={(value) => setExpense((v) => ({ ...v, assetAccountId: value }))}>
                <SelectTrigger><SelectValue placeholder="Select cash/bank account" /></SelectTrigger>
                <SelectContent>{cashBankAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={expense.description} onChange={(e) => setExpense((v) => ({ ...v, description: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label>Memo</Label>
              <Input value={expense.memo} onChange={(e) => setExpense((v) => ({ ...v, memo: e.target.value }))} />
            </div>
            <Button className="w-full" disabled={submitting}>{submitting ? "Saving…" : "Add Expense"}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FundActivityTable({ title, rows }: { title: string; rows: FundTransaction[] }) {
  return (
    <div className="rounded-lg border">
      <div className="border-b bg-muted/40 px-3 py-2 font-medium">{title}</div>
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-background">
            <tr>
              <th className="p-2 text-left font-medium">Date</th>
              <th className="p-2 text-left font-medium">Detail</th>
              <th className="p-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="p-2 whitespace-nowrap">{dateLabel(row.transactionDate)}</td>
                <td className="p-2">
                  <div>{row.description || row.paidByName || txLabel(row.transactionType)}</div>
                  {row.memo ? <div className="text-xs text-muted-foreground">{row.memo}</div> : null}
                </td>
                <td className="p-2 text-right tabular-nums">{formatRs(row.amount)}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="p-4 text-center text-muted-foreground">No records yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
