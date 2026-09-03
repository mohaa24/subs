"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDownToLine,
  ArrowDownCircle,
  ArrowLeft,
  ArrowUpCircle,
  ArrowUpFromLine,
  Banknote,
  BanknoteArrowDown,
  BanknoteArrowUp,
  BetweenHorizontalStart,
  Calendar1,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Landmark,
  Bookmark,
  Pencil,
  ReceiptText,
  RotateCcw,
  Search,
  SquareMenu,
  Undo2,
  UserRoundCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
  apiAssetUrl,
  type AccountingAccount,
  type CashAccountDetail,
  type CashFlowAccountRow,
  type CashFlowOverview,
  type CashTransaction,
  type CashTransactionCategory,
  type CashTransactionReceipt,
} from "@/lib/api";
import { dashboardFlowHref } from "@/lib/dashboard-flows";
import { toast } from "@/hooks/use-toast";
import {
  PaymentReceiptDialog,
  type PaymentReceiptData,
} from "@/components/payment-receipt-dialog";

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
  payable_repayment: "payable_repayment",
  payable_payment: "payable_repayment",
  project_fund_collection: null,
  project_fund_expense: null,
};

const reversalReasons = [
  "Incorrect Amount",
  "Incorrect Account",
  "Duplicate Entry",
  "Incorrect Payment Method",
  "Entered By Mistake",
  "Other",
] as const;

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

function dateTimeLabel(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function transactionDateKey(value: string) {
  return new Date(value).toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
}

function transactionGroupLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
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
  if (flow === "cash-in" && category === "payable_borrowing") return "/accounting/cash-in/payable-borrowings";
  if (flow === "cash-out" && category === "operating_expense") return "/accounting/cash-out/operating-expenses";
  if (flow === "cash-out" && category === "payable_repayment") return "/accounting/cash-out/payable-repayments";
  if (flow === "cash-out" && category === "payable_payment") return "/accounting/cash-out/payable-repayments";
  if (flow === "cash-out" && category === "payable_recovery") return "/accounting/cash-out/payable-recoveries";
  return "/accounting/cash-out/payable-repayments";
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
  return flow === "cash-in" ? "Receive" : "Pay";
}

function isCashInAction(flow: CashFlowSlug, category?: CashTransactionCategory | null) {
  if (category === "payable_borrowing" || category === "payable_recovery" || category === "receivable_collection") return true;
  if (category === "payable_repayment" || category === "payable_payment" || category === "receivable_payment") return false;
  return flow === "cash-in";
}

function actionLabel(flow: CashFlowSlug, category?: CashTransactionCategory | null, sectionKey?: string) {
  if (category === "receivable_payment") return "Add Amount Due";
  if (category === "receivable_collection") return "Record Repayment";
  if (category === "payable_borrowing" || category === "payable_recovery") return "Add Borrowing";
  if (category === "payable_repayment" || category === "payable_payment") return "Record Settlement";
  return buttonLabel(flow, sectionKey);
}

function actionCounterpartyLabel(flow: CashFlowSlug, category?: CashTransactionCategory | null) {
  if (category === "receivable_payment" || category === "payable_repayment" || category === "payable_payment") return "Paid To";
  if (category === "receivable_collection" || category === "payable_borrowing" || category === "payable_recovery") return "Received From";
  return flow === "cash-in" ? "Received From" : "Paid To";
}

function actionDocumentLabel(flow: CashFlowSlug, category?: CashTransactionCategory | null) {
  if (category === "receivable_payment" || category === "payable_repayment" || category === "payable_payment") return "Payment Voucher Number";
  if (category === "receivable_collection" || category === "payable_borrowing" || category === "payable_recovery") return "Receipt Number";
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

function toCashReceiptData(receipt: CashTransactionReceipt): PaymentReceiptData {
  return {
    paymentKind: "fund",
    organizationName: receipt.organizationName,
    organizationReceiptLogoUrl: apiAssetUrl(receipt.organizationReceiptLogoUrl),
    membershipNo: receipt.accountName,
    membershipId: "",
    memberName: receipt.counterpartyName || receipt.accountName,
    paymentId: receipt.transactionId,
    receiptNumber: receipt.receiptNumber,
    paymentDate: receipt.transactionDate,
    paymentMethod: receipt.paymentMethod || "Cash/Bank",
    paidAmount: receipt.amount,
    appliedToDue: 0,
    overpaymentToCredit: 0,
    remainingAfter: 0,
    outstandingAfterPayment: 0,
    creditBalanceAfterPayment: 0,
    note: receipt.reversalReason || receipt.description || receipt.reference || null,
    collectedBy: receipt.collectedBy || undefined,
    memberQrValue: "",
    receiptTitle: receipt.receiptTitle,
    primaryLabel: "Account",
    nameLabel: receipt.counterpartyLabel,
    amountLabel: receipt.amountLabel,
    showBalanceAfterPayment: false,
    extraRows: [
      receipt.originalReceiptNumber
        ? { label: "Original Receipt", value: receipt.originalReceiptNumber }
        : null,
      receipt.reference ? { label: "Reference", value: receipt.reference } : null,
      receipt.counterpartyPhone ? { label: "Phone", value: receipt.counterpartyPhone } : null,
      receipt.reversalReason ? { label: "Reversal Reason", value: receipt.reversalReason } : null,
    ].filter(Boolean) as Array<{ label: string; value: string }>,
  };
}

export function CashFlowWorkspace({ flow, accountId }: { flow: CashFlowSlug; accountId?: string }) {
  const config = flowConfig(flow);
  const { user, loading, hasPermission } = useAuth();
  const router = useRouter();
  const canManage = flow === "cash-in"
    ? hasPermission("RECEIVE_OPERATING_INCOME", "MANAGE_RECEIVABLES", "MANAGE_PAYABLES")
    : hasPermission("PAY_OPERATING_EXPENSE", "MANAGE_PAYABLES");
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
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptData, setReceiptData] = useState<PaymentReceiptData | null>(null);
  const [reverseTarget, setReverseTarget] = useState<CashTransaction | null>(null);
  const [reverseReason, setReverseReason] = useState<string>(reversalReasons[0]);
  const Icon = config.icon;

  const cashBankAccounts = useMemo(
    () => accounts.filter((account) => account.accountType === "asset" && isCashBankSubtype(account.assetSubtype) && account.isActive),
    [accounts],
  );

  function defaultCashBankAccountId(source = cashBankAccounts) {
    return source.find((account) => account.systemKey === "asset_cash_on_hand")?.id
      ?? source.find((account) => account.name.trim().toLowerCase() === "cash on hand")?.id
      ?? source[0]?.id
      ?? "";
  }

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
      const activeCashBank = data.filter((account) => account.accountType === "asset" && isCashBankSubtype(account.assetSubtype) && account.isActive);
      setForm((v) => ({ ...v, cashBankAccountId: v.cashBankAccountId || defaultCashBankAccountId(activeCashBank) }));
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
    setForm(defaultForm(defaultCashBankAccountId()));
    setMemberQuery("");
    setMemberOptions([]);
  }

  function openFundRecord(row: CashFlowAccountRow, sectionKey?: string) {
    setSelected({ row, category: null, sectionKey });
    setForm(defaultForm(defaultCashBankAccountId()));
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
      if (
        (flow === "cash-in" && selected.category === "operating_income")
        || (flow === "cash-out" && selected.category === "operating_expense")
      ) {
        await openCashReceipt(transaction.id);
      }
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to record transaction", description: err instanceof Error ? err.message : "Unable to save" });
    } finally {
      setSubmitting(false);
    }
  }

  function openReverse(transaction: CashTransaction) {
    setReverseTarget(transaction);
    setReverseReason(reversalReasons[0]);
  }

  async function handleReverse(event: FormEvent) {
    event.preventDefault();
    if (!reverseTarget || !reverseReason) return;
    setSubmitting(true);
    try {
      await api(`/accounting/cash-transactions/${reverseTarget.id}/reverse`, {
        method: "POST",
        body: JSON.stringify({ reason: reverseReason }),
      });
      toast({ title: "Transaction reversed", description: reverseTarget.documentNumber ?? reverseTarget.id });
      setReverseTarget(null);
      await loadDetail();
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to reverse transaction", description: err instanceof Error ? err.message : "Unable to reverse" });
    } finally {
      setSubmitting(false);
    }
  }

  async function openCashReceipt(transactionId: string) {
    try {
      const receipt = await api<CashTransactionReceipt>(
        `/accounting/cash-transactions/${transactionId}/receipt`
      );
      setReceiptData(toCashReceiptData(receipt));
      setReceiptOpen(true);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Receipt could not be loaded",
        description:
          err instanceof Error
            ? err.message
            : "The transaction was saved, but the receipt could not be opened.",
      });
    }
  }

  if (loading || !user) return null;

  const selectedAction = selected ? actionLabel(flow, selected.category, selected.sectionKey) : config.actionLabel;
  const selectedButtonLabel = selected ? buttonLabel(flow, selected.sectionKey) : flow === "cash-in" ? "Receive" : "Pay";
  const selectedCounterpartyLabel = selected ? actionCounterpartyLabel(flow, selected.category) : config.counterpartyLabel;

  return (
    <div className="min-h-screen bg-background relative">
      <AbstractBg />
      <Header />
      <main className="relative z-10 mx-auto max-w-7xl space-y-6 px-3 py-4 sm:p-6">
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
              category ?? (isReceivableSubtype(detail.account.assetSubtype) ? "receivable_collection" : isPayableSubtype(detail.account.assetSubtype) ? "payable_repayment" : flow === "cash-in" ? "operating_income" : "operating_expense")
            )}
            onReverse={openReverse}
            onReceipt={openCashReceipt}
          />
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <MetricCard icon={flow === "cash-in" ? BanknoteArrowDown : BanknoteArrowUp} label={flow === "cash-in" ? "Total Cash In" : "Total Cash Out"} value={formatRs(overview?.totals.periodTotal ?? 0)} intent={flow === "cash-in" ? "cashIn" : "cashOut"} />
              <MetricCard icon={BetweenHorizontalStart} label="No of Accounts" value={String(overview?.totals.accountCount ?? 0)} intent="neutral" />
              <MetricCard icon={Calendar1} label="Period" value={`${dateLabel(fromDate)} - ${dateLabel(toDate)}`} intent="neutral" />
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
                      const isReceivableCard = section.key === "receivable_collection" && isReceivableSubtype(row.assetSubtype);
                      const isPayableCard = section.key === "payable_repayment" && isPayableSubtype(row.assetSubtype);
                      const detailHref = isFund
                        ? `/funds/${row.id}?mode=${flow}`
                        : isReceivableCard
                          ? `/receivables/${row.id}?source=cash-in`
                          : isPayableCard
                            ? `/payables/${row.id}?source=cash-out`
                            : `/${flow}/accounts/${row.id}`;
                      return (
                        <div
                          key={row.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => router.push(detailHref)}
                          onKeyDown={(event) => {
                            if (event.currentTarget !== event.target) return;
                            if (event.key === "Enter" || event.key === " ") router.push(detailHref);
                          }}
                          className="grid cursor-pointer gap-3 rounded-md border bg-card p-3 transition hover:bg-muted/40 md:grid-cols-[1.5fr_1fr_1fr_auto_auto] md:items-center"
                        >
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
                              <Button size="sm" variant={flow === "cash-in" ? "cashIn" : "cashOut"} onClick={(event) => { event.stopPropagation(); openFundRecord(row, section.key); }} disabled={!canManage}>
                                {flow === "cash-in" ? <Banknote className="mr-2 h-4 w-4" /> : <BanknoteArrowUp className="mr-2 h-4 w-4" />}
                                {buttonLabel(flow, section.key)}
                              </Button>
                            ) : (
                              <Button size="sm" variant={flow === "cash-in" ? "cashIn" : "cashOut"} onClick={(event) => { event.stopPropagation(); openRecord(row, category, section.key); }} disabled={!canManage}>
                                {flow === "cash-in" ? <Banknote className="mr-2 h-4 w-4" /> : <BanknoteArrowUp className="mr-2 h-4 w-4" />}
                                {buttonLabel(flow, section.key)}
                              </Button>
                            )}
                            <Button asChild size="icon" variant="ghost" aria-label={isFund ? "Open fund" : "Open account"} onClick={(event) => event.stopPropagation()}>
                              <Link href={detailHref}>
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
              <Button type="button" variant="dangerOutline" onClick={() => setSelected(null)}>Cancel</Button>
              <Button type="submit" variant={isCashInAction(flow, selected?.category) ? "cashIn" : "cashOut"} disabled={submitting || !canManage}>
                {isCashInAction(flow, selected?.category) ? <Banknote className="mr-2 h-4 w-4" /> : <BanknoteArrowUp className="mr-2 h-4 w-4" />}
                {submitting ? "Saving..." : selectedButtonLabel}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!reverseTarget}
        onOpenChange={(open) => {
          if (!open && !submitting) setReverseTarget(null);
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Reverse Entry</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleReverse} className="space-y-5">
            <div>
              <div className="mb-2 text-sm font-semibold text-foreground">Transaction Info</div>
              <div className="grid overflow-hidden rounded-lg border bg-muted/20 sm:grid-cols-3 sm:divide-x">
                <div className="border-b p-3 sm:border-b-0">
                  <div className="text-xs text-muted-foreground">Transaction</div>
                  <div className="mt-1 break-words font-medium text-foreground">
                    {reverseTarget?.documentNumber ?? reverseTarget?.transactionLabel ?? "—"}
                  </div>
                  {reverseTarget?.documentNumber && reverseTarget.transactionLabel ? (
                    <div className="mt-0.5 text-xs text-muted-foreground">{reverseTarget.transactionLabel}</div>
                  ) : null}
                </div>
                <div className="border-b p-3 sm:border-b-0">
                  <div className="text-xs text-muted-foreground">Date</div>
                  <div className="mt-1 font-medium text-foreground">{dateLabel(reverseTarget?.transactionDate)}</div>
                </div>
                <div className="p-3">
                  <div className="text-xs text-muted-foreground">Amount</div>
                  <div className="mt-1 font-semibold tabular-nums text-foreground">
                    {reverseTarget ? formatRs(reverseTarget.amount) : "—"}
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Reason for Reversal <span className="text-destructive">*</span></Label>
              <Select value={reverseReason} onValueChange={setReverseReason}>
                <SelectTrigger><SelectValue placeholder="Select a reason" /></SelectTrigger>
                <SelectContent>
                  {reversalReasons.map((reason) => (
                    <SelectItem key={reason} value={reason}>{reason}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="outline" onClick={() => setReverseTarget(null)} disabled={submitting}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={submitting || !reverseReason}>
                <Undo2 className="mr-2 h-4 w-4" />
                {submitting ? "Reversing..." : "Confirm Reversal"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <PaymentReceiptDialog
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
        receipt={receiptData}
      />
    </div>
  );
}

function MetricCard({ icon, label, value, intent }: { icon: typeof ReceiptText; label: string; value: string; intent: MetricTileIntent }) {
  return <MetricTile icon={icon} label={label} value={value} intent={intent} />;
}

function AccountDetailView({
  flow,
  config,
  detail,
  canManage,
  loadingData,
  onRecord,
  onReverse,
  onReceipt,
}: {
  flow: CashFlowSlug;
  config: ReturnType<typeof flowConfig>;
  detail: CashAccountDetail;
  canManage: boolean;
  loadingData: boolean;
  onRecord: (category?: CashTransactionCategory) => void;
  onReverse: (transaction: CashTransaction) => void;
  onReceipt: (transactionId: string) => void;
}) {
  const isReceivable = isReceivableSubtype(detail.account.assetSubtype);
  const isPayable = isPayableSubtype(detail.account.assetSubtype);
  const historyTitle = flow === "cash-in" ? "Transaction History" : "Payment History";
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        {isReceivable ? (
          <>
            <MetricCard icon={BanknoteArrowUp} label="Total Given" value={formatRs(detail.summary.totalGiven ?? 0)} intent="cashOut" />
            <MetricCard icon={BanknoteArrowDown} label="Total Repaid" value={formatRs(detail.summary.totalCollected ?? 0)} intent="cashIn" />
            <MetricCard icon={Banknote} label="Outstanding Balance" value={formatRs(detail.summary.outstandingBalance ?? 0)} intent="outstanding" />
          </>
        ) : isPayable ? (
          <>
            <MetricCard icon={BanknoteArrowDown} label="Total Borrowed" value={formatRs(detail.summary.totalBorrowed ?? detail.summary.totalPayable ?? 0)} intent="cashIn" />
            <MetricCard icon={BanknoteArrowUp} label="Total Settled" value={formatRs(detail.summary.totalRepaid ?? detail.summary.totalPaid ?? 0)} intent="cashOut" />
            <MetricCard icon={Banknote} label="Outstanding Balance" value={formatRs(detail.summary.outstandingBalance ?? 0)} intent="outstanding" />
          </>
        ) : (
          <>
            <MetricCard icon={flow === "cash-in" ? BanknoteArrowDown : BanknoteArrowUp} label={flow === "cash-in" ? "YTD Income" : "YTD Expense"} value={formatRs(detail.summary.periodTotal ?? 0)} intent={flow === "cash-in" ? "cashIn" : "cashOut"} />
            <MetricCard icon={flow === "cash-in" ? BanknoteArrowDown : BanknoteArrowUp} label="This Month" value={formatRs(detail.summary.thisMonthTotal ?? 0)} intent={flow === "cash-in" ? "cashIn" : "cashOut"} />
            <MetricCard icon={SquareMenu} label="Transactions" value={String(detail.summary.transactionCount ?? 0)} intent="neutral" />
          </>
        )}
      </div>

        {isReceivable ? (
          <div className="grid gap-4 xl:grid-cols-2">
          <CashHistoryCard
            title="Disburse History (Cash Out)"
            action={<Button variant="cashOut" onClick={() => onRecord("receivable_payment")} disabled={!canManage}><BanknoteArrowUp className="mr-2 h-4 w-4" />Give Loan</Button>}
            flow={flow}
            rows={detail.history.filter((transaction) => transaction.category === "receivable_payment")}
            loadingData={loadingData}
            canManage={canManage}
            onReverse={onReverse}
          />
          <CashHistoryCard
            title="Recovery History (Cash In)"
            action={<Button variant="cashIn" onClick={() => onRecord("receivable_collection")} disabled={!canManage}><Banknote className="mr-2 h-4 w-4" />Receive</Button>}
            flow={flow}
            rows={detail.history.filter((transaction) => transaction.category === "receivable_collection")}
            loadingData={loadingData}
            canManage={canManage}
            onReverse={onReverse}
          />
        </div>
      ) : isPayable ? (
        <div className="space-y-4">
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="cashIn" onClick={() => onRecord("payable_borrowing")} disabled={!canManage}><Banknote className="mr-2 h-4 w-4" />Receive Loan</Button>
            <Button variant="cashOut" onClick={() => onRecord("payable_repayment")} disabled={!canManage}><BanknoteArrowUp className="mr-2 h-4 w-4" />Repay</Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-end md:justify-between">
                <div>
                  <h2 className="font-semibold">Payment History</h2>
                  <p className="text-sm text-muted-foreground">A complete history of borrowings, repayments, and reversals.</p>
                </div>
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="p-3">Date</th>
                      <th className="p-3">Transaction</th>
                      <th className="p-3">Payment Method</th>
                      <th className="p-3 text-right">Amount</th>
                      <th className="p-3 text-right">Balance</th>
                      <th className="p-3">Actioned By</th>
                      <th className="p-3">Receipt No.</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.history.map((tx) => (
                      <PayableHistoryRow
                        key={tx.id}
                        tx={tx}
                        canManage={canManage}
                        expanded={!!expandedRows[tx.id]}
                        onToggle={() => setExpandedRows({ ...expandedRows, [tx.id]: !expandedRows[tx.id] })}
                        onReverse={onReverse}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="space-y-2 p-3 md:hidden">
                {detail.history.map((tx) => {
                  const open = expandedRows[tx.id];
                  return (
                    <Card key={tx.id}>
                      <button
                        type="button"
                        onClick={() => setExpandedRows({ ...expandedRows, [tx.id]: !open })}
                        className="w-full p-3 text-left"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-semibold">{tx.transactionLabel}</div>
                            <div className="text-xs text-muted-foreground">{tx.description || tx.counterpartyName || "-"}</div>
                          </div>
                          <div className="text-right font-semibold">{formatRs(tx.amount)}</div>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                          <span>{dateLabel(tx.transactionDate)}</span>
                          <span className="inline-flex items-center gap-1">
                            <Banknote className="h-3.5 w-3.5" />
                            {tx.paymentMethod ?? "-"}
                          </span>
                          <span>{`Balance: ${formatRs(tx.balance ?? 0)}`}</span>
                          <span className="text-right">{tx.documentNumber ?? "-"}</span>
                        </div>
                      </button>
                      <div className="flex items-center justify-between border-t px-3 py-2 text-xs">
                        <span className={tx.reversedAt ? "text-destructive" : "text-emerald-700"}>{tx.reversedAt ? "Reversed" : "Posted"}</span>
                        <div className="flex items-center gap-2">
                          {tx.reversedAt ? (
                            <Button size="sm" variant="outline" onClick={() => setExpandedRows({ ...expandedRows, [tx.id]: !open })}>
                              {open ? "Hide details" : "View details"}
                              <ChevronDown className={`ml-2 h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
                            </Button>
                          ) : null}
                          {!tx.reversedAt && canManage ? (
                            <Button size="sm" variant="dangerOutline" onClick={() => onReverse(tx)}>
                              <Undo2 className="mr-2 h-4 w-4" />
                              Reverse
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      {open && tx.reversedAt ? <PayableHistoryDetail tx={tx} /> : null}
                    </Card>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <CashStatementHistoryCard
          title={historyTitle}
          action={
            isPayable ? (
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="cashIn" onClick={() => onRecord("payable_borrowing")} disabled={!canManage}><Banknote className="mr-2 h-4 w-4" />Receive Loan</Button>
                <Button variant="cashOut" onClick={() => onRecord("payable_repayment")} disabled={!canManage}><BanknoteArrowUp className="mr-2 h-4 w-4" />Repay</Button>
              </div>
            ) : (
              <Button variant={flow === "cash-in" ? "cashIn" : "cashOut"} onClick={() => onRecord()} disabled={!canManage}>
                {flow === "cash-in" ? <Banknote className="mr-2 h-4 w-4" /> : <BanknoteArrowUp className="mr-2 h-4 w-4" />}
                {flow === "cash-in" ? "Receive" : "Pay"}
              </Button>
            )
          }
          flow={flow}
          accountName={detail.account.name}
          rows={detail.history}
          loadingData={loadingData}
          canManage={canManage}
          onReverse={onReverse}
          onReceipt={onReceipt}
        />
      )}
    </div>
  );
}

function PayableHistoryRow({
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
  onReverse: (transaction: CashTransaction) => void;
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
        <td className="p-3">{tx.createdBy?.email ?? "-"}</td>
        <td className="p-3">
          {tx.documentNumber ? (
            <div className="font-mono text-xs font-semibold text-primary">{tx.documentNumber}</div>
          ) : (
            "-"
          )}
        </td>
        <td className="p-3">
          <span className={`rounded px-2 py-1 text-xs capitalize ${tx.reversedAt ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
            {tx.reversedAt ? "Reversed" : "Posted"}
          </span>
        </td>
        <td className="p-3 text-right">
          <div className="flex items-center justify-end gap-2">
            {canManage && !tx.reversedAt ? (
              <Button size="sm" variant="dangerOutline" onClick={() => onReverse(tx)}>
                <Undo2 className="mr-2 h-4 w-4" />
                Reverse
              </Button>
            ) : null}
            {tx.reversedAt ? (
              <Button size="sm" variant="outline" onClick={onToggle}>
                {expanded ? "Hide details" : "View details"}
                <ChevronDown className={`ml-2 h-4 w-4 transition ${expanded ? "rotate-180" : ""}`} />
              </Button>
            ) : null}
          </div>
        </td>
      </tr>
      {expanded && tx.reversedAt ? (
        <tr className="border-b bg-destructive/5">
          <td colSpan={9} className="p-3">
            <PayableHistoryDetail tx={tx} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function PayableHistoryDetail({ tx }: { tx: CashTransaction }) {
  return (
    <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-4">
      <DetailMini label="Actioned by" value={tx.createdBy?.email ?? "-"} />
      <DetailMini label="Receipt no" value={tx.documentNumber ?? "-"} />
      <DetailMini label="Reversal reason" value={tx.reversalReason ?? "-"} />
      <DetailMini label="Reversed by" value={tx.reversedBy?.email ?? "-"} />
      <DetailMini label="Reversed on" value={dateLabel(tx.reversedAt)} />
      <DetailMini label="Linked reversal receipt" value={tx.reversalDocumentNumber ?? "-"} />
    </div>
  );
}

function CashStatementHistoryCard({
  title,
  action,
  flow,
  accountName,
  rows,
  loadingData,
  canManage,
  onReverse,
  onReceipt,
}: {
  title: string;
  action: ReactNode;
  flow: CashFlowSlug;
  accountName: string;
  rows: CashTransaction[];
  loadingData: boolean;
  canManage: boolean;
  onReverse: (transaction: CashTransaction) => void;
  onReceipt: (transactionId: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const groups = useMemo(() => {
    const grouped = new Map<string, CashTransaction[]>();
    rows.forEach((transaction) => {
      const key = transactionDateKey(transaction.transactionDate);
      grouped.set(key, [...(grouped.get(key) ?? []), transaction]);
    });
    return Array.from(grouped, ([date, transactions]) => ({ date, transactions }));
  }, [rows]);

  return (
    <Card className="border-0 shadow-none md:border md:shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-3 px-0 md:px-6">
        <CardTitle className="text-base">{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent className="p-0 md:p-6 md:pt-0">
        {loadingData ? <div className="h-24 animate-pulse rounded-md bg-muted" /> : null}
        {!loadingData && rows.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No transactions recorded yet.</p>
        ) : null}
        {!loadingData && rows.length > 0 ? (
          <div className="space-y-4">
            {groups.map((group) => (
              <section key={group.date} className="overflow-hidden rounded-lg border bg-card">
                <div className="flex items-center justify-between border-b bg-slate-50 px-4 py-2.5 text-xs">
                  <h3 className="flex items-center gap-2 font-semibold text-slate-700">
                    <CalendarDays className="h-4 w-4 text-slate-500" />
                    {transactionGroupLabel(group.date)}
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {group.transactions.length} {group.transactions.length === 1 ? "transaction" : "transactions"}
                  </span>
                </div>

                <div className="divide-y md:hidden">
                  {group.transactions.map((transaction) => {
                    const expanded = expandedId === transaction.id;
                    const reversed = Boolean(transaction.reversedAt);
                    return (
                      <div key={transaction.id}>
                        <button
                          type="button"
                          className="grid w-full grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 p-3 text-left"
                          onClick={() => setExpandedId(expanded ? null : transaction.id)}
                          aria-expanded={expanded}
                        >
                          <TransactionStatusIcon reversed={reversed} flow={flow} />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{accountName}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {flow === "cash-in" ? "Received From" : "Paid To"}: {transaction.counterpartyName || "—"}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="text-right">
                              <div className={`text-sm font-semibold tabular-nums ${reversed ? "text-red-600" : flow === "cash-in" ? "text-emerald-700" : "text-blue-700"}`}>
                                {cashStatementAmountLabel(transaction)}
                              </div>
                              <TransactionStatusBadge reversed={reversed} />
                            </div>
                            <ChevronDown className={`h-4 w-4 text-primary transition-transform ${expanded ? "rotate-180" : ""}`} />
                          </div>
                        </button>
                        {expanded ? (
                          <CashStatementExpanded
                            transaction={transaction}
                            canManage={canManage}
                            onReceipt={onReceipt}
                            onReverse={onReverse}
                            mobile
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                <div className="hidden overflow-x-auto md:block">
                  <div className="min-w-[1000px]">
                    <div className="grid grid-cols-[64px_minmax(210px,1.5fr)_145px_minmax(170px,1fr)_155px_105px_40px] items-center gap-3 border-b bg-muted/20 px-4 py-2 text-[10px] font-medium text-muted-foreground">
                      <div>Transaction</div>
                      <div>Account Details</div>
                      <div>Receipt No.</div>
                      <div>Payment Method</div>
                      <div className="text-right">Amount (LKR)</div>
                      <div className="text-center">Status</div>
                      <div />
                    </div>
                    <div className="divide-y">
                      {group.transactions.map((transaction) => {
                        const expanded = expandedId === transaction.id;
                        const reversed = Boolean(transaction.reversedAt);
                        return (
                          <div key={transaction.id}>
                            <button
                              type="button"
                              className="grid w-full grid-cols-[64px_minmax(210px,1.5fr)_145px_minmax(170px,1fr)_155px_105px_40px] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/20"
                              onClick={() => setExpandedId(expanded ? null : transaction.id)}
                              aria-expanded={expanded}
                            >
                              <TransactionStatusIcon reversed={reversed} flow={flow} />
                              <div className="min-w-0 pr-4">
                                <div className="truncate text-sm font-semibold">{accountName}</div>
                                <div className="truncate text-xs text-muted-foreground">
                                  {flow === "cash-in" ? "Received From" : "Paid To"}: {transaction.counterpartyName || "—"}
                                </div>
                              </div>
                              <div className="truncate font-mono text-xs text-foreground">{transaction.documentNumber || "—"}</div>
                              <TransactionPaymentMethod transaction={transaction} />
                              <div className={`text-right text-sm font-bold tabular-nums ${reversed ? "text-red-600" : flow === "cash-in" ? "text-emerald-700" : "text-blue-700"}`}>
                                {cashStatementAmountLabel(transaction)}
                              </div>
                              <div className="text-center"><TransactionStatusBadge reversed={reversed} /></div>
                              <span className="flex h-8 w-8 items-center justify-center justify-self-end rounded-md text-primary transition hover:bg-primary/10">
                                <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
                              </span>
                            </button>
                            {expanded ? (
                              <CashStatementExpanded
                                transaction={transaction}
                                canManage={canManage}
                                onReceipt={onReceipt}
                                onReverse={onReverse}
                              />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </section>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TransactionStatusIcon({ reversed, flow }: { reversed: boolean; flow: CashFlowSlug }) {
  if (reversed) {
    return <span className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500 text-white shadow-sm"><RotateCcw className="h-4 w-4" /></span>;
  }
  return (
    <span className={`flex h-9 w-9 items-center justify-center rounded-full text-white shadow-sm ${flow === "cash-in" ? "bg-emerald-600" : "bg-blue-600"}`}>
      {flow === "cash-in" ? <ArrowDownToLine className="h-4 w-4" /> : <ArrowUpFromLine className="h-4 w-4" />}
    </span>
  );
}

function TransactionStatusBadge({ reversed }: { reversed: boolean }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${reversed ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
      {reversed ? "Reversed" : "Paid"}
    </span>
  );
}

function TransactionPaymentMethod({ transaction }: { transaction: CashTransaction }) {
  const bank = transaction.cashBankAccount?.assetSubtype === "bank";
  const MethodIcon = bank ? Landmark : Banknote;
  return (
    <div className="flex min-w-0 items-center gap-2 pr-3 text-xs">
      <MethodIcon className="h-4 w-4 shrink-0 text-slate-500" />
      <span className="truncate">{transaction.cashBankAccount?.name || transaction.paymentMethod || "—"}</span>
    </div>
  );
}

function cashStatementAmountLabel(transaction: CashTransaction) {
  const amount = new Intl.NumberFormat("en-LK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(transaction.amount));
  return `${transaction.reversedAt ? "-" : ""}LKR ${amount}`;
}

function CashHistoryDetail({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 py-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] text-muted-foreground">{label}</span>
        <span className="block break-words font-medium text-foreground">{value}</span>
      </span>
    </div>
  );
}

function CashStatementExpanded({
  transaction,
  canManage,
  onReceipt,
  onReverse,
  mobile = false,
}: {
  transaction: CashTransaction;
  canManage: boolean;
  onReceipt: (transactionId: string) => void;
  onReverse: (transaction: CashTransaction) => void;
  mobile?: boolean;
}) {
  return (
    <div className={`mx-3 mb-3 overflow-hidden rounded-md border-l-2 ${transaction.reversedAt ? "border-red-400 bg-red-50/30" : "border-emerald-500 bg-emerald-50/25"}`}>
      <div className={`grid gap-4 p-4 ${mobile ? "grid-cols-1" : "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_100px] items-center"}`}>
        {mobile ? (
          <>
            <CashHistoryDetail icon={ReceiptText} label="Receipt No." value={transaction.documentNumber || "—"} />
            <div><div className="text-xs text-muted-foreground">Payment Method</div><TransactionPaymentMethod transaction={transaction} /></div>
          </>
        ) : null}
        <CashHistoryDetail icon={UserRoundCheck} label="Entered By" value={transaction.createdBy?.email || "—"} />
        <CashHistoryDetail icon={CalendarDays} label="Date Entered" value={dateTimeLabel(transaction.createdAt)} />
        <CashHistoryDetail icon={Bookmark} label="Reference" value={transaction.reference || "—"} />
        <div className={`flex flex-wrap gap-2 ${mobile ? "" : "justify-end"}`}>
          <Button size="sm" variant="neutralOutline" onClick={() => onReceipt(transaction.id)}>
            <ReceiptText className="mr-2 h-4 w-4" />Receipt
          </Button>
          {!transaction.reversedAt && canManage ? (
            <Button size="sm" variant="dangerOutline" onClick={() => onReverse(transaction)}>
              <Undo2 className="mr-2 h-4 w-4" />Reverse
            </Button>
          ) : null}
        </div>
      </div>
      {transaction.reversedAt ? (
        <div className={`grid gap-4 border-t border-red-100 bg-red-50/60 p-4 ${mobile ? "grid-cols-1" : "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_100px]"}`}>
          <CashHistoryDetail icon={UserRoundCheck} label="Reversed By" value={transaction.reversedBy?.email || "—"} />
          <CashHistoryDetail icon={CalendarDays} label="Reversed Date" value={dateTimeLabel(transaction.reversedAt)} />
          <CashHistoryDetail icon={Pencil} label="Reversed Reason" value={transaction.reversalReason || "—"} />
          <div />
        </div>
      ) : null}
    </div>
  );
}

function CashHistoryCard({
  title,
  action,
  flow,
  rows,
  loadingData,
  canManage,
  onReverse,
}: {
  title: string;
  action: ReactNode;
  flow: CashFlowSlug;
  rows: CashTransaction[];
  loadingData: boolean;
  canManage: boolean;
  onReverse: (transaction: CashTransaction) => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base">{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent>
        {loadingData ? <div className="h-20 rounded-md bg-muted animate-pulse" /> : null}
        {!loadingData && rows.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No transactions recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-2">Date</th>
                  <th className="p-2">Details</th>
                  <th className="p-2">Receipt Number</th>
                  <th className="p-2 text-right">Amount</th>
                  <th className="p-2">Status</th>
                  <th className="p-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((transaction) => (
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
                        <Button size="sm" variant="dangerOutline" onClick={() => onReverse(transaction)}>
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
  );
}

function DetailMini({ label, value }: { label: string; value: string }) {
  return <div><div className="text-muted-foreground">{label}</div><div className="font-medium text-foreground">{value}</div></div>;
}
