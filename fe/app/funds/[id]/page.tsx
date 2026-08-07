"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowDownToLine, ArrowLeft, ArrowLeftRight, ArrowUpFromLine, Banknote, Download, Landmark, ReceiptText, Undo2, Upload, X } from "lucide-react";
import { Header } from "@/components/header";
import { AbstractBg } from "@/components/abstract-bg";
import { Breadcrumb } from "@/components/breadcrumb";
import { Button } from "@/components/ui/button";
import { MetricTile, type MetricTileIntent } from "@/components/ui/metric-tile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth-context";
import {
  api,
  apiAssetUrl,
  type AccountingAccount,
  type FundCollectionReceipt,
  type FundPot,
  type FundTransaction,
} from "@/lib/api";
import { dashboardFlowHref } from "@/lib/dashboard-flows";
import { toast } from "@/hooks/use-toast";
import {
  PaymentReceiptDialog,
  type PaymentReceiptData,
} from "@/components/payment-receipt-dialog";

type MemberLookup = {
  id: string;
  membershipNo: string;
  phoneNumber?: string | null;
  hod?: { fullName: string; nameWithInitials?: string | null } | null;
};
type TransferMode = "full" | "partial";

function todayString() {
  return new Date().toISOString().slice(0, 10);
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
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function formatFundPeriod(fund?: FundPot | null) {
  if (!fund?.periodStart && !fund?.periodEnd) return "Recurring fund";
  if (fund.periodStart && fund.periodEnd) return `${dateLabel(fund.periodStart)} - ${dateLabel(fund.periodEnd)}`;
  if (fund.periodStart) return `From ${dateLabel(fund.periodStart)}`;
  return `Until ${dateLabel(fund.periodEnd!)}`;
}

export default function FundDetailPage() {
  const { user, loading } = useAuth();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const fundId = typeof params.id === "string" ? params.id : "";
  const mode = searchParams.get("mode");
  const fundMode = mode === "cash-in" || mode === "cash-out" ? mode : null;
  const canManageFunds = user?.role === "admin" || user?.role === "super_user";

  const [fund, setFund] = useState<FundPot | null>(null);
  const [accounts, setAccounts] = useState<AccountingAccount[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState("");
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [collectionReceipt, setCollectionReceipt] = useState<PaymentReceiptData | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [collection, setCollection] = useState({
    amount: "",
    transactionDate: todayString(),
    assetAccountId: "",
    paidByName: "",
    paidByPhone: "",
    paidByMembershipId: "",
    reference: "",
    memo: "",
  });
  const [expense, setExpense] = useState({
    amount: "",
    transactionDate: todayString(),
    assetAccountId: "",
    description: "",
    paidToPhone: "",
    paidToMembershipId: "",
    reference: "",
    memo: "",
  });
  const [transfer, setTransfer] = useState({
    mode: "full" as TransferMode,
    amount: "",
    memo: "",
  });
  const [memberQuery, setMemberQuery] = useState("");
  const [memberOptions, setMemberOptions] = useState<MemberLookup[]>([]);

  const cashBankAccounts = useMemo(
    () => accounts.filter((account) => account.accountType === "asset" && (account.assetSubtype === "cash" || account.assetSubtype === "bank") && account.isActive),
    [accounts],
  );
  const fundClosed = fund?.status === "closed";
  const collections = fund?.transactions?.filter((tx) => tx.transactionType === "opening" || tx.transactionType === "collection") ?? [];
  const expenses = fund?.transactions?.filter((tx) => tx.transactionType === "expense") ?? [];
  const transfers = fund?.transactions?.filter((tx) => tx.transactionType === "surplus_transfer" || tx.transactionType === "deficit_transfer") ?? [];
  const liveBalance = fund?.summary?.activeRemaining ?? 0;
  const transferLimit = Math.abs(liveBalance);
  const transferDirection = liveBalance > 0 ? "surplus out of this special fund" : "deficit into this special fund";
  const transferredFromFundPerspective = -(fund?.summary?.netTransferred ?? 0);
  const backHref = fundMode ? `/${fundMode}` : "/funds";
  const backLabel = fundMode === "cash-in" ? "Back to Cash In" : fundMode === "cash-out" ? "Back to Cash Out" : "Back to fund summary";

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, router, user]);

  useEffect(() => {
    if (!user || !fundId) return;
    void loadFundDetails();
    void loadAccounts();
  }, [fundId, user]);

  useEffect(() => {
    if (memberQuery.trim().length < 2) {
      setMemberOptions([]);
      return;
    }
    const timer = setTimeout(() => {
      api<MemberLookup[]>("/memberships/lookup", { params: { q: memberQuery.trim() } })
        .then(setMemberOptions)
        .catch(() => setMemberOptions([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [memberQuery]);

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
      const firstCashBank = data.find((account) => account.accountType === "asset" && (account.assetSubtype === "cash" || account.assetSubtype === "bank") && account.isActive);
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
      const transaction = await api<FundTransaction>(`/accounting/funds/${fund.id}/collections`, {
        method: "POST",
        body: JSON.stringify({
          amount: Number(collection.amount),
          transactionDate: collection.transactionDate,
          assetAccountId: collection.assetAccountId,
          paidByName: collection.paidByName,
          paidByPhone: collection.paidByPhone || null,
          paidByMembershipId: collection.paidByMembershipId || null,
          memo: [collection.reference, collection.memo].filter(Boolean).join(" - ") || null,
        }),
      });
      setCollectionOpen(false);
      setCollection({ amount: "", transactionDate: todayString(), assetAccountId: cashBankAccounts[0]?.id || "", paidByName: "", paidByPhone: "", paidByMembershipId: "", reference: "", memo: "" });
      setMemberQuery("");
      await loadFundDetails();
      await openCollectionReceipt(transaction.id);
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
          transactionDate: expense.transactionDate,
          assetAccountId: expense.assetAccountId,
          description: expense.description,
          memo: [expense.reference, expense.paidToPhone, expense.memo].filter(Boolean).join(" - ") || null,
        }),
      });
      setExpenseOpen(false);
      setExpense({ amount: "", transactionDate: todayString(), assetAccountId: cashBankAccounts[0]?.id || "", description: "", paidToPhone: "", paidToMembershipId: "", reference: "", memo: "" });
      await loadFundDetails();
      toast({ title: "Expense added", description: "Restricted fund expense has been recorded." });
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to add expense", description: err instanceof Error ? err.message : "Unable to add expense" });
    } finally {
      setSubmitting(false);
    }
  }

  async function openCollectionReceipt(transactionId: string) {
    try {
      const receipt = await api<FundCollectionReceipt>(`/accounting/fund-transactions/${transactionId}/receipt`);
      setCollectionReceipt(toFundReceiptData(receipt));
      setReceiptOpen(true);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Receipt could not be loaded",
        description: err instanceof Error ? err.message : "The collection was saved, but receipt loading failed.",
      });
    }
  }

  async function handleReverseFundTransaction(transaction: FundTransaction) {
    const reason = window.prompt("Reason for reversal");
    if (!reason?.trim()) return;
    try {
      await api(`/accounting/fund-transactions/${transaction.id}/reverse`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      toast({ title: "Fund transaction reversed", description: transaction.receiptNumber ?? transaction.id });
      await loadFundDetails();
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to reverse fund transaction", description: err instanceof Error ? err.message : "Unable to reverse" });
    }
  }

  function handleSelectMember(member: MemberLookup) {
    const memberName = member.hod?.fullName || member.hod?.nameWithInitials || "Member";
    const label = `${member.membershipNo} - ${memberName}`;
    if (expenseOpen) {
      setExpense((v) => ({
        ...v,
        description: label,
        paidToPhone: member.phoneNumber || v.paidToPhone,
        paidToMembershipId: member.id,
      }));
    } else {
      setCollection((v) => ({
        ...v,
        paidByName: label,
        paidByPhone: member.phoneNumber || v.paidByPhone,
        paidByMembershipId: member.id,
      }));
    }
    setMemberQuery(label);
    setMemberOptions([]);
  }

  async function handleTransferBalance(event: FormEvent) {
    event.preventDefault();
    if (!fund) return;
    const partialAmount = transfer.mode === "partial" ? Number(transfer.amount) : null;
    if (transfer.mode === "partial" && (!partialAmount || partialAmount <= 0 || partialAmount > transferLimit)) {
      toast({
        variant: "destructive",
        title: "Invalid transfer amount",
        description: `Enter an amount greater than 0 and no more than ${formatRs(transferLimit)}.`,
      });
      return;
    }
    setSubmitting(true);
    try {
      await api(`/accounting/funds/${fund.id}/transfer`, {
        method: "POST",
        body: JSON.stringify({
          amount: transfer.mode === "partial" ? partialAmount : null,
          memo: transfer.memo || null,
        }),
      });
      setTransferOpen(false);
      setTransfer({ mode: "full", amount: "", memo: "" });
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
            { label: "Dashboard", href: dashboardFlowHref(fundMode ?? "funds") },
            { label: fundMode === "cash-in" ? "Cash In" : fundMode === "cash-out" ? "Cash Out" : "Funds Management", href: backHref },
            { label: fund?.name || "Fund Details" },
          ]}
        />

        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <Button variant="ghost" className="px-0 text-muted-foreground" onClick={() => router.push(backHref)}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {backLabel}
            </Button>
            <div>
              <h1 className="text-xl font-semibold text-foreground">{fund?.name || "Fund Details"}</h1>
              <p className="text-sm text-muted-foreground">
                {fund?.description || "Review this fund's collections, expenses, and surplus or deficit transfers."}
              </p>
              {fund ? (
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full border bg-background px-2 py-1">
                    Manager: {fund.managerName || "Not assigned"}
                  </span>
                  <span className="rounded-full border bg-background px-2 py-1">
                    Period: {formatFundPeriod(fund)}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
          {canManageFunds ? (
            <div className="flex flex-wrap gap-2">
              {fundMode !== "cash-out" ? (
                <Button variant="cashIn" onClick={() => { setMemberQuery(""); setMemberOptions([]); setCollectionOpen(true); }} disabled={fundClosed || submitting || loadingData}>
                  <Download className="mr-2 h-4 w-4" />
                  Receive
                </Button>
              ) : null}
              {fundMode !== "cash-in" ? (
                <Button onClick={() => { setMemberQuery(""); setMemberOptions([]); setExpenseOpen(true); }} disabled={fundClosed || submitting || loadingData} variant="cashOut">
                  <Upload className="mr-2 h-4 w-4" />Pay Expense
                </Button>
              ) : null}
              {!fundMode ? (
                <>
                  <Button onClick={() => setTransferOpen(true)} disabled={fundClosed || submitting || loadingData || transferLimit <= 0} variant="transfer"><ArrowLeftRight className="mr-2 h-4 w-4" />Transfer Balance</Button>
                  <Button onClick={handleCloseFund} disabled={fundClosed || submitting || loadingData} variant="neutralOutline"><X className="mr-2 h-4 w-4" />Close Fund</Button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard icon={ArrowDownToLine} title="Total Collected" value={(fund?.summary?.opening ?? 0) + (fund?.summary?.received ?? 0)} intent="cashIn" />
          <SummaryCard icon={ArrowUpFromLine} title="Total Spent" value={-(fund?.summary?.spent ?? 0)} intent="cashOut" />
          <SummaryCard
            icon={ArrowLeftRight}
            title="Total Transferred"
            value={transferredFromFundPerspective}
            intent="transfer"
          />
          <SummaryCard icon={Banknote} title="Remaining Balance" value={fund?.summary?.activeRemaining ?? 0} intent="credit" />
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
            <FundActivityTable title="Collections" rows={collections} onReceiptClick={openCollectionReceipt} onReverse={canManageFunds ? handleReverseFundTransaction : undefined} />
            <FundActivityTable title="Expenses" rows={expenses} onReverse={canManageFunds ? handleReverseFundTransaction : undefined} />
            {transfers.length > 0 ? <FundActivityTable title="Transfers" rows={transfers} /> : null}
          </CardContent>
        </Card>
      </main>

      <Dialog open={collectionOpen} onOpenChange={setCollectionOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{fundMode === "cash-in" ? "Record Income" : "Add Collection"}</DialogTitle></DialogHeader>
          <form className="space-y-4" onSubmit={handleAddCollection}>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Date</Label>
                <Input type="date" value={collection.transactionDate} onChange={(e) => setCollection((v) => ({ ...v, transactionDate: e.target.value }))} required />
              </div>
              <div>
                <Label>Amount</Label>
                <Input type="number" min="0" step="0.01" value={collection.amount} onChange={(e) => setCollection((v) => ({ ...v, amount: e.target.value }))} required />
              </div>
              <div>
                <Label>Received From</Label>
                <Input value={collection.paidByName} onChange={(e) => setCollection((v) => ({ ...v, paidByName: e.target.value, paidByMembershipId: "" }))} required />
              </div>
              <div className="space-y-1.5">
                <Label>Member Search</Label>
                <Input value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="Search by name or membership no" />
                {memberOptions.length > 0 ? (
                  <div className="mt-1 max-h-36 overflow-auto rounded-md border bg-popover p-1">
                    {memberOptions.map((member) => (
                      <button type="button" key={member.id} className="w-full rounded px-2 py-1 text-left text-sm hover:bg-accent" onClick={() => handleSelectMember(member)}>
                        {member.membershipNo} - {member.hod?.fullName || member.hod?.nameWithInitials || "Member"}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div>
                <Label>Payment Method</Label>
                <Select value={collection.assetAccountId} onValueChange={(value) => setCollection((v) => ({ ...v, assetAccountId: value }))}>
                  <SelectTrigger><SelectValue placeholder="Select cash/bank account" /></SelectTrigger>
                  <SelectContent>{cashBankAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Phone Number</Label>
                <Input value={collection.paidByPhone} onChange={(e) => setCollection((v) => ({ ...v, paidByPhone: e.target.value }))} />
              </div>
              <div>
                <Label>Reference</Label>
                <Input value={collection.reference} onChange={(e) => setCollection((v) => ({ ...v, reference: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={collection.memo} onChange={(e) => setCollection((v) => ({ ...v, memo: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="dangerOutline" onClick={() => setCollectionOpen(false)}>Cancel</Button>
              <Button variant="cashIn" disabled={submitting}><Download className="mr-2 h-4 w-4" />{submitting ? "Saving..." : "Receive"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={expenseOpen} onOpenChange={setExpenseOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{fundMode === "cash-out" ? "Record Expense" : "Add Expense"}</DialogTitle></DialogHeader>
          <form className="space-y-4" onSubmit={handleAddExpense}>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Date</Label>
                <Input type="date" value={expense.transactionDate} onChange={(e) => setExpense((v) => ({ ...v, transactionDate: e.target.value }))} required />
              </div>
              <div>
                <Label>Amount</Label>
                <Input type="number" min="0" step="0.01" value={expense.amount} onChange={(e) => setExpense((v) => ({ ...v, amount: e.target.value }))} required />
              </div>
              <div>
                <Label>Paid To</Label>
                <Input value={expense.description} onChange={(e) => setExpense((v) => ({ ...v, description: e.target.value, paidToMembershipId: "" }))} required />
              </div>
              <div className="space-y-1.5">
                <Label>Member Search</Label>
                <Input value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="Search by name or membership no" />
                {memberOptions.length > 0 ? (
                  <div className="mt-1 max-h-36 overflow-auto rounded-md border bg-popover p-1">
                    {memberOptions.map((member) => (
                      <button type="button" key={member.id} className="w-full rounded px-2 py-1 text-left text-sm hover:bg-accent" onClick={() => handleSelectMember(member)}>
                        {member.membershipNo} - {member.hod?.fullName || member.hod?.nameWithInitials || "Member"}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div>
                <Label>Payment Method</Label>
                <Select value={expense.assetAccountId} onValueChange={(value) => setExpense((v) => ({ ...v, assetAccountId: value }))}>
                  <SelectTrigger><SelectValue placeholder="Select cash/bank account" /></SelectTrigger>
                  <SelectContent>{cashBankAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Phone Number</Label>
                <Input value={expense.paidToPhone} onChange={(e) => setExpense((v) => ({ ...v, paidToPhone: e.target.value }))} />
              </div>
              <div>
                <Label>Reference</Label>
                <Input value={expense.reference} onChange={(e) => setExpense((v) => ({ ...v, reference: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={expense.memo} onChange={(e) => setExpense((v) => ({ ...v, memo: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="dangerOutline" onClick={() => setExpenseOpen(false)}>Cancel</Button>
              <Button variant="cashOut" disabled={submitting}><Upload className="mr-2 h-4 w-4" />{submitting ? "Saving..." : "Pay Expense"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Transfer Balance</DialogTitle></DialogHeader>
          <form className="space-y-4" onSubmit={handleTransferBalance}>
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Live fund balance</span>
                <span className={`font-semibold tabular-nums ${liveBalance < 0 ? "text-destructive" : "text-primary"}`}>
                  {formatRs(liveBalance)}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                This will transfer {transferDirection}. Maximum transfer amount is {formatRs(transferLimit)}.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm">
                <input
                  type="radio"
                  name="transferMode"
                  checked={transfer.mode === "full"}
                  onChange={() => setTransfer((v) => ({ ...v, mode: "full", amount: "" }))}
                />
                Full Amount
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm">
                <input
                  type="radio"
                  name="transferMode"
                  checked={transfer.mode === "partial"}
                  onChange={() => setTransfer((v) => ({ ...v, mode: "partial" }))}
                />
                Partial Amount
              </label>
            </div>
            {transfer.mode === "partial" ? (
              <div className="space-y-1.5">
                <Label>Transfer Amount</Label>
                <Input
                  type="number"
                  min="0.01"
                  max={transferLimit || undefined}
                  step="0.01"
                  value={transfer.amount}
                  onChange={(e) => setTransfer((v) => ({ ...v, amount: e.target.value }))}
                  required
                />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label>Optional Notes</Label>
              <Input value={transfer.memo} onChange={(e) => setTransfer((v) => ({ ...v, memo: e.target.value }))} placeholder="Reason or approval note" />
            </div>
            <Button variant="transfer" className="w-full" disabled={submitting || transferLimit <= 0}>
              <ArrowLeftRight className="mr-2 h-4 w-4" />
              {submitting ? "Transferring..." : "Transfer Balance"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <PaymentReceiptDialog
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
        receipt={collectionReceipt}
      />
    </div>
  );
}

function SummaryCard({
  icon,
  title,
  value,
  intent,
}: {
  icon: typeof ReceiptText;
  title: string;
  value: number;
  intent: MetricTileIntent;
}) {
  return <MetricTile icon={icon} label={title} value={formatRs(value)} intent={intent} />;
}

function toFundReceiptData(receipt: FundCollectionReceipt): PaymentReceiptData {
  return {
    paymentKind: "fund",
    organizationName: receipt.organizationName,
    organizationReceiptLogoUrl: apiAssetUrl(receipt.organizationReceiptLogoUrl),
    membershipNo: receipt.fundName,
    membershipId: "",
    memberName: receipt.paidByName,
    paymentId: receipt.transactionId,
    receiptNumber: receipt.receiptNumber,
    paymentDate: receipt.transactionDate,
    paymentMethod: receipt.receivedInto || "Cash/Bank",
    paidAmount: receipt.amount,
    appliedToDue: 0,
    overpaymentToCredit: 0,
    remainingAfter: 0,
    outstandingAfterPayment: 0,
    creditBalanceAfterPayment: 0,
    note: receipt.note || null,
    collectedBy: receipt.collectedBy || undefined,
    memberQrValue: "",
    receiptTitle: "SPECIAL FUND RECEIPT",
    primaryLabel: "Fund",
    nameLabel: "Paid By",
    amountLabel: "Collected",
    showBalanceAfterPayment: false,
    extraRows: receipt.paidByPhone ? [{ label: "Phone", value: receipt.paidByPhone }] : [],
  };
}

function FundActivityTable({
  title,
  rows,
  onReceiptClick,
  onReverse,
}: {
  title: string;
  rows: FundTransaction[];
  onReceiptClick?: (transactionId: string) => void;
  onReverse?: (transaction: FundTransaction) => void;
}) {
  const showReceiptColumn = Boolean(onReceiptClick);
  const showActionColumn = Boolean(onReverse);
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
              <th className="p-2 text-left font-medium">Status</th>
              {showReceiptColumn ? <th className="p-2 text-right font-medium">Receipt</th> : null}
              {showActionColumn ? <th className="p-2 text-right font-medium">Action</th> : null}
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
                <td className="p-2">
                  {row.reversedAt ? <span className="text-destructive">Reversed</span> : <span className="text-emerald-700">Posted</span>}
                </td>
                {showReceiptColumn ? (
                  <td className="p-2 text-right">
                    {row.transactionType === "collection" && row.receiptNumber ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2"
                        onClick={() => onReceiptClick?.(row.id)}
                      >
                        <ReceiptText className="mr-1 h-3.5 w-3.5" />
                        {row.receiptNumber}
                      </Button>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                ) : null}
                {showActionColumn ? (
                  <td className="p-2 text-right">
                    {!row.reversedAt && (row.transactionType === "collection" || row.transactionType === "expense") ? (
                      <Button type="button" variant="dangerOutline" size="sm" onClick={() => onReverse?.(row)}>
                        <Undo2 className="mr-1 h-3.5 w-3.5" />
                        Reverse
                      </Button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3 + 1 + (showReceiptColumn ? 1 : 0) + (showActionColumn ? 1 : 0)} className="p-4 text-center text-muted-foreground">No records yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
