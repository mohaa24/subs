"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Landmark, Plus } from "lucide-react";
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
import { useAuth } from "@/lib/auth-context";
import { api, type AccountingAccount, type FundPot, type FundTransaction } from "@/lib/api";
import { dashboardFlowHref } from "@/lib/dashboard-flows";
import { toast } from "@/hooks/use-toast";

type MemberLookup = { id: string; membershipNo: string; hod?: { fullName: string } | null };

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

export default function FundDetailPage() {
  const { user, loading } = useAuth();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const fundId = typeof params.id === "string" ? params.id : "";
  const canManageFunds = user?.role === "admin" || user?.role === "super_user";

  const [fund, setFund] = useState<FundPot | null>(null);
  const [accounts, setAccounts] = useState<AccountingAccount[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState("");
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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
  const fundClosed = fund?.status === "closed";
  const collections = fund?.transactions?.filter((tx) => tx.transactionType === "opening" || tx.transactionType === "collection") ?? [];
  const expenses = fund?.transactions?.filter((tx) => tx.transactionType === "expense") ?? [];
  const transfers = fund?.transactions?.filter((tx) => tx.transactionType === "surplus_transfer" || tx.transactionType === "deficit_transfer") ?? [];

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, router, user]);

  useEffect(() => {
    if (!user || !fundId) return;
    void loadFundDetails();
    void loadAccounts();
  }, [fundId, user]);

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

  async function loadFundDetails() {
    setLoadingData(true);
    setError("");
    try {
      const data = await api<FundPot>(`/accounting/funds/${fundId}`);
      setFund(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load fund details");
    } finally {
      setLoadingData(false);
    }
  }

  async function loadAccounts() {
    try {
      const data = await api<AccountingAccount[]>("/accounting/accounts", { params: { includeInactive: "true" } });
      setAccounts(data);
      const firstCashBank = data.find((account) => account.accountType === "asset" && account.assetSubtype === "cash_bank" && account.isActive);
      setCollection((v) => ({ ...v, assetAccountId: v.assetAccountId || firstCashBank?.id || "" }));
      setExpense((v) => ({ ...v, assetAccountId: v.assetAccountId || firstCashBank?.id || "" }));
    } catch {
      setAccounts([]);
    }
  }

  async function handleAddCollection(event: FormEvent) {
    event.preventDefault();
    if (!fund) return;
    setSubmitting(true);
    try {
      await api(`/accounting/funds/${fund.id}/collections`, {
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
      await loadFundDetails();
      toast({ title: "Collection added", description: "Restricted fund collection has been recorded." });
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to add collection", description: err instanceof Error ? err.message : "Unable to add collection" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddExpense(event: FormEvent) {
    event.preventDefault();
    if (!fund) return;
    setSubmitting(true);
    try {
      await api(`/accounting/funds/${fund.id}/expenses`, {
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
      await loadFundDetails();
      toast({ title: "Expense added", description: "Restricted fund expense has been recorded." });
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to add expense", description: err instanceof Error ? err.message : "Unable to add expense" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTransferBalance() {
    if (!fund) return;
    if (!window.confirm("Transfer the current remaining balance to this fund's surplus or deficit account?")) return;
    setSubmitting(true);
    try {
      await api(`/accounting/funds/${fund.id}/transfer`, { method: "POST", body: JSON.stringify({}) });
      await loadFundDetails();
      toast({ title: "Balance transferred", description: "The fund balance has been moved to surplus or deficit." });
    } catch (err) {
      toast({ variant: "destructive", title: "Transfer failed", description: err instanceof Error ? err.message : "Unable to transfer balance" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCloseFund() {
    if (!fund) return;
    if (!window.confirm("Close this fund? Any remaining balance will be transferred first.")) return;
    setSubmitting(true);
    try {
      await api(`/accounting/funds/${fund.id}/close`, { method: "POST", body: JSON.stringify({}) });
      await loadFundDetails();
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
        <Breadcrumb
          items={[
            { label: "Dashboard", href: dashboardFlowHref("funds") },
            { label: "Funds Management", href: "/funds" },
            { label: fund?.name || "Fund Details" },
          ]}
        />

        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <Button variant="ghost" className="px-0 text-muted-foreground" onClick={() => router.push("/funds")}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to fund summary
            </Button>
            <div>
              <h1 className="text-xl font-semibold text-foreground">{fund?.name || "Fund Details"}</h1>
              <p className="text-sm text-muted-foreground">
                {fund?.description || "Review this fund's collections, expenses, and surplus or deficit transfers."}
              </p>
            </div>
          </div>
          {canManageFunds ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setCollectionOpen(true)} disabled={fundClosed || submitting || loadingData}>
                <Plus className="mr-2 h-4 w-4" />
                Add Collection
              </Button>
              <Button onClick={() => setExpenseOpen(true)} disabled={fundClosed || submitting || loadingData} variant="outline">Add Expense</Button>
              <Button onClick={handleTransferBalance} disabled={fundClosed || submitting || loadingData} variant="outline">Transfer Balance</Button>
              <Button onClick={handleCloseFund} disabled={fundClosed || submitting || loadingData} variant="destructive">Close Fund</Button>
            </div>
          ) : null}
        </div>

        {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <SummaryCard title="Opening" value={fund?.summary?.opening ?? 0} />
          <SummaryCard title="Received" value={fund?.summary?.received ?? 0} />
          <SummaryCard title="Spent" value={fund?.summary?.spent ?? 0} />
          <SummaryCard title="Net Transferred" value={fund?.summary?.netTransferred ?? 0} />
          <SummaryCard title="Active Remaining" value={fund?.summary?.activeRemaining ?? 0} emphasis />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Landmark className="h-5 w-5 text-muted-foreground" />
              Fund Activity
              {fundClosed ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">Closed</span> : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-3">
            <FundActivityTable title="Collections" rows={collections} />
            <FundActivityTable title="Expenses" rows={expenses} />
            {transfers.length > 0 ? <FundActivityTable title="Transfers" rows={transfers} /> : null}
          </CardContent>
        </Card>
      </main>

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
              <Label>Optional Notes</Label>
              <Input value={collection.memo} onChange={(e) => setCollection((v) => ({ ...v, memo: e.target.value }))} placeholder="Invoice, reference, or approval note" />
            </div>
            <Button className="w-full" disabled={submitting || (collection.isMember && !collection.paidByMembershipId)}>
              {submitting ? "Saving..." : "Add Collection"}
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
              <Label>Optional Notes</Label>
              <Input value={expense.memo} onChange={(e) => setExpense((v) => ({ ...v, memo: e.target.value }))} placeholder="Invoice, reference, or approval note" />
            </div>
            <Button className="w-full" disabled={submitting}>{submitting ? "Saving..." : "Add Expense"}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({ title, value, emphasis = false }: { title: string; value: number; emphasis?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
        <p className={`mt-2 text-lg font-semibold tabular-nums ${emphasis ? "text-primary" : ""}`}>{formatRs(value)}</p>
      </CardContent>
    </Card>
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
                  {row.assetAccount?.name ? <div className="text-xs text-muted-foreground">{row.assetAccount.name}</div> : null}
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
