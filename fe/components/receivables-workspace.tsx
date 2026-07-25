"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDownCircle,
  ArrowLeft,
  ArrowUpCircle,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Plus,
  ReceiptText,
  Search,
  Undo2,
  Wallet,
} from "lucide-react";
import { AbstractBg } from "@/components/abstract-bg";
import { Breadcrumb } from "@/components/breadcrumb";
import { Header } from "@/components/header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { api, type AccountingAccount, type CashTransaction, type ReceivableDetail, type ReceivableOverview } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type Period = "this_month" | "this_year" | "all_time" | "custom";
type MemberLookup = {
  id: string;
  membershipNo: string;
  phoneNumber?: string | null;
  hod?: { fullName: string; nameWithInitials?: string | null } | null;
};

const periodLabels: Record<Period, string> = {
  this_month: "Current Month",
  this_year: "Current Financial Year",
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

function periodRange(period: Period) {
  if (period === "this_month") return { fromDate: firstOfMonthString(), toDate: todayString() };
  if (period === "this_year") return { fromDate: firstOfYearString(), toDate: todayString() };
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
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getFullYear()).slice(2)}`;
}

function isCashBank(account: AccountingAccount) {
  return account.accountType === "asset" && (account.assetSubtype === "cash" || account.assetSubtype === "bank") && account.isActive;
}

function defaultTransactionForm(cashBankAccountId = "") {
  return {
    amount: "",
    transactionDate: todayString(),
    counterpartyName: "",
    counterpartyPhone: "",
    counterpartyMembershipId: "",
    cashBankAccountId,
    reference: "",
    description: "",
  };
}

function pill(status: "active" | "closed") {
  return status === "active"
    ? "bg-emerald-100 text-emerald-700"
    : "bg-slate-100 text-slate-600";
}

export function ReceivablesWorkspace({ accountId }: { accountId?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const source = searchParams.get("source");
  const hideManagementActions = source === "cash-in";
  const { user, loading } = useAuth();
  const canManage = user?.role === "admin" || user?.role === "super_user";
  const [period, setPeriod] = useState<Period>("this_year");
  const [fromDate, setFromDate] = useState(firstOfYearString);
  const [toDate, setToDate] = useState(todayString);
  const [overview, setOverview] = useState<ReceivableOverview | null>(null);
  const [detail, setDetail] = useState<ReceivableDetail | null>(null);
  const [accounts, setAccounts] = useState<AccountingAccount[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [type, setType] = useState("all");
  const [sort, setSort] = useState("name_asc");
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [loadingData, setLoadingData] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [transactionMode, setTransactionMode] = useState<"given" | "repaid" | null>(null);
  const [reverseTarget, setReverseTarget] = useState<CashTransaction | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [memberOptions, setMemberOptions] = useState<MemberLookup[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [newAccount, setNewAccount] = useState({ name: "", counterpartyName: "", counterpartyPhone: "", counterpartyMembershipId: "", description: "" });
  const [txForm, setTxForm] = useState(defaultTransactionForm);

  const cashBankAccounts = useMemo(() => accounts.filter(isCashBank), [accounts]);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, router, user]);

  useEffect(() => {
    if (!user) return;
    void loadAccounts();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (accountId) void loadDetail();
    else void loadOverview();
  }, [user, accountId, fromDate, toDate, status, type, sort]);

  useEffect(() => {
    if (!user || accountId) return;
    const timer = setTimeout(() => void loadOverview(), 250);
    return () => clearTimeout(timer);
  }, [search]);

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

  async function loadAccounts() {
    try {
      const data = await api<AccountingAccount[]>("/accounting/accounts", { params: { includeInactive: "true" } });
      setAccounts(data);
      const firstCashBank = data.find(isCashBank);
      setTxForm((value) => ({ ...value, cashBankAccountId: value.cashBankAccountId || firstCashBank?.id || "" }));
    } catch {
      setAccounts([]);
    }
  }

  async function loadOverview() {
    setLoadingData(true);
    try {
      setOverview(await api<ReceivableOverview>("/accounting/receivables/overview", {
        params: { fromDate, toDate, q: search, status, type, sort },
      }));
    } catch (err) {
      toast({ variant: "destructive", title: "Unable to load receivables", description: err instanceof Error ? err.message : "Please try again" });
    } finally {
      setLoadingData(false);
    }
  }

  async function loadDetail() {
    if (!accountId) return;
    setLoadingData(true);
    try {
      setDetail(await api<ReceivableDetail>(`/accounting/receivables/${accountId}`, { params: { fromDate, toDate } }));
    } catch (err) {
      toast({ variant: "destructive", title: "Unable to load receivable", description: err instanceof Error ? err.message : "Please try again" });
    } finally {
      setLoadingData(false);
    }
  }

  function handlePeriodChange(value: string) {
    const next = value as Period;
    setPeriod(next);
    const range = periodRange(next);
    setFromDate(range.fromDate);
    setToDate(range.toDate);
  }

  function openTransaction(mode: "given" | "repaid") {
    const firstCashBank = cashBankAccounts[0]?.id || "";
    setTransactionMode(mode);
    setTxForm({ ...defaultTransactionForm(firstCashBank), counterpartyName: detail?.account.counterpartyName || "" });
    setMemberQuery("");
    setMemberOptions([]);
  }

  async function handleAddReceivable(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const account = await api<AccountingAccount>("/accounting/receivables", {
        method: "POST",
        body: JSON.stringify({
          name: newAccount.name,
          assetSubtype: "loan_receivable",
          counterpartyName: newAccount.counterpartyName || null,
          counterpartyPhone: newAccount.counterpartyPhone || null,
          counterpartyMembershipId: newAccount.counterpartyMembershipId || null,
          description: newAccount.description || null,
        }),
      });
      setAddOpen(false);
      setNewAccount({ name: "", counterpartyName: "", counterpartyPhone: "", counterpartyMembershipId: "", description: "" });
      toast({ title: "Receivable added", description: account.name });
      router.push(`/receivables/${account.id}`);
    } catch (err) {
      toast({ variant: "destructive", title: "Unable to add receivable", description: err instanceof Error ? err.message : "Please try again" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTransaction(event: FormEvent) {
    event.preventDefault();
    if (!detail || !transactionMode) return;
    setSubmitting(true);
    try {
      const endpoint = transactionMode === "given" ? "/accounting/cash-in/receivable-payments" : "/accounting/cash-in/receivable-collections";
      const saved = await api<CashTransaction>(endpoint, {
        method: "POST",
        body: JSON.stringify({
          accountId: detail.account.id,
          cashBankAccountId: txForm.cashBankAccountId,
          amount: Number(txForm.amount),
          transactionDate: txForm.transactionDate,
          counterpartyName: txForm.counterpartyName,
          counterpartyPhone: txForm.counterpartyPhone || null,
          counterpartyMembershipId: txForm.counterpartyMembershipId || null,
          reference: txForm.reference || null,
          description: txForm.description || null,
        }),
      });
      setTransactionMode(null);
      toast({ title: transactionMode === "given" ? "Amount due added" : "Repayment recorded", description: saved.documentNumber ?? saved.id });
      await loadDetail();
    } catch (err) {
      toast({ variant: "destructive", title: "Unable to save transaction", description: err instanceof Error ? err.message : "Please try again" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReverse(event: FormEvent) {
    event.preventDefault();
    if (!reverseTarget || !reverseReason.trim()) return;
    setSubmitting(true);
    try {
      await api(`/accounting/cash-transactions/${reverseTarget.id}/reverse`, {
        method: "POST",
        body: JSON.stringify({ reason: reverseReason.trim() }),
      });
      setReverseTarget(null);
      setReverseReason("");
      toast({ title: "Transaction reversed", description: reverseTarget.documentNumber ?? reverseTarget.id });
      await loadDetail();
    } catch (err) {
      toast({ variant: "destructive", title: "Unable to reverse transaction", description: err instanceof Error ? err.message : "Please try again" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCloseAccount() {
    if (!detail) return;
    const balance = detail.summary.outstandingBalance;
    const message = balance > 0
      ? `Close this account and write off ${formatRs(balance)} to Bad Debt Write-Off Expense?`
      : "Close this receivable account?";
    if (!window.confirm(message)) return;
    try {
      await api(`/accounting/receivables/${detail.account.id}/close`, { method: "POST" });
      toast({ title: "Receivable closed", description: detail.account.name });
      await loadDetail();
    } catch (err) {
      toast({ variant: "destructive", title: "Unable to close receivable", description: err instanceof Error ? err.message : "Please try again" });
    }
  }

  if (loading || !user) return null;

  return (
    <div className="min-h-screen bg-background relative">
      <AbstractBg />
      <Header />
      <main className="relative z-10 mx-auto max-w-7xl space-y-6 p-4 md:p-6">
        <Breadcrumb items={[
          { label: "Dashboard", href: "/" },
          { label: "Receivables", href: "/receivables" },
          ...(detail ? [{ label: detail.account.name }] : []),
        ]} />

        {detail ? (
          <ReceivableDetailView
            detail={detail}
            period={period}
            fromDate={fromDate}
            toDate={toDate}
            loadingData={loadingData}
            canManage={canManage}
            hideManagementActions={hideManagementActions}
            expandedRows={expandedRows}
            onPeriodChange={handlePeriodChange}
            setFromDate={setFromDate}
            setToDate={setToDate}
            setExpandedRows={setExpandedRows}
            onBack={() => router.push(source === "cash-in" ? "/cash-in" : "/receivables")}
            onGiven={() => openTransaction("given")}
            onRepaid={() => openTransaction("repaid")}
            onClose={handleCloseAccount}
            onReverse={(tx) => setReverseTarget(tx)}
          />
        ) : (
          <ReceivableDashboard
            overview={overview}
            period={period}
            fromDate={fromDate}
            toDate={toDate}
            search={search}
            type={type}
            status={status}
            sort={sort}
            loadingData={loadingData}
            expandedRows={expandedRows}
            canManage={canManage}
            onPeriodChange={handlePeriodChange}
            setFromDate={setFromDate}
            setToDate={setToDate}
            setSearch={setSearch}
            setType={setType}
            setStatus={setStatus}
            setSort={setSort}
            setExpandedRows={setExpandedRows}
            onOpen={(id) => router.push(`/receivables/${id}`)}
            onAdd={() => setAddOpen(true)}
          />
        )}
      </main>

      <AddReceivableDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        value={newAccount}
        setValue={setNewAccount}
        memberQuery={memberQuery}
        setMemberQuery={setMemberQuery}
        memberOptions={memberOptions}
        setMemberOptions={setMemberOptions}
        submitting={submitting}
        onSubmit={handleAddReceivable}
      />

      <TransactionDialog
        open={!!transactionMode}
        mode={transactionMode}
        accountName={detail?.account.name}
        form={txForm}
        setForm={setTxForm}
        cashBankAccounts={cashBankAccounts}
        memberQuery={memberQuery}
        setMemberQuery={setMemberQuery}
        memberOptions={memberOptions}
        setMemberOptions={setMemberOptions}
        submitting={submitting}
        onOpenChange={(open) => !open && setTransactionMode(null)}
        onSubmit={handleTransaction}
      />

      <Dialog open={!!reverseTarget} onOpenChange={(open) => !open && setReverseTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Reverse Entry</DialogTitle></DialogHeader>
          {reverseTarget ? (
            <form onSubmit={handleReverse} className="space-y-4">
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <div><span className="text-muted-foreground">Transaction:</span> {reverseTarget.transactionLabel}</div>
                <div><span className="text-muted-foreground">Date:</span> {dateLabel(reverseTarget.transactionDate)}</div>
                <div><span className="text-muted-foreground">Amount:</span> {formatRs(reverseTarget.amount)}</div>
              </div>
              <div>
                <Label>Reason for Reversal</Label>
                <Textarea value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} placeholder="Wrong amount, wrong account..." required />
              </div>
              <p className="text-xs text-muted-foreground">This action is recorded in the audit trail and cannot be undone.</p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setReverseTarget(null)}>Cancel</Button>
                <Button type="submit" disabled={submitting || !reverseReason.trim()}>Confirm Reversal</Button>
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReceivableDashboard(props: {
  overview: ReceivableOverview | null;
  period: Period;
  fromDate: string;
  toDate: string;
  search: string;
  type: string;
  status: string;
  sort: string;
  loadingData: boolean;
  expandedRows: Record<string, boolean>;
  canManage: boolean;
  onPeriodChange: (value: string) => void;
  setFromDate: (value: string) => void;
  setToDate: (value: string) => void;
  setSearch: (value: string) => void;
  setType: (value: string) => void;
  setStatus: (value: string) => void;
  setSort: (value: string) => void;
  setExpandedRows: (value: Record<string, boolean>) => void;
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  const rows = props.overview?.rows ?? [];
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Receivables</h1>
          <p className="mt-1 text-sm text-muted-foreground">View and manage all receivable accounts.</p>
          <div className="mt-3 rounded-md border border-blue-100 bg-blue-50/70 p-3 text-sm text-blue-950">
            <div className="font-semibold">Receivable (Money to Collect)</div>
            <div>Money that other people or organisations owe to your organisation</div>
          </div>
        </div>
        <Button onClick={props.onAdd} disabled={!props.canManage}>
          <Plus className="mr-2 h-4 w-4" />
          Add New Receivable
        </Button>
      </div>

      <PeriodControls period={props.period} fromDate={props.fromDate} toDate={props.toDate} onPeriodChange={props.onPeriodChange} setFromDate={props.setFromDate} setToDate={props.setToDate} />

      <div className="grid gap-3 md:grid-cols-4">
        <Metric icon={Wallet} label="Total Opening" value={formatRs(props.overview?.totals.openingBalance ?? 0)} />
        <Metric icon={ArrowUpCircle} label="Total Given" value={formatRs(props.overview?.totals.totalGiven ?? 0)} />
        <Metric icon={ArrowDownCircle} label="Total Repaid" value={formatRs(props.overview?.totals.totalRepaid ?? 0)} />
        <Metric icon={ReceiptText} label="Total Outstanding" value={formatRs(props.overview?.totals.outstandingBalance ?? 0)} />
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" value={props.search} onChange={(e) => props.setSearch(e.target.value)} placeholder="Search accounts..." />
          </div>
          <Select value={props.type} onValueChange={props.setType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="loan_receivable">Loan</SelectItem>
            </SelectContent>
          </Select>
          <Select value={props.status} onValueChange={props.setStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active only</SelectItem>
              <SelectItem value="closed">Closed only</SelectItem>
              <SelectItem value="all">All Status</SelectItem>
            </SelectContent>
          </Select>
          <Select value={props.sort} onValueChange={props.setSort}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="name_asc">Account Name (A-Z)</SelectItem>
              <SelectItem value="outstanding_desc">Outstanding (High-Low)</SelectItem>
              <SelectItem value="given_desc">Given (High-Low)</SelectItem>
              <SelectItem value="repaid_desc">Repaid (High-Low)</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="hidden md:block">
        <CardContent className="p-0">
          <div className="grid grid-cols-[1.4fr_.8fr_1fr_1fr_1fr_1fr_.7fr_40px] gap-3 border-b px-5 py-3 text-xs font-medium text-muted-foreground">
            <div>Account Name</div><div>Account Type</div><div>Opening Balance</div><div>Total Given</div><div>Total Repaid</div><div>Outstanding Balance</div><div>Status</div><div />
          </div>
          {props.loadingData ? <div className="m-5 h-20 rounded-md bg-muted animate-pulse" /> : null}
          {!props.loadingData && rows.length === 0 ? <p className="p-5 text-sm text-muted-foreground">No receivable accounts found.</p> : null}
          {rows.map((row) => (
            <button key={row.id} type="button" onClick={() => props.onOpen(row.id)} className="grid w-full grid-cols-[1.4fr_.8fr_1fr_1fr_1fr_1fr_.7fr_40px] gap-3 border-b px-5 py-4 text-left text-sm transition hover:bg-muted/50 last:border-0">
              <div className="font-semibold text-foreground">{row.name}</div>
              <div><span className="rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700">{row.accountType}</span></div>
              <div>{formatRs(row.openingBalance)}</div>
              <div className="font-semibold text-emerald-700">{formatRs(row.totalGiven)}</div>
              <div className="font-semibold text-indigo-700">{formatRs(row.totalRepaid)}</div>
              <div className="font-semibold text-orange-700">{formatRs(row.outstandingBalance)}</div>
              <div><span className={`rounded px-2 py-1 text-xs capitalize ${pill(row.status)}`}>{row.status}</span></div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
        </CardContent>
      </Card>

      <div className="space-y-3 md:hidden">
        {rows.map((row) => {
          const open = props.expandedRows[row.id];
          return (
            <Card key={row.id}>
              <button type="button" onClick={() => props.onOpen(row.id)} className="flex w-full items-center justify-between gap-3 p-4 text-left">
                <div>
                  <div className="font-semibold">{row.name}</div>
                  <div className="text-xs text-muted-foreground">{row.accountType}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Outstanding</div>
                  <div className="font-semibold text-orange-700">{formatRs(row.outstandingBalance)}</div>
                </div>
              </button>
              <button type="button" onClick={() => props.setExpandedRows({ ...props.expandedRows, [row.id]: !open })} className="flex w-full items-center justify-center border-t py-2 text-xs text-muted-foreground">
                <ChevronDown className={`mr-1 h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
                Breakdown
              </button>
              {open ? (
                <div className="grid grid-cols-2 gap-2 border-t p-4 text-sm">
                  <Mini label="Opening" value={formatRs(row.openingBalance)} />
                  <Mini label="Given" value={formatRs(row.totalGiven)} />
                  <Mini label="Repaid" value={formatRs(row.totalRepaid)} />
                  <Mini label="Status" value={row.status} />
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ReceivableDetailView(props: {
  detail: ReceivableDetail;
  period: Period;
  fromDate: string;
  toDate: string;
  loadingData: boolean;
  canManage: boolean;
  hideManagementActions: boolean;
  expandedRows: Record<string, boolean>;
  onPeriodChange: (value: string) => void;
  setFromDate: (value: string) => void;
  setToDate: (value: string) => void;
  setExpandedRows: (value: Record<string, boolean>) => void;
  onBack: () => void;
  onGiven: () => void;
  onRepaid: () => void;
  onClose: () => void;
  onReverse: (tx: CashTransaction) => void;
}) {
  const account = props.detail.account;
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <Button variant="ghost" size="sm" onClick={props.onBack} className="-ml-2 mb-2">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <h1 className="text-2xl font-semibold text-foreground">{account.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>Account Type: {account.accountTypeLabel ?? "Loan"}</span>
            <span className={`rounded px-2 py-1 text-xs capitalize ${pill(account.status ?? "active")}`}>{account.status ?? "active"}</span>
          </div>
        </div>
        <PeriodControls period={props.period} fromDate={props.fromDate} toDate={props.toDate} onPeriodChange={props.onPeriodChange} setFromDate={props.setFromDate} setToDate={props.setToDate} compact />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Metric icon={ArrowUpCircle} label="Total Given" value={formatRs(props.detail.summary.totalGiven)} />
        <Metric icon={ArrowDownCircle} label="Total Repaid" value={formatRs(props.detail.summary.totalRepaid)} />
        <Metric icon={ReceiptText} label="Outstanding Balance" value={formatRs(props.detail.summary.outstandingBalance)} />
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        {!props.hideManagementActions ? <Button variant="outline" onClick={props.onGiven} disabled={!props.canManage}>Add Amount Due (Cash Out)</Button> : null}
        <Button onClick={props.onRepaid} disabled={!props.canManage}>Record Repayment (Cash In)</Button>
        {!props.hideManagementActions ? <Button variant="outline" onClick={props.onClose} disabled={!props.canManage || account.status === "closed"}>Close Account</Button> : null}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="border-b p-4">
            <h2 className="font-semibold">Transaction History</h2>
          </div>
          {props.loadingData ? <div className="m-5 h-20 rounded-md bg-muted animate-pulse" /> : null}
          {!props.loadingData && props.detail.history.length === 0 ? <p className="p-5 text-sm text-muted-foreground">No transactions recorded yet.</p> : null}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr><th className="p-3">Date</th><th className="p-3">Transaction</th><th className="p-3">Payment Method</th><th className="p-3 text-right">Amount</th><th className="p-3 text-right">Balance</th><th className="p-3">Status</th><th className="p-3 text-right">Action</th></tr>
              </thead>
              <tbody>
                {props.detail.history.map((tx) => (
                  <HistoryRows
                    key={tx.id}
                    tx={tx}
                    canManage={props.canManage}
                    expanded={!!props.expandedRows[tx.id]}
                    onToggle={() => props.setExpandedRows({ ...props.expandedRows, [tx.id]: !props.expandedRows[tx.id] })}
                    onReverse={props.onReverse}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-2 p-3 md:hidden">
            {props.detail.history.map((tx) => {
              const open = props.expandedRows[tx.id];
              return (
                <Card key={tx.id}>
                  <button
                    type="button"
                    onClick={() => tx.reversedAt ? props.setExpandedRows({ ...props.expandedRows, [tx.id]: !open }) : undefined}
                    className="w-full p-3 text-left"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold">{tx.transactionLabel}</div>
                        <div className="text-xs text-muted-foreground">{tx.description}</div>
                      </div>
                      <div className="text-right font-semibold">{formatRs(tx.amount)}</div>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                      <span>{dateLabel(tx.transactionDate)}</span>
                      <span>{tx.paymentMethod ?? "-"}</span>
                      <span className="text-right">{formatRs(tx.balance ?? 0)}</span>
                    </div>
                  </button>
                  <div className="flex items-center justify-between border-t px-3 py-2 text-xs">
                    <span className={tx.reversedAt ? "text-destructive" : "text-emerald-700"}>{tx.reversedAt ? "Reversed" : "Posted"}</span>
                    {tx.reversedAt ? (
                      <Button size="sm" variant="outline" onClick={() => props.setExpandedRows({ ...props.expandedRows, [tx.id]: !open })}>
                        View details
                        <ChevronDown className={`ml-2 h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
                      </Button>
                    ) : props.canManage ? (
                      <Button size="sm" variant="outline" onClick={() => props.onReverse(tx)}>
                        <Undo2 className="mr-2 h-4 w-4" />
                        Reverse
                      </Button>
                    ) : null}
                  </div>
                  {open && tx.reversedAt ? <HistoryDetail tx={tx} /> : null}
                </Card>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function HistoryRows({
  tx,
  canManage,
  expanded,
  onToggle,
  onReverse,
}: {
  tx: CashTransaction;
  canManage: boolean;
  expanded: boolean;
  onToggle: () => void;
  onReverse: (tx: CashTransaction) => void;
}) {
  return (
    <>
      <tr className="border-b">
        <td className="p-3 whitespace-nowrap">{dateLabel(tx.transactionDate)}</td>
        <td className="p-3">
          <div className="font-semibold">{tx.transactionLabel}</div>
          <div className="text-xs text-muted-foreground">{tx.description || tx.counterpartyName || "-"}</div>
        </td>
        <td className="p-3">{tx.paymentMethod ?? tx.cashBankAccount?.name ?? "-"}</td>
        <td className="p-3 text-right font-semibold">{formatRs(tx.amount)}</td>
        <td className="p-3 text-right font-semibold">{formatRs(tx.balance ?? 0)}</td>
        <td className="p-3"><span className={tx.reversedAt ? "text-destructive" : "text-emerald-700"}>{tx.reversedAt ? "Reversed" : "Posted"}</span></td>
        <td className="p-3 text-right">
          {tx.reversedAt ? (
            <Button size="sm" variant="outline" onClick={onToggle}>
              View details
              <ChevronDown className={`ml-2 h-4 w-4 transition ${expanded ? "rotate-180" : ""}`} />
            </Button>
          ) : canManage ? (
            <Button size="sm" variant="outline" onClick={() => onReverse(tx)}><Undo2 className="mr-2 h-4 w-4" />Reverse</Button>
          ) : null}
        </td>
      </tr>
      {tx.reversedAt && expanded ? (
        <tr className="border-b bg-destructive/5">
          <td colSpan={7} className="p-3">
            <HistoryMeta tx={tx} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function HistoryDetail({ tx }: { tx: CashTransaction }) {
  return (
    <div className="border-t bg-destructive/5 p-3">
      <HistoryMeta tx={tx} />
    </div>
  );
}

function HistoryMeta({ tx }: { tx: CashTransaction }) {
  return (
    <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-6">
      <Mini label="Actioned by" value={tx.createdBy?.email ?? "-"} />
      <Mini label="Receipt no" value={tx.documentNumber ?? "-"} />
      <Mini label="Reversal reason" value={tx.reversalReason ?? "-"} />
      <Mini label="Reversed on" value={dateLabel(tx.reversedAt)} />
      <Mini label="Reversed by" value={tx.reversedBy?.email ?? "-"} />
      <Mini label="Linked reversal receipt" value={tx.reversalDocumentNumber ?? "-"} />
    </div>
  );
}

function PeriodControls(props: { period: Period; fromDate: string; toDate: string; compact?: boolean; onPeriodChange: (value: string) => void; setFromDate: (value: string) => void; setToDate: (value: string) => void }) {
  return (
    <div className={`flex flex-wrap items-end gap-2 ${props.compact ? "md:justify-end" : ""}`}>
      <div className="w-56">
        <Label className="text-xs">Period</Label>
        <Select value={props.period} onValueChange={props.onPeriodChange}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{Object.entries(periodLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {props.period === "custom" ? (
        <>
          <div className="w-40"><Label className="text-xs">From</Label><Input type="date" value={props.fromDate} onChange={(e) => props.setFromDate(e.target.value)} /></div>
          <div className="w-40"><Label className="text-xs">To</Label><Input type="date" value={props.toDate} onChange={(e) => props.setToDate(e.target.value)} /></div>
        </>
      ) : null}
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

function Mini({ label, value }: { label: string; value: string }) {
  return <div><div className="text-muted-foreground">{label}</div><div className="font-medium text-foreground">{value}</div></div>;
}

function AddReceivableDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: { name: string; counterpartyName: string; counterpartyPhone: string; counterpartyMembershipId: string; description: string };
  setValue: (value: { name: string; counterpartyName: string; counterpartyPhone: string; counterpartyMembershipId: string; description: string }) => void;
  memberQuery: string;
  setMemberQuery: (value: string) => void;
  memberOptions: MemberLookup[];
  setMemberOptions: (value: MemberLookup[]) => void;
  submitting: boolean;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Add New Receivable</DialogTitle></DialogHeader>
        <form onSubmit={props.onSubmit} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div><Label>Receivable Name</Label><Input value={props.value.name} onChange={(e) => props.setValue({ ...props.value, name: e.target.value })} required placeholder="Ahmed Loan" /></div>
            <div><Label>Type</Label><Select value="loan_receivable"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="loan_receivable">Loan Receivable</SelectItem></SelectContent></Select></div>
            <div><Label>Who owes the money?</Label><Input value={props.value.counterpartyName} onChange={(e) => props.setValue({ ...props.value, counterpartyName: e.target.value, counterpartyMembershipId: "" })} placeholder="Member, staff, or organisation" /></div>
            <div>
              <Label>Member/Staff Search</Label>
              <MemberLookupBox
                query={props.memberQuery}
                setQuery={props.setMemberQuery}
                options={props.memberOptions}
                setOptions={props.setMemberOptions}
                onSelect={(member, name) => props.setValue({ ...props.value, counterpartyName: name, counterpartyPhone: member.phoneNumber || props.value.counterpartyPhone, counterpartyMembershipId: member.id })}
              />
            </div>
            <div><Label>Phone Number</Label><Input value={props.value.counterpartyPhone} onChange={(e) => props.setValue({ ...props.value, counterpartyPhone: e.target.value })} /></div>
          </div>
          <div><Label>Description</Label><Textarea value={props.value.description} onChange={(e) => props.setValue({ ...props.value, description: e.target.value })} /></div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={props.submitting}>{props.submitting ? "Saving..." : "Add New Receivable"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TransactionDialog(props: {
  open: boolean;
  mode: "given" | "repaid" | null;
  accountName?: string;
  form: ReturnType<typeof defaultTransactionForm>;
  setForm: (value: ReturnType<typeof defaultTransactionForm>) => void;
  cashBankAccounts: AccountingAccount[];
  memberQuery: string;
  setMemberQuery: (value: string) => void;
  memberOptions: MemberLookup[];
  setMemberOptions: (value: MemberLookup[]) => void;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const title = props.mode === "given" ? "Add Amount Due (Cash Out)" : "Record Repayment (Cash In)";
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{title}{props.accountName ? ` - ${props.accountName}` : ""}</DialogTitle></DialogHeader>
        <form onSubmit={props.onSubmit} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div><Label>Date</Label><Input type="date" value={props.form.transactionDate} onChange={(e) => props.setForm({ ...props.form, transactionDate: e.target.value })} required /></div>
            <div><Label>Amount</Label><Input type="number" min="0" step="0.01" value={props.form.amount} onChange={(e) => props.setForm({ ...props.form, amount: e.target.value })} required /></div>
            <div><Label>{props.mode === "given" ? "Paid To" : "Received From"}</Label><Input value={props.form.counterpartyName} onChange={(e) => props.setForm({ ...props.form, counterpartyName: e.target.value, counterpartyMembershipId: "" })} required /></div>
            <div>
              <Label>Member Search</Label>
              <MemberLookupBox
                query={props.memberQuery}
                setQuery={props.setMemberQuery}
                options={props.memberOptions}
                setOptions={props.setMemberOptions}
                onSelect={(member, name) => props.setForm({ ...props.form, counterpartyName: name, counterpartyPhone: member.phoneNumber || props.form.counterpartyPhone, counterpartyMembershipId: member.id })}
              />
            </div>
            <div><Label>Payment Method</Label><Select value={props.form.cashBankAccountId} onValueChange={(value) => props.setForm({ ...props.form, cashBankAccountId: value })}><SelectTrigger><SelectValue placeholder="Select cash/bank account" /></SelectTrigger><SelectContent>{props.cashBankAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Phone Number</Label><Input value={props.form.counterpartyPhone} onChange={(e) => props.setForm({ ...props.form, counterpartyPhone: e.target.value })} /></div>
            <div><Label>Reference</Label><Input value={props.form.reference} onChange={(e) => props.setForm({ ...props.form, reference: e.target.value })} /></div>
          </div>
          <div><Label>Description</Label><Textarea value={props.form.description} onChange={(e) => props.setForm({ ...props.form, description: e.target.value })} /></div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={props.submitting}>{props.submitting ? "Saving..." : title}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MemberLookupBox(props: {
  query: string;
  setQuery: (value: string) => void;
  options: MemberLookup[];
  setOptions: (value: MemberLookup[]) => void;
  onSelect: (member: MemberLookup, name: string) => void;
}) {
  return (
    <div>
      <Input value={props.query} onChange={(e) => props.setQuery(e.target.value)} placeholder="Search by name or membership no" />
      {props.options.length > 0 ? (
        <div className="mt-1 max-h-36 overflow-auto rounded-md border bg-popover p-1">
          {props.options.map((member) => {
            const name = member.hod?.nameWithInitials || member.hod?.fullName || member.membershipNo;
            return (
              <button
                type="button"
                key={member.id}
                className="w-full rounded px-2 py-1 text-left text-sm hover:bg-accent"
                onClick={() => {
                  props.onSelect(member, name);
                  props.setQuery(`${member.membershipNo} - ${name}`);
                  props.setOptions([]);
                }}
              >
                {member.membershipNo} - {name}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
