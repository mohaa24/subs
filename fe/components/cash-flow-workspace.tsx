"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDownCircle,
  ArrowLeft,
  ArrowUpCircle,
  CalendarDays,
  ChevronRight,
  Landmark,
  ReceiptText,
  Search,
  Undo2,
  WalletCards,
} from "lucide-react";
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
import {
  api,
  type AccountingAccount,
  type CashAccountDetail,
  type CashFlowAccountRow,
  type CashFlowOverview,
  type CashTransaction,
  type CashTransactionCategory,
} from "@/lib/api";
import { dashboardFlowHref } from "@/lib/dashboard-flows";
import { toast } from "@/hooks/use-toast";

type CashFlowSlug = "cash-in" | "cash-out";
type CashPeriod = "this_month" | "this_year" | "all_time" | "custom";
type RecordTarget = {
  row: CashFlowAccountRow;
  category: CashTransactionCategory | null;
  sectionKey?: string;
};

type MemberLookup = {
  id: string;
  membershipNo: string;
  phoneNumber?: string | null;
  hod?: { fullName: string; nameWithInitials?: string | null } | null;
};

const periodLabels: Record<CashPeriod, string> = {
  this_month: "Current Month",
  this_year: "Current Financial Year",
  all_time: "All Time",
  custom: "Custom",
};

const sectionCategories: Record<string, CashTransactionCategory | null> = {
  operating_income: "operating_income",
  receivable_collection: "receivable_collection",
  operating_expense: "operating_expense",
  payable_payment: "payable_payment",
  project_fund_collection: null,
  project_fund_expense: null,
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

function periodRange(period: CashPeriod) {
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
  if (!value) return "No activity";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function flowConfig(flow: CashFlowSlug) {
  const isCashIn = flow === "cash-in";
  return {
    flow,
    title: isCashIn ? "Cash In" : "Cash Out",
    description: isCashIn ? "Record incoming cash against income, project funds, and receivables." : "Record outgoing cash against expenses, project funds, and payables.",
    icon: isCashIn ? ArrowDownCircle : ArrowUpCircle,
    actionLabel: isCashIn ? "Record Income" : "Record Expense",
    balanceActionLabel: isCashIn ? "Add Collection" : "Make Payment",
    documentLabel: isCashIn ? "Receipt Number" : "Payment Voucher Number",
    counterpartyLabel: isCashIn ? "Received From" : "Paid To",
    overviewPath: isCashIn ? "/accounting/cash-in/overview" : "/accounting/cash-out/overview",
    detailPath: (id: string) => isCashIn ? `/accounting/cash-in/accounts/${id}` : `/accounting/cash-out/accounts/${id}`,
    dashboardFlow: isCashIn ? "cash-in" as const : "cash-out" as const,
  };
}

function endpointFor(flow: CashFlowSlug, category: CashTransactionCategory) {
  if (flow === "cash-in" && category === "operating_income") return "/accounting/cash-in/operating-income";
  if (flow === "cash-in" && category === "receivable_payment") return "/accounting/cash-in/receivable-payments";
  if (flow === "cash-in" && category === "receivable_collection") return "/accounting/cash-in/receivable-collections";
  if (flow === "cash-out" && category === "operating_expense") return "/accounting/cash-out/operating-expenses";
  if (flow === "cash-out" && category === "payable_recovery") return "/accounting/cash-out/payable-recoveries";
  return "/accounting/cash-out/payable-payments";
}

function isCashBankSubtype(subtype?: string | null) {
  return subtype === "cash" || subtype === "bank";
}

function isReceivableSubtype(subtype?: string | null) {
  return subtype === "loan_receivable" || subtype === "service_receivable";
}

function isPayableSubtype(subtype?: string | null) {
  return subtype === "loan_payable" || subtype === "service_payable";
}

function subtypeLabel(subtype?: string | null) {
  return subtype ? subtype.replace(/_/g, " ") : "";
}

function buttonLabel(flow: CashFlowSlug, sectionKey?: string) {
  if (sectionKey === "receivable_collection") return "Add Collection";
  if (sectionKey === "payable_payment") return "Make Payment";
  return flow === "cash-in" ? "Record Income" : "Record Expense";
}

function actionLabel(flow: CashFlowSlug, category?: CashTransactionCategory | null, sectionKey?: string) {
  if (category === "receivable_payment") return "Record Payment";
  if (category === "receivable_collection") return "Add Collection";
  if (category === "payable_recovery") return "Recover";
  if (category === "payable_payment") return "Make Payment";
  return buttonLabel(flow, sectionKey);
}

function actionCounterpartyLabel(flow: CashFlowSlug, category?: CashTransactionCategory | null) {
  if (category === "receivable_payment" || category === "payable_payment") return "Paid To";
  if (category === "receivable_collection" || category === "payable_recovery") return "Received From";
  return flow === "cash-in" ? "Received From" : "Paid To";
}

function actionDocumentLabel(flow: CashFlowSlug, category?: CashTransactionCategory | null) {
  if (category === "receivable_payment" || category === "payable_payment") return "Payment Voucher Number";
  if (category === "receivable_collection" || category === "payable_recovery") return "Receipt Number";
  return flow === "cash-in" ? "Receipt Number" : "Payment Voucher Number";
}

function defaultForm(cashBankAccountId = "") {
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

export function CashFlowWorkspace({ flow, accountId }: { flow: CashFlowSlug; accountId?: string }) {
  const config = flowConfig(flow);
  const { user, loading } = useAuth();
  const router = useRouter();
  const canManage = user?.role === "admin" || user?.role === "super_user";
  const [overview, setOverview] = useState<CashFlowOverview | null>(null);
  const [detail, setDetail] = useState<CashAccountDetail | null>(null);
  const [accounts, setAccounts] = useState<AccountingAccount[]>([]);
  const [period, setPeriod] = useState<CashPeriod>("this_year");
  const [fromDate, setFromDate] = useState(firstOfYearString);
  const [toDate, setToDate] = useState(todayString);
  const [search, setSearch] = useState("");
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<RecordTarget | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [submitting, setSubmitting] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberOptions, setMemberOptions] = useState<MemberLookup[]>([]);
  const Icon = config.icon;

  const cashBankAccounts = useMemo(
    () => accounts.filter((account) => account.accountType === "asset" && isCashBankSubtype(account.assetSubtype) && account.isActive),
    [accounts],
  );

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
  }, [user, accountId, fromDate, toDate]);

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
      const firstCashBank = data.find((account) => account.accountType === "asset" && isCashBankSubtype(account.assetSubtype) && account.isActive);
      setForm((v) => ({ ...v, cashBankAccountId: v.cashBankAccountId || firstCashBank?.id || "" }));
    } catch {
      setAccounts([]);
    }
  }

  function params() {
    const next: Record<string, string> = { fromDate, toDate };
    if (search.trim()) next.q = search.trim();
    return next;
  }

  async function loadOverview() {
    setLoadingData(true);
    setError("");
    try {
      setOverview(await api<CashFlowOverview>(config.overviewPath, { params: params() }));
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to load ${config.title}`);
    } finally {
      setLoadingData(false);
    }
  }

  async function loadDetail() {
    if (!accountId) return;
    setLoadingData(true);
    setError("");
    try {
      setDetail(await api<CashAccountDetail>(config.detailPath(accountId), { params: { fromDate, toDate } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load account");
    } finally {
      setLoadingData(false);
    }
  }

  function handlePeriodChange(value: string) {
    const next = value as CashPeriod;
    setPeriod(next);
    const range = periodRange(next);
    setFromDate(range.fromDate);
    setToDate(range.toDate);
  }

  function openRecord(row: CashFlowAccountRow, category: CashTransactionCategory, sectionKey?: string) {
    setSelected({ row, category, sectionKey });
    setForm(defaultForm(cashBankAccounts[0]?.id || ""));
    setMemberQuery("");
    setMemberOptions([]);
  }

  function openFundRecord(row: CashFlowAccountRow, sectionKey?: string) {
    setSelected({ row, category: null, sectionKey });
    setForm(defaultForm(cashBankAccounts[0]?.id || ""));
    setMemberQuery("");
    setMemberOptions([]);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    try {
      const transaction: { id: string; documentNumber?: string | null; receiptNumber?: string | null } = selected.category
        ? await api<CashTransaction>(endpointFor(flow, selected.category), {
        method: "POST",
        body: JSON.stringify({
          accountId: selected.row.id,
          cashBankAccountId: form.cashBankAccountId,
          amount: Number(form.amount),
          transactionDate: form.transactionDate,
          counterpartyName: form.counterpartyName,
          counterpartyPhone: form.counterpartyPhone || null,
          counterpartyMembershipId: form.counterpartyMembershipId || null,
          reference: form.reference || null,
          description: form.description || null,
        }),
        })
        : await api<{ id: string; receiptNumber?: string | null }>(`/accounting/funds/${selected.row.id}/${flow === "cash-in" ? "collections" : "expenses"}`, {
          method: "POST",
          body: JSON.stringify(flow === "cash-in"
            ? {
                amount: Number(form.amount),
                transactionDate: form.transactionDate,
                assetAccountId: form.cashBankAccountId,
                paidByName: form.counterpartyName,
                paidByPhone: form.counterpartyPhone || null,
                paidByMembershipId: form.counterpartyMembershipId || null,
                memo: form.description || form.reference || null,
              }
            : {
                amount: Number(form.amount),
                transactionDate: form.transactionDate,
                assetAccountId: form.cashBankAccountId,
                description: form.counterpartyName,
                memo: [form.reference, form.description].filter(Boolean).join(" - ") || null,
              }),
        });
      setSelected(null);
      toast({
        title: flow === "cash-in" ? "Cash in recorded" : "Cash out recorded",
        description: `${actionDocumentLabel(flow, selected.category)}: ${transaction.documentNumber ?? transaction.receiptNumber ?? transaction.id}`,
      });
      if (accountId) await loadDetail();
      else await loadOverview();
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to record transaction", description: err instanceof Error ? err.message : "Unable to save" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReverse(transaction: CashTransaction) {
    const reason = window.prompt("Reason for reversal");
    if (!reason?.trim()) return;
    try {
      await api(`/accounting/cash-transactions/${transaction.id}/reverse`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      toast({ title: "Transaction reversed", description: transaction.documentNumber ?? transaction.id });
      await loadDetail();
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to reverse transaction", description: err instanceof Error ? err.message : "Unable to reverse" });
    }
  }

  if (loading || !user) return null;

  const selectedAction = selected ? actionLabel(flow, selected.category, selected.sectionKey) : config.actionLabel;
  const selectedCounterpartyLabel = selected ? actionCounterpartyLabel(flow, selected.category) : config.counterpartyLabel;

  return (
    <div className="min-h-screen bg-background relative">
      <AbstractBg />
      <Header />
      <main className="relative z-10 p-6 max-w-7xl mx-auto space-y-6">
        <Breadcrumb items={[
          { label: "Dashboard", href: dashboardFlowHref(config.dashboardFlow) },
          { label: config.title, href: `/${flow}` },
          ...(detail ? [{ label: detail.account.name }] : []),
        ]} />

        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              {detail ? (
                <Button variant="ghost" size="sm" onClick={() => router.push(`/${flow}`)}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </Button>
              ) : null}
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <h1 className="text-xl font-semibold text-foreground">{detail?.account.name ?? config.title}</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{detail ? config.description : config.description}</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-56">
              <Label className="text-xs">Period</Label>
              <Select value={period} onValueChange={handlePeriodChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(periodLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {period === "custom" ? (
              <>
                <div className="w-40">
                  <Label className="text-xs">From</Label>
                  <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                </div>
                <div className="w-40">
                  <Label className="text-xs">To</Label>
                  <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                </div>
              </>
            ) : null}
          </div>
        </div>

        {error ? <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}

        {detail ? (
          <AccountDetailView
            flow={flow}
            config={config}
            detail={detail}
            canManage={canManage}
            loadingData={loadingData}
            onRecord={(category) => openRecord(
              { ...detail.account, periodTotal: detail.summary.periodTotal ?? 0, thisMonthTotal: 0 },
              category ?? (isReceivableSubtype(detail.account.assetSubtype) ? "receivable_collection" : isPayableSubtype(detail.account.assetSubtype) ? "payable_payment" : flow === "cash-in" ? "operating_income" : "operating_expense")
            )}
            onReverse={handleReverse}
          />
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <MetricCard icon={ReceiptText} label={flow === "cash-in" ? "Total Cash In" : "Total Cash Out"} value={formatRs(overview?.totals.periodTotal ?? 0)} />
              <MetricCard icon={WalletCards} label="Accounts / Funds" value={String(overview?.totals.accountCount ?? 0)} />
              <MetricCard icon={CalendarDays} label="Period" value={`${dateLabel(fromDate)} - ${dateLabel(toDate)}`} />
            </div>

            <Card>
              <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end">
                <div className="flex-1">
                  <Label className="text-xs">Search</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={flow === "cash-in" ? "Search income account, receivable, or fund" : "Search expense account, payable, or fund"} />
                  </div>
                </div>
                <Button variant="outline" onClick={() => { setSearch(""); void loadOverview(); }}>Clear</Button>
              </CardContent>
            </Card>

            <div className="space-y-4">
              {overview?.sections.map((section) => (
                <Card key={section.key}>
                  <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Landmark className="h-5 w-5 text-muted-foreground" />
                      {section.title}
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">{section.rows.length}</span>
                    </CardTitle>
                    <div className="text-sm font-semibold text-primary">Total: {formatRs(section.total)}</div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {loadingData ? <div className="h-20 rounded-md bg-muted animate-pulse" /> : null}
                    {!loadingData && section.rows.length === 0 ? (
                      <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No accounts found.</p>
                    ) : null}
                    {section.rows.map((row) => {
                      const category = sectionCategories[section.key];
                      const isFund = !category;
                      return (
                        <div key={row.id} className="grid gap-3 rounded-md border bg-card p-3 md:grid-cols-[1.5fr_1fr_1fr_auto_auto] md:items-center">
                          <div>
                            <div className="font-medium text-foreground">{row.name}</div>
                            <div className="text-xs text-muted-foreground">{isFund ? "Special Fund" : subtypeLabel(row.assetSubtype)}</div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">YTD Total</div>
                            <div className="font-semibold text-foreground">{formatRs(row.periodTotal)}</div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">This Month</div>
                            <div className="font-semibold text-foreground">{formatRs(row.thisMonthTotal)}</div>
                          </div>
                          <div className="text-xs text-muted-foreground md:text-right">
                            <div>Last Recorded</div>
                            <div className="font-medium text-foreground">{dateLabel(row.lastRecordedAt)}</div>
                          </div>
                          <div className="flex items-center gap-2 md:justify-end">
                            {isFund ? (
                              <Button size="sm" onClick={() => openFundRecord(row, section.key)} disabled={!canManage}>
                                {buttonLabel(flow, section.key)}
                              </Button>
                            ) : (
                              <Button size="sm" onClick={() => openRecord(row, category, section.key)} disabled={!canManage}>{buttonLabel(flow, section.key)}</Button>
                            )}
                            <Button asChild size="icon" variant="ghost" aria-label={isFund ? "Open fund" : "Open account"}>
                              <Link href={isFund ? `/funds/${row.id}?mode=${flow}` : `/${flow}/accounts/${row.id}`}>
                                <ChevronRight className="h-4 w-4" />
                              </Link>
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </main>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedAction}{selected ? ` - ${selected.row.name}` : ""}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Date</Label>
                <Input type="date" value={form.transactionDate} onChange={(e) => setForm((v) => ({ ...v, transactionDate: e.target.value }))} required />
              </div>
              <div>
                <Label>Amount</Label>
                <Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm((v) => ({ ...v, amount: e.target.value }))} required />
              </div>
              <div>
                <Label>{selectedCounterpartyLabel}</Label>
                <Input value={form.counterpartyName} onChange={(e) => setForm((v) => ({ ...v, counterpartyName: e.target.value, counterpartyMembershipId: "" }))} required />
              </div>
              <div>
                <Label>Member Search</Label>
                <Input value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="Search by name or membership no" />
                {memberOptions.length > 0 ? (
                  <div className="mt-1 max-h-36 overflow-auto rounded-md border bg-popover p-1">
                    {memberOptions.map((member) => {
                      const name = member.hod?.nameWithInitials || member.hod?.fullName || member.membershipNo;
                      return (
                        <button
                          type="button"
                          key={member.id}
                          className="w-full rounded px-2 py-1 text-left text-sm hover:bg-accent"
                          onClick={() => {
                            setForm((v) => ({
                              ...v,
                              counterpartyName: name,
                              counterpartyPhone: member.phoneNumber || v.counterpartyPhone,
                              counterpartyMembershipId: member.id,
                            }));
                            setMemberQuery(`${member.membershipNo} - ${name}`);
                            setMemberOptions([]);
                          }}
                        >
                          {member.membershipNo} - {name}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              <div>
                <Label>Payment Method</Label>
                <Select value={form.cashBankAccountId} onValueChange={(value) => setForm((v) => ({ ...v, cashBankAccountId: value }))}>
                  <SelectTrigger><SelectValue placeholder="Select cash/bank account" /></SelectTrigger>
                  <SelectContent>{cashBankAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Phone Number</Label>
                <Input value={form.counterpartyPhone} onChange={(e) => setForm((v) => ({ ...v, counterpartyPhone: e.target.value }))} />
              </div>
              <div>
                <Label>Reference</Label>
                <Input value={form.reference} onChange={(e) => setForm((v) => ({ ...v, reference: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm((v) => ({ ...v, description: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setSelected(null)}>Cancel</Button>
              <Button type="submit" disabled={submitting || !canManage}>{submitting ? "Saving..." : selectedAction}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: typeof ReceiptText; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
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

function AccountDetailView({
  flow,
  config,
  detail,
  canManage,
  loadingData,
  onRecord,
  onReverse,
}: {
  flow: CashFlowSlug;
  config: ReturnType<typeof flowConfig>;
  detail: CashAccountDetail;
  canManage: boolean;
  loadingData: boolean;
  onRecord: (category?: CashTransactionCategory) => void;
  onReverse: (transaction: CashTransaction) => void;
}) {
  const isReceivable = isReceivableSubtype(detail.account.assetSubtype);
  const isPayable = isPayableSubtype(detail.account.assetSubtype);
  const historyTitle = flow === "cash-in" ? "Transaction History" : "Payment History";
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        {isReceivable ? (
          <>
            <MetricCard icon={ReceiptText} label="Total Given" value={formatRs(detail.summary.totalGiven ?? 0)} />
            <MetricCard icon={WalletCards} label="Total Collected" value={formatRs(detail.summary.totalCollected ?? 0)} />
            <MetricCard icon={CalendarDays} label="Outstanding Balance" value={formatRs(detail.summary.outstandingBalance ?? 0)} />
          </>
        ) : isPayable ? (
          <>
            <MetricCard icon={ReceiptText} label="Total Payable" value={formatRs(detail.summary.totalPayable ?? 0)} />
            <MetricCard icon={WalletCards} label="Total Paid" value={formatRs(detail.summary.totalPaid ?? 0)} />
            <MetricCard icon={CalendarDays} label="Outstanding Balance" value={formatRs(detail.summary.outstandingBalance ?? 0)} />
          </>
        ) : (
          <>
            <MetricCard icon={ReceiptText} label="YTD Total" value={formatRs(detail.summary.periodTotal ?? 0)} />
            <MetricCard icon={WalletCards} label="This Month" value={formatRs(detail.summary.thisMonthTotal ?? 0)} />
            <MetricCard icon={CalendarDays} label="No. of Transactions" value={String(detail.summary.transactionCount ?? 0)} />
          </>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{historyTitle}</CardTitle>
          <div className="flex flex-wrap justify-end gap-2">
            {isReceivable ? (
              <>
                <Button variant="outline" onClick={() => onRecord("receivable_payment")} disabled={!canManage}>Record Payment</Button>
                <Button onClick={() => onRecord("receivable_collection")} disabled={!canManage}>Add Collection</Button>
              </>
            ) : isPayable ? (
              <>
                <Button variant="outline" onClick={() => onRecord("payable_recovery")} disabled={!canManage}>Recover</Button>
                <Button onClick={() => onRecord("payable_payment")} disabled={!canManage}>Make Payment</Button>
              </>
            ) : (
              <Button onClick={() => onRecord()} disabled={!canManage}>{config.actionLabel}</Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loadingData ? <div className="h-20 rounded-md bg-muted animate-pulse" /> : null}
          {!loadingData && detail.history.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No transactions recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2">Date</th>
                    <th className="p-2">Details</th>
                    <th className="p-2">Document</th>
                    <th className="p-2 text-right">Amount</th>
                    <th className="p-2">Status</th>
                    <th className="p-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.history.map((transaction) => (
                    <tr key={transaction.id} className="border-b last:border-0">
                      <td className="p-2 whitespace-nowrap">{dateLabel(transaction.transactionDate)}</td>
                      <td className="p-2">
                        <div className="font-medium">{transaction.description || transaction.counterpartyName}</div>
                        <div className="text-xs text-muted-foreground">
                          {actionLabel(flow, transaction.category)}
                          {transaction.counterpartyName ? ` - ${transaction.counterpartyName}` : ""}
                          {transaction.reference ? ` - ${transaction.reference}` : ""}
                        </div>
                      </td>
                      <td className="p-2">
                        <div className="font-mono text-xs">{transaction.documentNumber ?? "-"}</div>
                        <div className="text-[10px] text-muted-foreground">{actionDocumentLabel(flow, transaction.category)}</div>
                      </td>
                      <td className="p-2 text-right font-semibold">{formatRs(transaction.amount)}</td>
                      <td className="p-2">{transaction.reversedAt ? <span className="text-destructive">Reversed</span> : <span className="text-emerald-700">Posted</span>}</td>
                      <td className="p-2 text-right">
                        {!transaction.reversedAt && canManage ? (
                          <Button size="sm" variant="outline" onClick={() => onReverse(transaction)}>
                            <Undo2 className="mr-2 h-4 w-4" />
                            Reverse
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
