"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Landmark, Plus, ReceiptText } from "lucide-react";
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

type MemberLookup = {
  id: string;
  membershipNo: string;
  phoneNumber?: string | null;
  hod?: { fullName: string; nameWithInitials?: string | null } | null;
};
type TransferMode = "full" | "partial";

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

function dateTimeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const datePart = dateLabel(value);
  return `${datePart} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
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
  const fundId = typeof params.id === "string" ? params.id : "";
  const canManageFunds = user?.role === "admin" || user?.role === "super_user";

  const [fund, setFund] = useState<FundPot | null>(null);
  const [accounts, setAccounts] = useState<AccountingAccount[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState("");
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [collectionReceipt, setCollectionReceipt] = useState<FundCollectionReceipt | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [collection, setCollection] = useState({
    amount: "",
    assetAccountId: "",
    paidByName: "",
    paidByPhone: "",
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
  const [transfer, setTransfer] = useState({
    mode: "full" as TransferMode,
    amount: "",
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
  const liveBalance = fund?.summary?.activeRemaining ?? 0;
  const transferLimit = Math.abs(liveBalance);
  const transferDirection = liveBalance > 0 ? "surplus out of this project fund" : "deficit into this project fund";
  const transferredFromFundPerspective = -(fund?.summary?.netTransferred ?? 0);

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
      const transaction = await api<FundTransaction>(`/accounting/funds/${fund.id}/collections`, {
        method: "POST",
        body: JSON.stringify({
          amount: Number(collection.amount),
          assetAccountId: collection.assetAccountId,
          paidByName: collection.paidByName,
          paidByPhone: collection.paidByPhone || null,
          paidByMembershipId: collection.isMember ? collection.paidByMembershipId || null : null,
          memo: collection.memo || null,
        }),
      });
      setCollectionOpen(false);
      setCollection({ amount: "", assetAccountId: cashBankAccounts[0]?.id || "", paidByName: "", paidByPhone: "", paidByMembershipId: "", isMember: false, memo: "" });
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

  async function openCollectionReceipt(transactionId: string) {
    try {
      const receipt = await api<FundCollectionReceipt>(`/accounting/fund-transactions/${transactionId}/receipt`);
      setCollectionReceipt(receipt);
      setReceiptOpen(true);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Receipt could not be loaded",
        description: err instanceof Error ? err.message : "The collection was saved, but receipt loading failed.",
      });
    }
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
              <Button onClick={() => setCollectionOpen(true)} disabled={fundClosed || submitting || loadingData}>
                <Plus className="mr-2 h-4 w-4" />
                Add Collection
              </Button>
              <Button onClick={() => setExpenseOpen(true)} disabled={fundClosed || submitting || loadingData} variant="outline">Add Expense</Button>
              <Button onClick={() => setTransferOpen(true)} disabled={fundClosed || submitting || loadingData || transferLimit <= 0} variant="outline">Transfer Balance</Button>
              <Button onClick={handleCloseFund} disabled={fundClosed || submitting || loadingData} variant="destructive">Close Fund</Button>
            </div>
          ) : null}
        </div>

        {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard title="Total Collected" value={(fund?.summary?.opening ?? 0) + (fund?.summary?.received ?? 0)} />
          <SummaryCard title="Total Spent" value={-(fund?.summary?.spent ?? 0)} tone="negative" />
          <SummaryCard
            title="Total Transferred"
            value={transferredFromFundPerspective}
            tone={transferredFromFundPerspective < 0 ? "negative" : transferredFromFundPerspective > 0 ? "positive" : "default"}
          />
          <SummaryCard title="Remaining Balance" value={fund?.summary?.activeRemaining ?? 0} emphasis />
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
            <FundActivityTable title="Collections" rows={collections} onReceiptClick={openCollectionReceipt} />
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
                onChange={(e) => setCollection((v) => ({ ...v, isMember: e.target.checked, paidByMembershipId: "", paidByName: "", paidByPhone: "" }))}
              />
              Paid by existing member
            </label>
            {collection.isMember ? (
              <div className="space-y-1.5">
                <Label>Search Member</Label>
                <Input value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="Search by membership number, name, or phone" />
                {memberOptions.length > 0 ? (
                  <Select
                    value={collection.paidByMembershipId}
                    onValueChange={(value) => {
                      const member = memberOptions.find((item) => item.id === value);
                      const memberName = member?.hod?.fullName || member?.hod?.nameWithInitials || "Member";
                      setCollection((v) => ({
                        ...v,
                        paidByMembershipId: value,
                        paidByName: member ? `${member.membershipNo} - ${memberName}` : v.paidByName,
                        paidByPhone: member?.phoneNumber || v.paidByPhone,
                      }));
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Select member" /></SelectTrigger>
                    <SelectContent>
                      {memberOptions.map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.membershipNo} - {member.hod?.fullName || member.hod?.nameWithInitials || "Member"}
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
              <Label>Phone Number (Optional)</Label>
              <Input value={collection.paidByPhone} onChange={(e) => setCollection((v) => ({ ...v, paidByPhone: e.target.value }))} placeholder="Auto-filled for existing members when available" />
            </div>
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
            <Button className="w-full" disabled={submitting || transferLimit <= 0}>
              {submitting ? "Transferring..." : "Transfer Balance"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <FundCollectionReceiptDialog
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
        receipt={collectionReceipt}
      />
    </div>
  );
}

function SummaryCard({
  title,
  value,
  emphasis = false,
  tone = "default",
}: {
  title: string;
  value: number;
  emphasis?: boolean;
  tone?: "default" | "positive" | "negative";
}) {
  const toneClass = tone === "negative" ? "text-destructive" : tone === "positive" ? "text-primary" : "";
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
        <p className={`mt-2 text-lg font-semibold tabular-nums ${emphasis ? "text-primary" : toneClass}`}>{formatRs(value)}</p>
      </CardContent>
    </Card>
  );
}

function escapeReceiptText(value?: string | null) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function FundCollectionReceiptDialog({
  open,
  onOpenChange,
  receipt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receipt: FundCollectionReceipt | null;
}) {
  const logoUrl = apiAssetUrl(receipt?.organizationReceiptLogoUrl);

  function printReceipt() {
    if (!receipt) return;
    const popup = window.open("", "_blank", "width=420,height=700");
    if (!popup) return;
    popup.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>Fund Receipt ${escapeReceiptText(receipt.receiptNumber)}</title>
          <style>
            * { box-sizing: border-box; }
            body { margin: 0; padding: 16px; font-family: Arial, sans-serif; color: #111827; }
            .receipt { width: 320px; margin: 0 auto; }
            .logo { width: 100%; max-height: 88px; object-fit: contain; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px; margin-bottom: 12px; }
            .title { text-align: center; font-size: 16px; font-weight: 700; margin: 0; }
            .sub { text-align: center; font-size: 12px; color: #4b5563; margin: 4px 0 12px; }
            .line { display: flex; justify-content: space-between; gap: 16px; border-top: 1px dashed #d1d5db; padding: 8px 0; font-size: 12px; }
            .label { color: #6b7280; }
            .amount { font-size: 18px; font-weight: 700; text-align: right; }
            @media print { body { padding: 0; } .receipt { width: 72mm; } }
          </style>
        </head>
        <body>
          <div class="receipt">
            ${logoUrl ? `<img class="logo" src="${escapeReceiptText(logoUrl)}" alt="Receipt logo" />` : ""}
            <p class="title">${escapeReceiptText(receipt.organizationName)}</p>
            <p class="sub">Project Fund Collection Receipt</p>
            <div class="line"><span class="label">Receipt No</span><strong>${escapeReceiptText(receipt.receiptNumber)}</strong></div>
            <div class="line"><span class="label">Date</span><span>${escapeReceiptText(dateTimeLabel(receipt.transactionDate))}</span></div>
            <div class="line"><span class="label">Fund</span><span>${escapeReceiptText(receipt.fundName)}</span></div>
            <div class="line"><span class="label">Paid By</span><span>${escapeReceiptText(receipt.paidByName)}</span></div>
            ${receipt.paidByPhone ? `<div class="line"><span class="label">Phone</span><span>${escapeReceiptText(receipt.paidByPhone)}</span></div>` : ""}
            <div class="line"><span class="label">Received Into</span><span>${escapeReceiptText(receipt.receivedInto || "Cash/Bank")}</span></div>
            ${receipt.note ? `<div class="line"><span class="label">Notes</span><span>${escapeReceiptText(receipt.note)}</span></div>` : ""}
            <div class="line"><span class="label">Amount</span><span class="amount">${escapeReceiptText(formatRs(receipt.amount))}</span></div>
            ${receipt.collectedBy ? `<div class="line"><span class="label">Collected By</span><span>${escapeReceiptText(receipt.collectedBy)}</span></div>` : ""}
          </div>
          <script>window.onload = () => { window.print(); };</script>
        </body>
      </html>
    `);
    popup.document.close();
    popup.focus();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Fund Collection Receipt</DialogTitle></DialogHeader>
        {receipt ? (
          <div className="space-y-4">
            <div className="rounded-lg border p-4">
              {logoUrl ? <img src={logoUrl} alt="Receipt logo" className="mb-3 h-20 w-full rounded-md border object-contain p-2" /> : null}
              <div className="text-center">
                <p className="font-semibold">{receipt.organizationName}</p>
                <p className="text-sm text-muted-foreground">Project Fund Collection Receipt</p>
              </div>
              <div className="mt-4 space-y-2 text-sm">
                <ReceiptRow label="Receipt No" value={receipt.receiptNumber} />
                <ReceiptRow label="Date" value={dateTimeLabel(receipt.transactionDate)} />
                <ReceiptRow label="Fund" value={receipt.fundName} />
                <ReceiptRow label="Paid By" value={receipt.paidByName} />
                {receipt.paidByPhone ? <ReceiptRow label="Phone" value={receipt.paidByPhone} /> : null}
                <ReceiptRow label="Received Into" value={receipt.receivedInto || "Cash/Bank"} />
                {receipt.note ? <ReceiptRow label="Notes" value={receipt.note} /> : null}
                <ReceiptRow label="Amount" value={formatRs(receipt.amount)} strong />
              </div>
            </div>
            <Button className="w-full" onClick={printReceipt}>Print Receipt</Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Receipt details are loading.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReceiptRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t pt-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right ${strong ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}

function FundActivityTable({
  title,
  rows,
  onReceiptClick,
}: {
  title: string;
  rows: FundTransaction[];
  onReceiptClick?: (transactionId: string) => void;
}) {
  const showReceiptColumn = Boolean(onReceiptClick);
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
              {showReceiptColumn ? <th className="p-2 text-right font-medium">Receipt</th> : null}
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
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={showReceiptColumn ? 4 : 3} className="p-4 text-center text-muted-foreground">No records yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
