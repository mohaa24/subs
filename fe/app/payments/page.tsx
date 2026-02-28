"use client";

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
      setGenResult(`${r.period}: ${r.created} created, ${r.skipped} skipped`);
      loadDues();
    } catch (err) {
      setGenResult(err instanceof Error ? err.message : "Failed");
    } finally {
      setGenerating(false);
    }
  }

  async function handleMarkOverdue() {
    try {
      const r = await api<{ updated: number }>("/payments/mark-overdue", {
        method: "POST",
      });
      setGenResult(`${r.updated} dues marked overdue`);
      loadDues();
    } catch {
      setGenResult("Failed to mark overdue");
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
      setPayError("Enter a valid amount.");
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
      setPayError(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setPaySubmitting(false);
    }
  }

  const totalPages = Math.ceil(total / limit) || 1;

  if (authLoading || !user) return <div className="p-8 text-muted-foreground">Loading…</div>;

  const canManage = user.role === "admin" || user.role === "super_user";

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="p-6 max-w-5xl mx-auto">
        <Breadcrumb items={[{ label: "Dashboard", href: "/" }, { label: "Payments" }]} />

        <div className="flex items-center justify-between mb-5">
          <h1 className="text-xl font-semibold text-foreground">Payments &amp; Dues</h1>
          {canManage && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleMarkOverdue}>
                Mark overdue
              </Button>
              <Button size="sm" onClick={handleGenerateDues} disabled={generating}>
                {generating ? "Generating…" : "Generate monthly dues"}
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
              <CardTitle className="text-sm font-medium">Dues Overview</CardTitle>
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
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : dues.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No dues found. Use "Generate monthly dues" to create dues for the current month.
              </p>
            ) : (
              <>
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2.5 font-medium">Member</th>
                        <th className="text-left p-2.5 font-medium">Period</th>
                        <th className="text-right p-2.5 font-medium">Due</th>
                        <th className="text-right p-2.5 font-medium">Paid</th>
                        <th className="text-right p-2.5 font-medium">Remaining</th>
                        <th className="text-center p-2.5 font-medium">Status</th>
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
                                {d.status}
                              </span>
                            </td>
                            <td className="p-2.5 text-right">
                              {d.status !== "paid" && remaining > 0 && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openPayDialog(d)}
                                >
                                  Pay
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
                  <span>{total} dues</span>
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
                      Page {page} of {totalPages}
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
              Record Payment – {payDue?.membership?.membershipNo} ({payDue?.period})
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRecordPayment} className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Due: {payDue ? Number(payDue.amountDue).toFixed(2) : ""} | Paid so far:{" "}
              {payDue ? Number(payDue.amountPaid).toFixed(2) : ""} | Remaining:{" "}
              {payDue ? (Number(payDue.amountDue) - Number(payDue.amountPaid)).toFixed(2) : ""}
            </div>
            <div className="space-y-2">
              <Label>Amount</Label>
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
              <Label>Note (optional)</Label>
              <Input
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                placeholder="e.g. Cash, bank transfer…"
              />
            </div>
            {payError && <p className="text-sm text-destructive">{payError}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={paySubmitting}>
                {paySubmitting ? "Recording…" : "Record Payment"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setPayDialogOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
