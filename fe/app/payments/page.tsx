"use client";

import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  api,
  apiAssetUrl,
  type AccountingAccount,
  type DueStatus,
  type DueType,
  type Payment,
  type PaymentDue,
  type PaymentReceipt,
  type Zone,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpDown,
  Banknote,
  Bookmark,
  CalendarDays,
  CreditCard,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LockKeyhole,
  Landmark,
  ListFilter,
  Pencil,
  QrCode,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Search,
  UserRound,
  UserRoundCheck,
  WandSparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Header } from "@/components/header";
import { Breadcrumb } from "@/components/breadcrumb";
import { toast } from "@/hooks/use-toast";
import { dashboardFlowHref } from "@/lib/dashboard-flows";
import { PAYMENT_REVERSAL_REASONS } from "@/lib/payment-reversal";
import {
  getPaymentDuePeriodLine,
  getPaymentDueSubtitle,
  getPaymentDueTitle,
} from "@/lib/payment-due";
import { RecordPaymentDialog } from "@/components/record-payment-dialog";
import {
  PaymentReceiptDialog,
  type PaymentReceiptData,
} from "@/components/payment-receipt-dialog";

const statusColors: Record<string, string> = {
  paid: "bg-green-100 text-green-800",
  partial: "bg-yellow-100 text-yellow-800",
  pending: "bg-amber-100 text-amber-800",
  overdue: "bg-red-100 text-red-800",
};

const dueStatusTones: Record<DueStatus, { tile: string; text: string; badge: string; progress: string }> = {
  paid: {
    tile: "border-emerald-100 bg-emerald-50 text-emerald-700",
    text: "text-emerald-700",
    badge: "bg-emerald-100 text-emerald-700",
    progress: "bg-emerald-500",
  },
  partial: {
    tile: "border-amber-100 bg-amber-50 text-amber-700",
    text: "text-amber-700",
    badge: "bg-amber-100 text-amber-700",
    progress: "bg-amber-500",
  },
  pending: {
    tile: "border-amber-100 bg-amber-50 text-amber-700",
    text: "text-amber-700",
    badge: "bg-amber-100 text-amber-700",
    progress: "bg-amber-500",
  },
  overdue: {
    tile: "border-red-100 bg-red-50 text-red-700",
    text: "text-red-700",
    badge: "bg-red-100 text-red-700",
    progress: "bg-red-500",
  },
};

function PaymentHistoryDetail({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
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

function getPaymentPeriodLabel(payment: Payment | null) {
  if (!payment) return "—";
  return payment.paymentDue?.period ?? (payment.paymentKind === "credit" ? "Credit Payment" : "—");
}

function toReceiptData(receipt: PaymentReceipt): PaymentReceiptData {
  return {
    paymentKind: receipt.paymentKind,
    organizationName: receipt.organizationName,
    organizationReceiptLogoUrl: apiAssetUrl(receipt.organizationReceiptLogoUrl),
    membershipNo: receipt.membershipNo,
    membershipId: receipt.membershipId,
    memberName: receipt.memberName,
    paymentId: receipt.paymentId,
    receiptNumber: receipt.receiptNumber,
    paymentDate: receipt.paymentDate,
    paymentMethod: receipt.paymentMethod || null,
    paidAmount: receipt.paidAmount,
    appliedToDue: receipt.appliedToDue,
    overpaymentToCredit: receipt.overpaymentToCredit,
    remainingAfter: receipt.remainingAfter,
    outstandingAfterPayment: receipt.outstandingAfterPayment,
    creditBalanceAfterPayment: receipt.creditBalanceAfterPayment,
    note: receipt.note || null,
    collectedBy: receipt.collectedBy,
    memberQrValue: "",
  };
}

export default function PaymentsPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const view = pathname.endsWith("/history") ? "history" : "dues";

  const [dues, setDues] = useState<PaymentDue[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const limit = 20;
  const [statusFilter, setStatusFilter] = useState<DueStatus | "all">("all");
  const [dueTypeFilter, setDueTypeFilter] = useState<string>("all");
  const [searchQ, setSearchQ] = useState("");
  const [mobileSort, setMobileSort] = useState<"name" | "date" | "amount">("name");
  const [expandedDueId, setExpandedDueId] = useState<string | null>(null);
  const [dueTypes, setDueTypes] = useState<DueType[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [history, setHistory] = useState<Payment[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const historyLimit = 20;
  const [historySearchQ, setHistorySearchQ] = useState("");
  const [expandedPaymentId, setExpandedPaymentId] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState("");

  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payDue, setPayDue] = useState<PaymentDue | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payDepositAccountId, setPayDepositAccountId] = useState("");
  const [payNote, setPayNote] = useState("");
  const [paySubmitting, setPaySubmitting] = useState(false);
  const [payError, setPayError] = useState("");
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptData, setReceiptData] = useState<PaymentReceiptData | null>(null);

  const [reverseTarget, setReverseTarget] = useState<Payment | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reverseSubmitting, setReverseSubmitting] = useState(false);

  const [editDueTarget, setEditDueTarget] = useState<PaymentDue | null>(null);
  const [editDueAmount, setEditDueAmount] = useState("");
  const [editDueReason, setEditDueReason] = useState("");
  const [editDueSubmitting, setEditDueSubmitting] = useState(false);
  const [depositAccounts, setDepositAccounts] = useState<AccountingAccount[]>([]);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user?.organizationId) {
      setDueTypes([]);
      setZones([]);
      return;
    }

    api<Zone[]>("/zones", { params: { includeInactive: "true" } })
      .then(setZones)
      .catch(() => setZones([]));

    if (view !== "dues") return;

    api<DueType[]>("/due-types")
      .then((items) => setDueTypes(items.filter((item) => item.isActive)))
      .catch(() => setDueTypes([]));

    api<AccountingAccount[]>("/accounting/accounts", { params: { includeInactive: "true" } })
      .then((items) => {
        const cashBankAccounts = items.filter(
          (account) => account.accountType === "asset" && (account.assetSubtype === "cash" || account.assetSubtype === "bank") && account.isActive
        );
        setDepositAccounts(cashBankAccounts);
        const cashOnHand = cashBankAccounts.find((account) => (account as any).systemKey === "asset_cash_on_hand");
        setPayDepositAccountId((current) => current || cashOnHand?.id || cashBankAccounts[0]?.id || "");
      })
      .catch(() => setDepositAccounts([]));
  }, [user?.organizationId, view]);

  function loadDues() {
    if (!user || view !== "dues") return;
    const params: Record<string, string> = {
      page: String(page),
      limit: String(limit),
      sort: mobileSort,
    };
    if (statusFilter !== "all") params.status = statusFilter;
    if (dueTypeFilter !== "all") params.dueTypeId = dueTypeFilter;
    if (searchQ.trim()) params.q = searchQ.trim();
    setLoading(true);
    api<{ items: PaymentDue[]; total: number }>("/payments/dues", { params })
      .then((r) => {
        setDues(r.items);
        setTotal(r.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadDues();
  }, [user, page, statusFilter, dueTypeFilter, searchQ, mobileSort, view]);

  function loadHistory() {
    if (!user || view !== "history") return;
    setHistoryLoading(true);
    api<{ items: Payment[]; total: number }>("/payments/history", {
      params: {
        page: String(historyPage),
        limit: String(historyLimit),
        ...(historySearchQ.trim() ? { q: historySearchQ.trim() } : {}),
      },
    })
      .then((r) => {
        setHistory(r.items);
        setHistoryTotal(r.total);
      })
      .catch(() => {
        setHistory([]);
        setHistoryTotal(0);
      })
      .finally(() => setHistoryLoading(false));
  }

  useEffect(() => {
    loadHistory();
  }, [user, historyPage, historySearchQ, view]);

  async function openReceiptForPayment(paymentId: string) {
    try {
      const receipt = await api<PaymentReceipt>(`/payments/receipt/${paymentId}`);
      setReceiptData({
        ...toReceiptData(receipt),
        memberQrValue: `${window.location.origin}/members/${receipt.membershipId}`,
      });
      setReceiptOpen(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load receipt";
      toast({
        variant: "destructive",
        title: "Failed to load receipt",
        description: msg,
      });
    }
  }

  async function handleGenerateDues() {
    setGenerating(true);
    setGenResult("");
    try {
      const r = await api<{ created: number; skipped: number; period: string }>(
        "/payments/generate-dues",
        { method: "POST" }
      );
      setGenResult(`${r.period}: ${r.created} ${t("payments.created")}, ${r.skipped} ${t("payments.skipped")}`);
      toast({
        title: "Dues generated",
        description: `${r.period}: ${r.created} created, ${r.skipped} skipped.`,
      });
      loadDues();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("common.saveFailed");
      setGenResult(msg);
      toast({
        variant: "destructive",
        title: "Failed to generate dues",
        description: msg,
      });
    } finally {
      setGenerating(false);
    }
  }

  async function handleMarkOverdue() {
    try {
      const r = await api<{ updated: number }>("/payments/mark-overdue", {
        method: "POST",
      });
      setGenResult(`${r.updated} ${t("payments.duesMarkedOverdue")}`);
      toast({
        title: "Overdue updated",
        description: `${r.updated} dues marked overdue.`,
      });
      loadDues();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("payments.failedToMarkOverdue");
      setGenResult(msg);
      toast({
        variant: "destructive",
        title: "Failed to mark overdue",
        description: msg,
      });
    }
  }

  function openPayDialog(due: PaymentDue) {
    const remaining = Number(due.amountDue) - Number(due.amountPaid);
    setPayDue(due);
    setPayAmount(String(remaining > 0 ? remaining.toFixed(2) : "0"));
    const cashOnHand = depositAccounts.find((account) => (account as any).systemKey === "asset_cash_on_hand");
    setPayDepositAccountId((current) => current || cashOnHand?.id || depositAccounts[0]?.id || "");
    setPayNote("");
    setPayError("");
    setPayDialogOpen(true);
  }

  async function handleRecordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payDue) return;
    setPayError("");
    const amt = parseFloat(payAmount);
    if (isNaN(amt) || amt <= 0) {
      const msg = t("payments.enterValidAmount");
      setPayError(msg);
      toast({
        variant: "destructive",
        title: "Invalid payment amount",
        description: msg,
      });
      return;
    }
    setPaySubmitting(true);
    try {
      const payment = await api<{ id: string; paymentDate: string }>("/payments", {
        method: "POST",
        body: JSON.stringify({
          paymentDueId: payDue.id,
          amount: amt,
          paymentMethod: depositAccounts.find((account) => account.id === payDepositAccountId)?.assetSubtype === "bank" ? "bank_transfer" : "cash",
          depositAccountId: payDepositAccountId || undefined,
          note: payNote.trim() || undefined,
        }),
      });
      await openReceiptForPayment(payment.id);
      setPayDialogOpen(false);
      toast({
        title: "Payment recorded",
        description: "Payment has been saved successfully.",
      });
      loadDues();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("payments.failedToRecord");
      setPayError(msg);
      toast({
        variant: "destructive",
        title: "Failed to record payment",
        description: msg,
      });
    } finally {
      setPaySubmitting(false);
    }
  }

  async function handleReversePayment() {
    if (!reverseTarget || !reverseReason.trim()) return;
    setReverseSubmitting(true);
    try {
      await api(`/payments/${reverseTarget.id}/reverse`, {
        method: "POST",
        body: JSON.stringify({ reason: reverseReason.trim() }),
      });
      toast({ title: "Payment reversed", description: "The payment has been reversed successfully." });
      setReverseTarget(null);
      setReverseReason("");
      loadHistory();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed to reverse",
        description: err instanceof Error ? err.message : "Failed to reverse payment",
      });
    } finally {
      setReverseSubmitting(false);
    }
  }

  function openEditDue(due: PaymentDue) {
    setEditDueTarget(due);
    setEditDueAmount(String(Number(due.amountDue)));
    setEditDueReason("");
  }

  async function handleEditDue() {
    if (!editDueTarget || !editDueReason.trim()) return;
    const amt = parseFloat(editDueAmount);
    if (isNaN(amt) || amt < 0) return;
    setEditDueSubmitting(true);
    try {
      await api(`/payments/dues/${editDueTarget.id}`, {
        method: "PATCH",
        body: JSON.stringify({ amountDue: amt, reason: editDueReason.trim() }),
      });
      toast({ title: "Due updated", description: "The due amount has been updated." });
      setEditDueTarget(null);
      loadDues();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed to update due",
        description: err instanceof Error ? err.message : "Failed to update",
      });
    } finally {
      setEditDueSubmitting(false);
    }
  }

  const totalPages = Math.ceil(total / limit) || 1;
  const historyTotalPages = Math.ceil(historyTotal / historyLimit) || 1;
  const zoneLabel = (areaCode?: number | null) => {
    if (areaCode === undefined || areaCode === null) return null;
    const zone = zones.find((item) => item.code === areaCode);
    return zone ? `${zone.code} - ${zone.name}` : String(areaCode);
  };
  const membershipIdOnly = (membershipNo: string | null | undefined) => {
    const normalized = membershipNo?.trim();
    if (!normalized) return null;
    const match = normalized.match(/(\d+)\s*$/);
    return match?.[1] ?? normalized;
  };
  const dueMemberDisplayName = (due: PaymentDue) =>
    due.membership?.hod?.nameWithInitials ?? due.membership?.hod?.fullName ?? due.membership?.membershipNo ?? due.membershipId;
  const dueMemberFullName = (due: PaymentDue) =>
    due.membership?.hod?.fullName ?? due.membership?.hod?.nameWithInitials ?? due.membershipId;
  const dueMemberZone = (due: PaymentDue) => zoneLabel(due.membership?.areaCode);
  const dueMemberMembershipId = (due: PaymentDue) => membershipIdOnly(due.membership?.membershipNo);
  const paymentMemberDisplayName = (payment: Payment) =>
    payment.membership?.hod?.nameWithInitials ??
    payment.membership?.hod?.fullName ??
    payment.membership?.membershipNo ??
    payment.membershipId;
  const paymentMemberFullName = (payment: Payment) =>
    payment.membership?.hod?.fullName ??
    payment.membership?.hod?.nameWithInitials ??
    payment.membershipId;
  const paymentMemberZone = (payment: Payment) => zoneLabel(payment.membership?.areaCode);
  const paymentMemberMembershipId = (payment: Payment) => membershipIdOnly(payment.membership?.membershipNo);

  const sortedDues = dues;

  const dueMonth = (dueDate: string) => {
    const date = new Date(`${dueDate.slice(0, 10)}T00:00:00`);
    return {
      month: date.toLocaleDateString("en", { month: "short" }).toUpperCase(),
      year: date.toLocaleDateString("en", { year: "2-digit" }),
    };
  };

  const dueMemberArea = (due: PaymentDue) => {
    const areaCode = due.membership?.areaCode;
    if (areaCode === undefined || areaCode === null) return null;
    return zones.find((item) => item.code === areaCode)?.name ?? `Zone ${areaCode}`;
  };

  const historyGroups = useMemo(() => {
    const groups = new Map<string, Payment[]>();
    history.forEach((payment) => {
      const key = new Date(payment.paymentDate).toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
      groups.set(key, [...(groups.get(key) ?? []), payment]);
    });
    return Array.from(groups.entries()).map(([date, payments]) => ({ date, payments }));
  }, [history]);

  const historyDateLabel = (date: string) =>
    new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "long",
      year: "numeric",
    });

  const detailDateLabel = (date: string | null | undefined, includeTime = false) => {
    if (!date) return "—";
    return new Date(date).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    });
  };

  const paymentMethodLabel = (method: Payment["paymentMethod"]) => {
    if (method === "bank_transfer") return "Bank Transfer";
    if (method === "card") return "Card";
    if (method === "other") return "Other";
    return "Cash";
  };

  const paymentAmountLabel = (payment: Payment) => {
    const amount = new Intl.NumberFormat("en-LK", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(payment.amount));
    return `${payment.isReversed ? "-" : ""}LKR ${amount}`;
  };

  const paymentPeriodLabel = (payment: Payment) => {
    const start = payment.paymentDue?.periodStart;
    const end = payment.paymentDue?.periodEnd;
    if (start || end) {
      return [detailDateLabel(start), detailDateLabel(end)].filter((value) => value !== "—").join(" - ");
    }
    const period = getPaymentPeriodLabel(payment);
    if (/^\d{4}-\d{2}$/.test(period)) {
      return new Date(`${period}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    }
    return period;
  };

  if (authLoading || !user) return <div className="p-8 text-muted-foreground">{t("common.loading")}</div>;

  const canManage = user.role === "admin" || user.role === "super_user";

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-7xl px-3 py-4 sm:p-6">
        <div className="hidden md:block">
          <Breadcrumb items={[{ label: t("dashboard.title"), href: dashboardFlowHref("payment") }, { label: view === "dues" ? "Dues Overview" : "Payment History" }]} />
        </div>

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between md:mb-5">
          <div>
            <h1 className="text-xl font-semibold text-foreground md:text-2xl">
              {view === "dues" ? "Member Dues" : "Payment History"}
            </h1>
            {view === "dues" ? <p className="mt-1 hidden text-sm text-muted-foreground md:block">Collect membership payments and manage outstanding dues.</p> : null}
          </div>
          {view === "dues" && canManage && (
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Button size="sm" variant="warning" className="h-10 sm:h-9" onClick={handleMarkOverdue}>
                <AlertTriangle className="mr-2 h-4 w-4 shrink-0" />
                {t("payments.markOverdue")}
              </Button>
              <Button size="sm" variant="generate" className="h-10 sm:h-9" onClick={handleGenerateDues} disabled={generating}>
                <WandSparkles className="mr-2 h-4 w-4 shrink-0" />
                {generating ? t("payments.generating") : t("payments.generateDues")}
              </Button>
            </div>
          )}
        </div>

        {view === "dues" && genResult && (
          <p className="text-sm mb-4 text-muted-foreground">{genResult}</p>
        )}

        {view === "dues" ? <Card className="border-0 shadow-none md:border md:shadow-sm">
          <CardHeader className="hidden border-b p-4 md:block">
            <div className="grid grid-cols-[minmax(260px,1fr)_150px_180px_170px] gap-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Search member dues"
                  placeholder="Search by name, member ID or phone"
                  value={searchQ}
                  onChange={(event) => { setSearchQ(event.target.value); setPage(1); }}
                  className="h-10 pl-10 text-sm"
                />
              </div>
              <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value as DueStatus | "all"); setPage(1); }}>
                <SelectTrigger className="h-10 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                </SelectContent>
              </Select>
              <Select value={dueTypeFilter} onValueChange={(value) => { setDueTypeFilter(value); setPage(1); }}>
                <SelectTrigger className="h-10 text-xs"><SelectValue placeholder="All due types" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Due Types</SelectItem>
                  {dueTypes.map((dueType) => <SelectItem key={dueType.id} value={dueType.id}>{dueType.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={mobileSort} onValueChange={(value) => setMobileSort(value as typeof mobileSort)}>
                <SelectTrigger className="h-10 text-xs">
                  <span className="flex items-center gap-2"><ArrowUpDown className="h-3.5 w-3.5" /><SelectValue /></span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Sort: Name A-Z</SelectItem>
                  <SelectItem value="date">Sort: Newest</SelectItem>
                  <SelectItem value="amount">Sort: Amount</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-2"><UserRound className="h-4 w-4" />{total} Results</span>
              <button type="button" onClick={loadDues} className="flex items-center gap-2 transition-colors hover:text-foreground">
                <RefreshCw className="h-4 w-4" />Refresh
              </button>
            </div>
          </CardHeader>
          <CardContent className="p-0 md:p-6 md:pt-0">
            <div className="mb-3 space-y-3 md:hidden">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Search member dues"
                  placeholder="Search by name, member ID or phone"
                  value={searchQ}
                  onChange={(event) => {
                    setSearchQ(event.target.value);
                    setPage(1);
                  }}
                  className="h-11 pl-10 pr-11 text-xs"
                />
                <button
                  type="button"
                  aria-label="Scan member QR code"
                  title="Scan member QR code"
                  onClick={() => router.push("/?scan=membership")}
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center text-emerald-600"
                >
                  <QrCode className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Select
                  value={statusFilter}
                  onValueChange={(value) => {
                    setStatusFilter(value as DueStatus | "all");
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="h-10 min-w-0 px-2 text-[11px]">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <ListFilter className="h-3.5 w-3.5 shrink-0" />
                      <SelectValue />
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Status: All</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="partial">Partial</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value={dueTypeFilter}
                  onValueChange={(value) => {
                    setDueTypeFilter(value);
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="h-10 min-w-0 px-2 text-[11px]">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Bookmark className="h-3.5 w-3.5 shrink-0" />
                      <SelectValue placeholder="Type: All" />
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Type: All</SelectItem>
                    {dueTypes.map((dueType) => (
                      <SelectItem key={dueType.id} value={dueType.id}>{dueType.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={mobileSort} onValueChange={(value) => setMobileSort(value as typeof mobileSort)}>
                  <SelectTrigger className="h-10 min-w-0 px-2 text-[11px]">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <ArrowUpDown className="h-3.5 w-3.5 shrink-0" />
                      <SelectValue />
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name">Name A-Z</SelectItem>
                    <SelectItem value="date">Newest</SelectItem>
                    <SelectItem value="amount">Amount</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between px-0.5 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" />{total} Results</span>
                <button type="button" onClick={loadDues} className="flex items-center gap-1.5 hover:text-foreground">
                  <RefreshCw className="h-3.5 w-3.5" />Refresh
                </button>
              </div>
            </div>

            {loading ? (
              <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
            ) : dues.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("payments.noDuesFound")}
              </p>
            ) : (
              <>
                <div className="space-y-2 md:hidden">
                  {sortedDues.map((d) => {
                    const remaining = Number(d.amountDue) - Number(d.amountPaid);
                    const month = dueMonth(d.dueDate);
                    const expanded = expandedDueId === d.id;
                    return (
                      <div key={d.id} className="overflow-hidden rounded-md border bg-card shadow-sm">
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={() => setExpandedDueId(expanded ? null : d.id)}
                          className="grid w-full grid-cols-[48px_minmax(0,1fr)_auto] gap-3 p-3 text-left"
                        >
                          <span className="flex h-14 w-12 flex-col items-center justify-center rounded-md bg-slate-100 text-slate-600">
                            <span className="text-[10px] font-semibold">{month.month}</span>
                            <span className="text-xl font-bold leading-5">{month.year}</span>
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-foreground">{dueMemberDisplayName(d)}</span>
                            <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                              {dueMemberMembershipId(d) ? `ID ${dueMemberMembershipId(d)}` : "No member ID"}
                              {dueMemberArea(d) ? `  •  ${dueMemberArea(d)}` : ""}
                            </span>
                            <span className="mt-1 block truncate text-xs font-medium text-foreground">
                              {d.dueType?.name ?? getPaymentDueTitle(d)}
                            </span>
                            <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                              Paid Rs.{Number(d.amountPaid).toFixed(2)} of Rs.{Number(d.amountDue).toFixed(2)}
                            </span>
                          </span>
                          <span className="flex min-w-[70px] flex-col items-end justify-between self-stretch">
                            <span className={`rounded px-2 py-1 text-[9px] font-semibold uppercase ${statusColors[d.status] ?? ""}`}>
                              {t(`payments.${d.status}`)}
                            </span>
                            <span className="flex items-center gap-2">
                              <span className="text-base font-semibold tabular-nums text-foreground">Rs.{remaining.toFixed(2)}</span>
                              <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
                            </span>
                          </span>
                        </button>

                        {expanded ? (
                          <div className="mx-3 mb-3 rounded-md border bg-card p-3">
                            <div className="flex items-center justify-between gap-3 text-xs">
                              <span className="flex items-center gap-1.5 text-muted-foreground"><UserRound className="h-3.5 w-3.5" />Full Name</span>
                              <span className="text-right font-medium">{dueMemberFullName(d)}</span>
                            </div>
                            <div className="mt-3 space-y-2">
                              {d.status !== "paid" && remaining > 0 ? (
                                <Button size="sm" variant="cashIn" className="w-full" onClick={() => openPayDialog(d)}>
                                  <ArrowDownToLine className="mr-2 h-4 w-4" />Receive Payment
                                </Button>
                              ) : null}
                              <div className={`grid gap-2 ${canManage && d.status !== "paid" ? "grid-cols-2" : "grid-cols-1"}`}>
                                {canManage && d.status !== "paid" ? (
                                  <Button size="sm" variant="neutralOutline" onClick={() => openEditDue(d)}>
                                    <Pencil className="mr-2 h-3.5 w-3.5" />Edit
                                  </Button>
                                ) : null}
                                <Button size="sm" variant="neutralOutline" className="border-emerald-200 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700" asChild>
                                  <Link href={`/members/${d.membershipId}`}>
                                    <UserRound className="mr-2 h-3.5 w-3.5" />Open Record
                                  </Link>
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  <p className="flex items-center gap-1.5 px-1 pt-2 text-[10px] text-muted-foreground">
                    <LockKeyhole className="h-3 w-3" />Dues are shown based on the selected filters.
                  </p>
                </div>

                <div className="hidden space-y-2 overflow-x-auto md:block">
                  {sortedDues.map((d) => {
                    const amountDue = Number(d.amountDue);
                    const amountPaid = Number(d.amountPaid);
                    const remaining = Math.max(amountDue - amountPaid, 0);
                    const progress = amountDue > 0 ? Math.min(Math.max((amountPaid / amountDue) * 100, 0), 100) : 0;
                    const month = dueMonth(d.dueDate);
                    const tone = dueStatusTones[d.status];
                    const dueType = d.dueType?.name ?? getPaymentDueSubtitle(d) ?? getPaymentDueTitle(d);
                    return (
                      <div key={d.id} className="min-w-[1060px] rounded-lg border bg-card shadow-sm transition-shadow hover:shadow-md">
                        <div className="grid grid-cols-[64px_minmax(190px,1.35fr)_minmax(120px,.75fr)_minmax(190px,1.2fr)_90px_115px_150px] items-center gap-4 px-4 py-3">
                          <div className={`flex h-14 w-14 flex-col items-center justify-center rounded-lg border ${tone.tile}`}>
                            <span className="text-[11px] font-semibold leading-none">{month.month}</span>
                            <span className="mt-1 text-xl font-bold leading-none">{month.year}</span>
                          </div>

                          <div className="min-w-0 border-r pr-4">
                            <Link href={`/members/${d.membershipId}`} className="block truncate text-sm font-semibold text-foreground hover:text-primary hover:underline">
                              {dueMemberDisplayName(d)}
                            </Link>
                            <p className="mt-1 truncate text-[11px] text-muted-foreground">
                              {dueMemberArea(d) ?? "Location not set"}
                              {dueMemberMembershipId(d) ? `  •  ID: ${dueMemberMembershipId(d)}` : ""}
                            </p>
                            <p className="mt-1 truncate text-xs text-foreground" title={dueMemberFullName(d)}>{dueMemberFullName(d)}</p>
                          </div>

                          <div className="min-w-0 border-r pr-4">
                            <p className="text-[10px] font-medium text-muted-foreground">Due Type</p>
                            <p className={`mt-1 truncate text-xs font-semibold ${tone.text}`} title={dueType}>{dueType}</p>
                          </div>

                          <div className="min-w-0">
                            <p className="text-[10px] font-medium text-muted-foreground">Payment Progress</p>
                            <p className="mt-1 truncate text-[11px] font-medium text-foreground">Paid Rs.{amountPaid.toFixed(2)} of Rs.{amountDue.toFixed(2)}</p>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200" aria-label={`${progress.toFixed(0)}% paid`}>
                              <div className={`h-full rounded-full ${tone.progress}`} style={{ width: `${progress}%` }} />
                            </div>
                          </div>

                          <div>
                            <p className="text-[10px] font-medium text-muted-foreground">Status</p>
                            <span className={`mt-1.5 inline-flex rounded-md px-2 py-1 text-[10px] font-semibold uppercase ${tone.badge}`}>{t(`payments.${d.status}`)}</span>
                          </div>

                          <div>
                            <p className="text-[10px] font-medium text-muted-foreground">Remaining</p>
                            <p className={`mt-1 text-lg font-bold tabular-nums ${tone.text}`}>Rs.{remaining.toFixed(2)}</p>
                          </div>

                          <div className="flex items-center justify-end gap-2">
                            {d.status !== "paid" && remaining > 0 ? (
                              <Button size="sm" variant="cashIn" className="h-8 px-3 text-xs" onClick={() => openPayDialog(d)}>
                                <Banknote className="mr-1.5 h-3.5 w-3.5" />Receive
                              </Button>
                            ) : null}
                            {canManage && d.status !== "paid" ? (
                              <Button size="sm" variant="neutralOutline" className="h-8 px-2.5 text-xs" onClick={() => openEditDue(d)} title="Edit Due">
                                <Pencil className="mr-1.5 h-3.5 w-3.5" />Edit
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <p className="flex items-center gap-1.5 px-1 pt-2 text-[10px] text-muted-foreground">
                    <LockKeyhole className="h-3 w-3" />Dues are shown based on the selected filters.
                  </p>
                </div>

                <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
                  <span>
                    Showing {total === 0 ? 0 : (page - 1) * limit + 1} to {Math.min(page * limit, total)} of {total} results
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span>
                      {t("distributions.page")} {page} {t("distributions.of")} {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card> : null}

        {view === "history" ? <Card className="border-0 shadow-none md:border md:shadow-sm">
          <CardHeader className="px-0 pb-3 md:px-6 md:pb-2">
            <CardTitle className="hidden text-sm font-medium md:block">Payment History</CardTitle>
            <form
              className="relative mt-0 flex gap-2 md:mt-2"
              onSubmit={(e) => {
                e.preventDefault();
                setHistoryPage(1);
              }}
            >
              <Input
                placeholder="Search by member, membership no, or period..."
                value={historySearchQ}
                onChange={(e) => {
                  setHistorySearchQ(e.target.value);
                  setHistoryPage(1);
                }}
                className="h-11 pl-10 text-xs md:h-10 md:max-w-sm md:text-sm"
              />
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </form>
          </CardHeader>
          <CardContent className="p-0 md:p-6 md:pt-0">
            {historyLoading ? (
              <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
            ) : history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
            ) : (
              <>
                <div className="space-y-2 md:hidden">
                  {historyGroups.map((group) => (
                    <section key={group.date}>
                      <div className="mb-1.5 flex items-center gap-2 bg-muted/45 px-2.5 py-2 text-xs font-medium text-foreground">
                        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                        {historyDateLabel(group.date)}
                      </div>
                      <div className="divide-y overflow-hidden rounded-md border bg-card shadow-sm">
                        {group.payments.map((payment) => {
                          const reversed = Boolean(payment.isReversed);
                          const expanded = expandedPaymentId === payment.id;
                          const memberNumber = paymentMemberMembershipId(payment);
                          return (
                            <div key={payment.id}>
                              <button
                                type="button"
                                aria-expanded={expanded}
                                onClick={() => setExpandedPaymentId(expanded ? null : payment.id)}
                                className="grid w-full grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 text-left"
                              >
                                <span className={`flex h-9 w-9 items-center justify-center rounded-full text-white ${reversed ? "bg-red-500" : "bg-emerald-600"}`}>
                                  {reversed ? <RotateCcw className="h-4 w-4" /> : <ArrowDownToLine className="h-4 w-4" />}
                                </span>
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-semibold text-foreground">
                                    {paymentMemberDisplayName(payment)}{memberNumber ? ` (${memberNumber})` : ""}
                                  </span>
                                  <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                                    Receipt #{payment.receiptNumber ?? payment.id.slice(-8).toUpperCase()}
                                  </span>
                                </span>
                                <span className="flex min-w-[82px] items-center justify-end gap-2">
                                  <span className="flex flex-col items-end">
                                    <span className={`text-sm font-semibold tabular-nums ${reversed ? "text-red-600" : "text-emerald-700"}`}>
                                      Rs. {Number(payment.amount).toFixed(2)}
                                    </span>
                                    <span className={`mt-0.5 rounded-full px-2 py-0.5 text-[9px] font-medium ${reversed ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                                      {reversed ? "Reversed" : "Paid"}
                                    </span>
                                  </span>
                                  <ChevronDown className={`h-4 w-4 shrink-0 text-primary transition-transform ${expanded ? "rotate-180" : ""}`} />
                                </span>
                              </button>

                              {expanded ? (
                                <div className="mx-3 mb-3 border-t pt-2">
                                  <div className="divide-y text-xs">
                                    <PaymentHistoryDetail icon={UserRound} label="Full Name" value={paymentMemberFullName(payment)} />
                                    <PaymentHistoryDetail icon={UserRoundCheck} label="Collected By" value={payment.collectedBy?.email ?? "—"} />
                                    <PaymentHistoryDetail icon={CalendarDays} label="Payment Period" value={paymentPeriodLabel(payment)} />
                                  </div>

                                  {reversed ? (
                                    <div className="mt-2 border-t pt-2">
                                      <p className="mb-1 text-[10px] font-semibold text-muted-foreground">Reversal Details</p>
                                      <div className="divide-y text-xs">
                                        <PaymentHistoryDetail icon={UserRoundCheck} label="Reversed By" value={payment.reversedBy?.email ?? "—"} />
                                        <PaymentHistoryDetail icon={Pencil} label="Reason" value={payment.reversalReason ?? "—"} />
                                        <PaymentHistoryDetail icon={CalendarDays} label="Reversed On" value={detailDateLabel(payment.reversedAt, true)} />
                                      </div>
                                    </div>
                                  ) : null}

                                  <div className={`mt-2 grid gap-2 ${canManage && !reversed ? "grid-cols-2" : "grid-cols-1"}`}>
                                    <Button size="sm" variant="neutralOutline" className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800" onClick={() => openReceiptForPayment(payment.id)}>
                                      <ReceiptText className="mr-2 h-3.5 w-3.5" />Receipt
                                    </Button>
                                    {canManage && !reversed ? (
                                      <Button size="sm" variant="dangerOutline" onClick={() => { setReverseTarget(payment); setReverseReason(""); }}>
                                        <RotateCcw className="mr-2 h-3.5 w-3.5" />Reverse
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>

                <div className="hidden space-y-3 overflow-x-auto pb-1 md:block">
                  {historyGroups.map((group) => (
                    <section key={group.date} className="min-w-[980px] overflow-hidden rounded-lg border bg-card shadow-sm">
                      <div className="flex items-center justify-between border-b bg-slate-50 px-4 py-2.5 text-xs">
                        <div className="flex items-center gap-2 font-semibold text-slate-700">
                          <CalendarDays className="h-4 w-4 text-slate-500" />
                          {historyDateLabel(group.date)}
                        </div>
                        <span className="text-muted-foreground">{group.payments.length} {group.payments.length === 1 ? "transaction" : "transactions"}</span>
                      </div>

                      <div className="grid min-w-[980px] grid-cols-[64px_minmax(220px,1.5fr)_140px_150px_150px_110px_40px] items-center gap-3 border-b bg-muted/20 px-4 py-2 text-[10px] font-medium text-muted-foreground">
                        <span>Transaction</span>
                        <span>Member Details</span>
                        <span>Receipt No.</span>
                        <span>Payment Method</span>
                        <span className="text-right">Amount (LKR)</span>
                        <span className="text-center">Status</span>
                        <span />
                      </div>

                      <div className="divide-y">
                        {group.payments.map((payment) => {
                          const reversed = Boolean(payment.isReversed);
                          const expanded = expandedPaymentId === payment.id;
                          const memberNumber = paymentMemberMembershipId(payment);
                          const zone = paymentMemberZone(payment);
                          const MethodIcon = payment.paymentMethod === "bank_transfer"
                            ? Landmark
                            : payment.paymentMethod === "card"
                              ? CreditCard
                              : Banknote;
                          return (
                            <div key={payment.id} className="bg-card">
                              <div
                                className="grid w-full min-w-[980px] grid-cols-[64px_minmax(220px,1.5fr)_140px_150px_150px_110px_40px] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/20"
                              >
                                <span className={`flex h-9 w-9 items-center justify-center rounded-full text-white shadow-sm ${reversed ? "bg-red-500" : "bg-emerald-600"}`}>
                                  {reversed ? <RotateCcw className="h-4 w-4" /> : <ArrowDownToLine className="h-4 w-4" />}
                                </span>
                                <span className="min-w-0">
                                  <Link
                                    href={`/members/${payment.membershipId}`}
                                    className="block truncate text-sm font-semibold text-foreground hover:text-primary hover:underline"
                                  >
                                    {paymentMemberDisplayName(payment)}{memberNumber ? ` (${memberNumber})` : ""}
                                  </Link>
                                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                                    {zone ? `Zone ${zone}` : "Location not set"}
                                  </span>
                                </span>
                                <span className="font-mono text-xs text-foreground">{payment.receiptNumber ?? payment.id.slice(-8).toUpperCase()}</span>
                                <span className="flex items-center gap-2 text-xs text-foreground">
                                  <MethodIcon className="h-4 w-4 text-muted-foreground" />
                                  {paymentMethodLabel(payment.paymentMethod)}
                                </span>
                                <span className={`text-right text-sm font-bold tabular-nums ${reversed ? "text-red-600" : "text-emerald-700"}`}>
                                  {paymentAmountLabel(payment)}
                                </span>
                                <span className="text-center">
                                  <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${reversed ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                                    {reversed ? "Reversed" : "Paid"}
                                  </span>
                                </span>
                                <button
                                  type="button"
                                  aria-expanded={expanded}
                                  aria-label={expanded ? "Collapse transaction details" : "Expand transaction details"}
                                  onClick={() => setExpandedPaymentId(expanded ? null : payment.id)}
                                  className="flex h-8 w-8 items-center justify-center justify-self-end rounded-md text-primary transition hover:bg-primary/10"
                                >
                                  <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
                                </button>
                              </div>

                              {expanded ? (
                                <div className={`mx-3 mb-3 rounded-md border-l-2 px-4 py-3 ${reversed ? "border-red-400 bg-red-50/30" : "border-emerald-500 bg-emerald-50/25"}`}>
                                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] items-center gap-5">
                                    <PaymentHistoryDetail icon={UserRound} label="Full Name" value={paymentMemberFullName(payment)} />
                                    <PaymentHistoryDetail icon={UserRoundCheck} label="Collected By" value={payment.collectedBy?.email ?? "—"} />
                                    <PaymentHistoryDetail icon={CalendarDays} label="Payment Period" value={paymentPeriodLabel(payment)} />
                                    <div className="flex justify-end gap-2">
                                      <Button size="sm" variant="neutralOutline" onClick={() => openReceiptForPayment(payment.id)}>
                                        <ReceiptText className="mr-2 h-3.5 w-3.5" />Receipt
                                      </Button>
                                      {canManage && !reversed ? (
                                        <Button size="sm" variant="dangerOutline" onClick={() => { setReverseTarget(payment); setReverseReason(""); }}>
                                          <RotateCcw className="mr-2 h-3.5 w-3.5" />Reverse
                                        </Button>
                                      ) : null}
                                    </div>
                                  </div>

                                  {reversed ? (
                                    <div className="mt-3 border-t border-red-100 pt-3">
                                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-red-600">Reversal Details</p>
                                      <div className="grid grid-cols-3 gap-5">
                                        <PaymentHistoryDetail icon={UserRoundCheck} label="Reversed By" value={payment.reversedBy?.email ?? "—"} />
                                        <PaymentHistoryDetail icon={Pencil} label="Reason" value={payment.reversalReason ?? "—"} />
                                        <PaymentHistoryDetail icon={CalendarDays} label="Reversed On" value={detailDateLabel(payment.reversedAt, true)} />
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>

                <div className="flex items-center justify-between text-sm text-muted-foreground mt-4">
                  <span>{historyTotal} payments</span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={historyPage <= 1}
                      onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span>
                      {t("distributions.page")} {historyPage} {t("distributions.of")} {historyTotalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={historyPage >= historyTotalPages}
                      onClick={() => setHistoryPage((p) => Math.min(historyTotalPages, p + 1))}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card> : null}
      </main>

      <RecordPaymentDialog
        open={payDialogOpen}
        onOpenChange={setPayDialogOpen}
        due={payDue}
        amount={payAmount}
        onAmountChange={setPayAmount}
        depositAccounts={depositAccounts}
        depositAccountId={payDepositAccountId}
        onDepositAccountChange={setPayDepositAccountId}
        note={payNote}
        onNoteChange={setPayNote}
        error={payError}
        submitting={paySubmitting}
        onSubmit={handleRecordPayment}
        title={t("payments.recordPayment")}
        submitLabel="Receive"
        submittingLabel={t("payments.recording")}
        cancelLabel={t("common.cancel")}
      />

      <PaymentReceiptDialog
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
        receipt={receiptData}
      />

      {/* Reverse Payment Dialog */}
      <Dialog open={!!reverseTarget} onOpenChange={(open) => !open && setReverseTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Reverse Payment
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-muted/50 border p-4 space-y-1">
              <p className="text-sm font-semibold">
                {reverseTarget?.membership?.hod?.fullName ?? reverseTarget?.membership?.membershipNo ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {reverseTarget?.membership?.membershipNo} · {getPaymentPeriodLabel(reverseTarget)}
              </p>
              <p className="text-sm font-bold tabular-nums mt-1">
                Amount: {reverseTarget ? Number(reverseTarget.amount).toFixed(2) : ""}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Reason for reversal *</Label>
              <Select
                value={reverseReason}
                onValueChange={setReverseReason}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a reversal reason" />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_REVERSAL_REASONS.map((reason) => (
                    <SelectItem key={reason} value={reason}>{reason}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              This will undo the payment and adjust the due balance. This action is recorded in the audit trail.
            </p>
            <div className="flex gap-2">
              <Button
                variant="dangerOutline"
                onClick={handleReversePayment}
                disabled={reverseSubmitting || !reverseReason.trim()}
                className="flex-1"
              >
                {reverseSubmitting ? "Reversing…" : "Confirm Reversal"}
              </Button>
              <Button variant="dangerOutline" onClick={() => setReverseTarget(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Due Dialog */}
      <Dialog open={!!editDueTarget} onOpenChange={(open) => !open && setEditDueTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-primary" />
              Edit Due Amount
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-muted/50 border p-4 space-y-1">
              <p className="text-sm font-semibold">
                {editDueTarget?.membership?.hod?.fullName ?? editDueTarget?.membership?.membershipNo ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                Period: {editDueTarget?.period} · Current Due: {editDueTarget ? Number(editDueTarget.amountDue).toFixed(2) : ""} · Paid: {editDueTarget ? Number(editDueTarget.amountPaid).toFixed(2) : ""}
              </p>
            </div>
            <div className="space-y-2">
              <Label>New Due Amount *</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={editDueAmount}
                onChange={(e) => setEditDueAmount(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Reason for change *</Label>
              <Input
                value={editDueReason}
                onChange={(e) => setEditDueReason(e.target.value)}
                placeholder="e.g. Fee adjustment, correction..."
                required
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleEditDue}
                disabled={editDueSubmitting || !editDueReason.trim() || !editDueAmount}
                className="flex-1"
              >
                {editDueSubmitting ? "Saving…" : "Update Due"}
              </Button>
              <Button variant="dangerOutline" onClick={() => setEditDueTarget(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
