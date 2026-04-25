"use client";

import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type Payment, type PaymentDue, type PaymentReceipt, type DueStatus } from "@/lib/api";
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
import { ChevronLeft, ChevronRight, Search, RotateCcw, Pencil, AlertTriangle } from "lucide-react";
import { Header } from "@/components/header";
import { Breadcrumb } from "@/components/breadcrumb";
import { toast } from "@/hooks/use-toast";
import { getPaymentDueSubtitle, getPaymentDueTitle } from "@/lib/payment-due";
import {
  RecordPaymentDialog,
  type PaymentMethod,
  getPaymentMethodLabel,
} from "@/components/record-payment-dialog";
import {
  PaymentReceiptDialog,
  type PaymentReceiptData,
} from "@/components/payment-receipt-dialog";

const statusColors: Record<string, string> = {
  paid: "bg-green-100 text-green-800",
  partial: "bg-yellow-100 text-yellow-800",
  pending: "bg-gray-100 text-gray-800",
  overdue: "bg-red-100 text-red-800",
};

function getPaymentPeriodLabel(payment: Payment | null) {
  if (!payment) return "—";
  return payment.paymentDue?.period ?? (payment.paymentKind === "credit" ? "Credit Payment" : "—");
}

export default function PaymentsPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [dues, setDues] = useState<PaymentDue[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const limit = 20;
  const [statusFilter, setStatusFilter] = useState<DueStatus | "all">("all");
  const [searchQ, setSearchQ] = useState("");
  const [history, setHistory] = useState<Payment[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const historyLimit = 20;

  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState("");

  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payDue, setPayDue] = useState<PaymentDue | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
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

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  function loadDues() {
    if (!user) return;
    const params: Record<string, string> = {
      page: String(page),
      limit: String(limit),
    };
    if (statusFilter !== "all") params.status = statusFilter;
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
  }, [user, page, statusFilter, searchQ]);

  function loadHistory() {
    if (!user) return;
    setHistoryLoading(true);
    api<{ items: Payment[]; total: number }>("/payments/history", {
      params: { page: String(historyPage), limit: String(historyLimit) },
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
  }, [user, historyPage]);

  async function openReceiptForPayment(paymentId: string) {
    try {
      const receipt = await api<PaymentReceipt>(`/payments/receipt/${paymentId}`);
      setReceiptData({
        paymentKind: receipt.paymentKind,
        organizationName: receipt.organizationName,
        membershipNo: receipt.membershipNo,
        membershipId: receipt.membershipId,
        memberName: receipt.memberName,
        period: receipt.period,
        paymentId: receipt.paymentId,
        paymentDate: receipt.paymentDate,
        paidAmount: receipt.paidAmount,
        appliedToDue: receipt.appliedToDue,
        overpaymentToCredit: receipt.overpaymentToCredit,
        remainingAfter: receipt.remainingAfter,
        note: receipt.note || null,
        collectedBy: receipt.collectedBy,
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
      loadHistory();
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
    setPayMethod("cash");
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
      const methodLabel = getPaymentMethodLabel(payMethod);
      const combinedNote = [methodLabel, payNote].filter(Boolean).join(" — ");
      const payment = await api<{ id: string; paymentDate: string }>("/payments", {
        method: "POST",
        body: JSON.stringify({
          paymentDueId: payDue.id,
          amount: amt,
          note: combinedNote || undefined,
        }),
      });
      const amountDue = Number(payDue.amountDue);
      const amountPaidBefore = Number(payDue.amountPaid);
      const remainingBefore = Math.max(0, amountDue - amountPaidBefore);
      const appliedToDue = Math.min(amt, remainingBefore);
      const overpaymentToCredit = Math.max(0, amt - appliedToDue);
      const remainingAfter = Math.max(0, remainingBefore - appliedToDue);
      setReceiptData({
        paymentKind: "due",
        organizationName: user?.organization?.name || "Organization",
        membershipNo: payDue.membership?.membershipNo ?? payDue.membershipId,
        membershipId: payDue.membershipId,
        memberName:
          payDue.membership?.hod?.fullName ||
          payDue.membership?.hod?.nameWithInitials ||
          "",
        period: payDue.period,
        paymentId: payment.id,
        paymentDate: payment.paymentDate,
        paidAmount: amt,
        appliedToDue,
        overpaymentToCredit,
        remainingAfter,
        note: combinedNote || null,
        collectedBy: user?.email || "",
        memberQrValue: `${window.location.origin}/members/${payDue.membershipId}`,
      });
      setReceiptOpen(true);
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
      loadDues();
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

  if (authLoading || !user) return <div className="p-8 text-muted-foreground">{t("common.loading")}</div>;

  const canManage = user.role === "admin" || user.role === "super_user";

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="p-6 max-w-5xl mx-auto">
        <Breadcrumb items={[{ label: t("dashboard.title"), href: "/" }, { label: t("reports.payments") }]} />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <h1 className="text-xl font-semibold text-foreground">{t("payments.title")}</h1>
          {canManage && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleMarkOverdue}>
                {t("payments.markOverdue")}
              </Button>
              <Button size="sm" onClick={handleGenerateDues} disabled={generating}>
                {generating ? t("payments.generating") : t("payments.generateDues")}
              </Button>
            </div>
          )}
        </div>

        {genResult && (
          <p className="text-sm mb-4 text-muted-foreground">{genResult}</p>
        )}

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">{t("payments.duesOverview")}</CardTitle>
              <Select
                value={statusFilter}
                onValueChange={(v) => {
                  setStatusFilter(v as DueStatus | "all");
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-36 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("payments.allStatuses")}</SelectItem>
                  <SelectItem value="pending">{t("payments.pending")}</SelectItem>
                  <SelectItem value="partial">{t("payments.partial")}</SelectItem>
                  <SelectItem value="paid">{t("payments.paid")}</SelectItem>
                  <SelectItem value="overdue">{t("payments.overdue")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <form
              className="flex gap-2 mt-2"
              onSubmit={(e) => { e.preventDefault(); setPage(1); }}
            >
              <Input
                placeholder="Search by name or membership no..."
                value={searchQ}
                onChange={(e) => { setSearchQ(e.target.value); setPage(1); }}
                className="max-w-sm"
              />
            </form>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
            ) : dues.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("payments.noDuesFound")}
              </p>
            ) : (
              <>
                <div className="space-y-3 md:hidden">
                  {dues.map((d) => {
                    const remaining = Number(d.amountDue) - Number(d.amountPaid);
                    return (
                      <div key={d.id} className="rounded-md border p-3 bg-card">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <Link
                              href={`/members/${d.membershipId}`}
                              className="font-medium text-primary hover:underline break-words"
                            >
                              {d.membership?.hod?.fullName ?? d.membership?.membershipNo ?? d.membershipId}
                            </Link>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {d.membership?.membershipNo}
                            </p>
                          </div>
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${statusColors[d.status] ?? ""}`}
                          >
                            {t(`payments.${d.status}`)}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                          <div>
                            <p className="text-muted-foreground">{t("payments.period")}</p>
                            <p className="font-medium">{getPaymentDueTitle(d)}</p>
                            {getPaymentDueSubtitle(d) && (
                              <p className="mt-0.5 text-xs text-muted-foreground">{getPaymentDueSubtitle(d)}</p>
                            )}
                          </div>
                          <div>
                            <p className="text-muted-foreground">{t("payments.amountDue")}</p>
                            <p className="font-medium tabular-nums">{Number(d.amountDue).toFixed(2)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">{t("payments.paid")}</p>
                            <p className="font-medium tabular-nums">{Number(d.amountPaid).toFixed(2)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">{t("payments.remaining")}</p>
                            <p className="font-medium tabular-nums">{remaining.toFixed(2)}</p>
                          </div>
                        </div>
                        <div className="mt-3 flex gap-2">
                          {d.status !== "paid" && remaining > 0 && (
                            <Button size="sm" onClick={() => openPayDialog(d)}>
                              {t("payments.makePayment")}
                            </Button>
                          )}
                          {canManage && d.status !== "paid" && (
                            <Button size="sm" onClick={() => openEditDue(d)}>
                              <Pencil className="h-3.5 w-3.5 mr-1" />
                              Edit Due
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="hidden md:block rounded-md border overflow-x-auto">
                  <table className="w-full text-sm min-w-[700px]">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2.5 font-medium">{t("payments.member")}</th>
                        <th className="text-left p-2.5 font-medium">{t("payments.period")}</th>
                        <th className="text-right p-2.5 font-medium">{t("payments.amountDue")}</th>
                        <th className="text-right p-2.5 font-medium">{t("payments.paid")}</th>
                        <th className="text-right p-2.5 font-medium">{t("payments.remaining")}</th>
                        <th className="text-center p-2.5 font-medium">{t("common.status")}</th>
                        <th className="p-2.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {dues.map((d) => {
                        const remaining = Number(d.amountDue) - Number(d.amountPaid);
                        return (
                          <tr key={d.id} className="border-t">
                            <td className="p-2.5">
                              <Link
                                href={`/members/${d.membershipId}`}
                                className="font-medium text-primary hover:underline"
                              >
                                {d.membership?.hod?.fullName ?? d.membershipId}
                              </Link>
                              <p className="text-muted-foreground text-xs">
                                {d.membership?.membershipNo}
                              </p>
                            </td>
                            <td className="p-2.5">
                              <p className="font-medium">{getPaymentDueTitle(d)}</p>
                              {getPaymentDueSubtitle(d) && (
                                <p className="mt-0.5 text-xs text-muted-foreground">{getPaymentDueSubtitle(d)}</p>
                              )}
                            </td>
                            <td className="p-2.5 text-right tabular-nums">
                              {Number(d.amountDue).toFixed(2)}
                            </td>
                            <td className="p-2.5 text-right tabular-nums">
                              {Number(d.amountPaid).toFixed(2)}
                            </td>
                            <td className="p-2.5 text-right tabular-nums font-medium">
                              {remaining.toFixed(2)}
                            </td>
                            <td className="p-2.5 text-center">
                              <span
                                className={`text-xs px-2 py-0.5 rounded-full ${statusColors[d.status] ?? ""}`}
                              >
                                {t(`payments.${d.status}`)}
                              </span>
                            </td>
                            <td className="p-2.5 text-right">
                              <div className="flex items-center justify-end gap-1">
                                {d.status !== "paid" && remaining > 0 && (
                                  <Button size="sm" onClick={() => openPayDialog(d)}>
                                    {t("payments.makePayment")}
                                  </Button>
                                )}
                                {canManage && d.status !== "paid" && (
                                  <Button size="sm" className="h-8 w-8 p-0" onClick={() => openEditDue(d)} title="Edit Due">
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between text-sm text-muted-foreground mt-4">
                  <span>{total} {t("payments.dues")}</span>
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
        </Card>

        <Card className="mt-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Payment History</CardTitle>
          </CardHeader>
          <CardContent>
            {historyLoading ? (
              <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
            ) : history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
            ) : (
              <>
                <div className="space-y-3 md:hidden">
                  {history.map((p) => (
                    <div key={p.id} className="rounded-md border p-3 bg-card">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            href={`/members/${p.membershipId}`}
                            className="font-medium text-primary hover:underline break-words"
                          >
                            {p.membership?.hod?.fullName ?? p.membership?.membershipNo ?? p.membershipId}
                          </Link>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {p.membership?.membershipNo}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {new Date(p.paymentDate).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                        <div>
                          <p className="text-muted-foreground">{t("payments.period")}</p>
                          <p className="font-medium">{getPaymentPeriodLabel(p)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{t("payments.amount")}</p>
                          <p className="font-medium tabular-nums">{Number(p.amount).toFixed(2)}</p>
                        </div>
                        <div className="col-span-2">
                          <p className="text-muted-foreground">User ID</p>
                          <p className="font-medium">{p.collectedBy?.email ?? "—"}</p>
                        </div>
                      </div>
                      {(p as any).isReversed && (
                        <div className="mt-2 flex items-center gap-1 text-xs text-red-600">
                          <RotateCcw className="h-3 w-3" />
                          Reversed{(p as any).reversalReason ? `: ${(p as any).reversalReason}` : ""}
                        </div>
                      )}
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => openReceiptForPayment(p.id)}>
                          View Receipt
                        </Button>
                        {canManage && !(p as any).isReversed && (
                          <Button size="sm" variant="ghost" className="text-red-600" onClick={() => { setReverseTarget(p); setReverseReason(""); }}>
                            <RotateCcw className="h-3.5 w-3.5 mr-1" />
                            Reverse
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="hidden md:block rounded-md border overflow-x-auto">
                  <table className="w-full text-sm min-w-[800px]">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2.5 font-medium">Date</th>
                        <th className="text-left p-2.5 font-medium">{t("payments.member")}</th>
                        <th className="text-left p-2.5 font-medium">{t("payments.period")}</th>
                        <th className="text-right p-2.5 font-medium">{t("payments.amount")}</th>
                        <th className="text-left p-2.5 font-medium">User ID</th>
                        <th className="text-center p-2.5 font-medium">Status</th>
                        <th className="text-right p-2.5 font-medium">Receipt</th>
                        <th className="text-center p-2.5 font-medium w-16">Reverse</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((p) => (
                        <tr key={p.id} className={`border-t ${(p as any).isReversed ? "opacity-50" : ""}`}>
                          <td className="p-2.5">
                            {new Date(p.paymentDate).toLocaleDateString()}
                          </td>
                          <td className="p-2.5">
                            <Link
                              href={`/members/${p.membershipId}`}
                              className="font-medium text-primary hover:underline"
                            >
                              {p.membership?.hod?.fullName ?? p.membershipId}
                            </Link>
                            <p className="text-muted-foreground text-xs">
                              {p.membership?.membershipNo}
                            </p>
                          </td>
                          <td className="p-2.5">{getPaymentPeriodLabel(p)}</td>
                          <td className={`p-2.5 text-right tabular-nums ${(p as any).isReversed ? "line-through" : ""}`}>
                            {Number(p.amount).toFixed(2)}
                          </td>
                          <td className="p-2.5 text-muted-foreground">
                            {p.collectedBy?.email ?? "—"}
                          </td>
                          <td className="p-2.5">
                            {(p as any).isReversed ? (
                              <span className="text-xs text-red-600 flex items-center gap-1">
                                <RotateCcw className="h-3 w-3" />
                                Reversed
                              </span>
                            ) : null}
                          </td>
                          <td className="p-2.5 text-right">
                            <Button size="sm" variant="outline" onClick={() => openReceiptForPayment(p.id)}>
                              Receipt
                            </Button>
                          </td>
                          <td className="p-2.5 text-center">
                            {canManage && !(p as any).isReversed ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-red-600 h-8 w-8 p-0"
                                onClick={() => { setReverseTarget(p); setReverseReason(""); }}
                                title="Reverse Payment"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
        </Card>
      </main>

      <RecordPaymentDialog
        open={payDialogOpen}
        onOpenChange={setPayDialogOpen}
        due={payDue}
        amount={payAmount}
        onAmountChange={setPayAmount}
        paymentMethod={payMethod}
        onPaymentMethodChange={setPayMethod}
        note={payNote}
        onNoteChange={setPayNote}
        error={payError}
        submitting={paySubmitting}
        onSubmit={handleRecordPayment}
        title={t("payments.recordPayment")}
        submitLabel={t("payments.recordPayment")}
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
              <Input
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                placeholder="e.g. Wrong member, duplicate entry..."
                required
              />
            </div>
            <p className="text-xs text-muted-foreground">
              This will undo the payment and adjust the due balance. This action is recorded in the audit trail.
            </p>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                onClick={handleReversePayment}
                disabled={reverseSubmitting || !reverseReason.trim()}
                className="flex-1"
              >
                {reverseSubmitting ? "Reversing…" : "Confirm Reversal"}
              </Button>
              <Button variant="outline" onClick={() => setReverseTarget(null)}>
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
              <Button variant="outline" onClick={() => setEditDueTarget(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
