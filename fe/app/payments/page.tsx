"use client";

import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type PaymentDue, type DueStatus } from "@/lib/api";
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
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Header } from "@/components/header";
import { Breadcrumb } from "@/components/breadcrumb";

const statusColors: Record<string, string> = {
  paid: "bg-green-100 text-green-800",
  partial: "bg-yellow-100 text-yellow-800",
  pending: "bg-gray-100 text-gray-800",
  overdue: "bg-red-100 text-red-800",
};

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

  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState("");

  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payDue, setPayDue] = useState<PaymentDue | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");
  const [paySubmitting, setPaySubmitting] = useState(false);
  const [payError, setPayError] = useState("");

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
  }, [user, page, statusFilter]);

  async function handleGenerateDues() {
    setGenerating(true);
    setGenResult("");
    try {
      const r = await api<{ created: number; skipped: number; period: string }>(
        "/payments/generate-dues",
        { method: "POST" }
      );
      setGenResult(`${r.period}: ${r.created} ${t("payments.created")}, ${r.skipped} ${t("payments.skipped")}`);
      loadDues();
    } catch (err) {
      setGenResult(err instanceof Error ? err.message : t("common.saveFailed"));
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
      loadDues();
    } catch {
      setGenResult(t("payments.failedToMarkOverdue"));
    }
  }

  function openPayDialog(due: PaymentDue) {
    const remaining = Number(due.amountDue) - Number(due.amountPaid);
    setPayDue(due);
    setPayAmount(String(remaining > 0 ? remaining.toFixed(2) : "0"));
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
      setPayError(t("payments.enterValidAmount"));
      return;
    }
    setPaySubmitting(true);
    try {
      await api("/payments", {
        method: "POST",
        body: JSON.stringify({
          paymentDueId: payDue.id,
          amount: amt,
          note: payNote || undefined,
        }),
      });
      setPayDialogOpen(false);
      loadDues();
    } catch (err) {
      setPayError(err instanceof Error ? err.message : t("payments.failedToRecord"));
    } finally {
      setPaySubmitting(false);
    }
  }

  const totalPages = Math.ceil(total / limit) || 1;

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
                <div className="rounded-md border overflow-x-auto">
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
                                className="text-primary hover:underline"
                              >
                                {d.membership?.membershipNo ?? d.membershipId}
                              </Link>
                              {d.membership?.hod && (
                                <span className="text-muted-foreground ml-1 text-xs">
                                  ({d.membership.hod.fullName})
                                </span>
                              )}
                            </td>
                            <td className="p-2.5">{d.period}</td>
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
                              {d.status !== "paid" && remaining > 0 && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openPayDialog(d)}
                                >
                                  {t("payments.makePayment")}
                                </Button>
                              )}
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
      </main>

      {/* Record payment dialog */}
      <Dialog open={payDialogOpen} onOpenChange={setPayDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("payments.recordPayment")} – {payDue?.membership?.membershipNo} ({payDue?.period})
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRecordPayment} className="space-y-4">
            <div className="text-sm text-muted-foreground">
              {t("payments.amountDue")}: {payDue ? Number(payDue.amountDue).toFixed(2) : ""} | {t("payments.paidSoFar")}:{" "}
              {payDue ? Number(payDue.amountPaid).toFixed(2) : ""} | {t("payments.remaining")}:{" "}
              {payDue ? (Number(payDue.amountDue) - Number(payDue.amountPaid)).toFixed(2) : ""}
            </div>
            <div className="space-y-2">
              <Label>{t("payments.amount")}</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>{t("payments.noteOptional")}</Label>
              <Input
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                placeholder={t("payments.notePlaceholder")}
              />
            </div>
            {payError && <p className="text-sm text-destructive">{payError}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={paySubmitting}>
                {paySubmitting ? t("payments.recording") : t("payments.recordPayment")}
              </Button>
              <Button type="button" variant="outline" onClick={() => setPayDialogOpen(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
