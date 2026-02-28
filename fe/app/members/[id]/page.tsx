"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  api,
  type Membership,
  type MembershipBalance,
  type Payment,
  type PaymentDue,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Header } from "@/components/header";
import { Breadcrumb } from "@/components/breadcrumb";
import { ChevronLeft, ChevronRight, QrCode, Download } from "lucide-react";
import QRCode from "qrcode";

const statusColors: Record<string, string> = {
  paid: "bg-green-100 text-green-800",
  partial: "bg-yellow-100 text-yellow-800",
  pending: "bg-gray-100 text-gray-800",
  overdue: "bg-red-100 text-red-800",
};

export default function MembershipDetailPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const [membership, setMembership] = useState<Membership | null>(null);
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState<MembershipBalance | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentsTotal, setPaymentsTotal] = useState(0);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const paymentsLimit = 20;

  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");

  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payDue, setPayDue] = useState<PaymentDue | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");
  const [paySubmitting, setPaySubmitting] = useState(false);
  const [payError, setPayError] = useState("");

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user || !id) return;
    api<Membership>(`/memberships/${id}`)
      .then(setMembership)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user, id]);

  const loadBalance = useCallback(() => {
    if (!user || !id) return;
    api<MembershipBalance>(`/payments/balance/${id}`)
      .then(setBalance)
      .catch(() => {});
  }, [user, id]);

  const loadPayments = useCallback(() => {
    if (!user || !id) return;
    api<{ items: Payment[]; total: number }>(`/payments/history/${id}`, {
      params: { page: String(paymentsPage), limit: String(paymentsLimit) },
    })
      .then((r) => {
        setPayments(r.items);
        setPaymentsTotal(r.total);
      })
      .catch(() => {});
  }, [user, id, paymentsPage]);

  useEffect(() => {
    loadBalance();
  }, [loadBalance]);

  useEffect(() => {
    loadPayments();
  }, [loadPayments]);

  async function generateQr() {
    const url = `${window.location.origin}/members/${id}`;
    const dataUrl = await QRCode.toDataURL(url, {
      width: 400,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    });
    setQrDataUrl(dataUrl);
    setQrOpen(true);
  }

  function downloadQr() {
    if (!qrDataUrl || !membership) return;
    const link = document.createElement("a");
    link.download = `${membership.membershipNo}-qr.png`;
    link.href = qrDataUrl;
    link.click();
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
      loadBalance();
      loadPayments();
    } catch (err) {
      setPayError(
        err instanceof Error ? err.message : "Failed to record payment"
      );
    } finally {
      setPaySubmitting(false);
    }
  }

  if (authLoading || !user)
    return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (loading)
    return <div className="p-8 text-muted-foreground">Loading membership…</div>;
  if (!membership)
    return <div className="p-8 text-muted-foreground">Not found.</div>;

  const yesNo = (v: boolean) => (v ? "Yes" : "No");
  const totalPaymentPages = Math.ceil(paymentsTotal / paymentsLimit) || 1;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="p-6 max-w-4xl mx-auto">
        <Breadcrumb
          items={[
            { label: "Dashboard", href: "/" },
            { label: "Members", href: "/members" },
            { label: membership.membershipNo },
          ]}
        />
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              {membership.membershipNo}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {membership.hod?.fullName}
              {membership.membershipStatus && (
                <span
                  className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                    membership.membershipStatus === "Active"
                      ? "bg-green-100 text-green-800"
                      : "bg-gray-100 text-gray-800"
                  }`}
                >
                  {membership.membershipStatus}
                </span>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={generateQr} className="gap-1.5">
              <QrCode className="h-4 w-4" />
              QR Code
            </Button>
            <Link href={`/members/${id}/edit`}>
              <Button variant="outline" size="sm">
                Edit
              </Button>
            </Link>
          </div>
        </div>

        <Tabs defaultValue="details">
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="history">Payment History</TabsTrigger>
          </TabsList>

          {/* ── Tab 1: Details ──────────────────────────────── */}
          <TabsContent value="details">
            <div className="space-y-6">
              {/* Payment summary cards */}
              {balance && (
                <div className="grid grid-cols-3 gap-3">
                  <Card>
                    <CardContent className="pt-4 pb-4 px-4 text-center">
                      <p className="text-xs font-medium text-muted-foreground mb-1">
                        Total Due
                      </p>
                      <p className="text-xl font-bold tabular-nums">
                        {balance.totalDue.toFixed(2)}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 pb-4 px-4 text-center">
                      <p className="text-xs font-medium text-muted-foreground mb-1">
                        Total Paid
                      </p>
                      <p className="text-xl font-bold tabular-nums text-green-600">
                        {balance.totalPaid.toFixed(2)}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 pb-4 px-4 text-center">
                      <p className="text-xs font-medium text-muted-foreground mb-1">
                        Outstanding
                      </p>
                      <p
                        className={`text-xl font-bold tabular-nums ${
                          balance.outstanding > 0
                            ? "text-red-600"
                            : "text-green-600"
                        }`}
                      >
                        {balance.outstanding.toFixed(2)}
                      </p>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Membership info */}
              <Card>
                <CardHeader>
                  <CardTitle>Membership Info</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
                    <div className="flex justify-between py-1.5 border-b border-border/50">
                      <span className="text-muted-foreground">Type</span>
                      <span className="font-medium">
                        {membership.membershipType}
                      </span>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-border/50">
                      <span className="text-muted-foreground">Status</span>
                      <span className="font-medium">
                        {membership.membershipStatus}
                      </span>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-border/50">
                      <span className="text-muted-foreground">Registered</span>
                      <span className="font-medium">
                        {new Date(
                          membership.dateOfRegistration
                        ).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-border/50">
                      <span className="text-muted-foreground">
                        Payment period
                      </span>
                      <span className="font-medium">
                        {membership.paymentPeriod}
                      </span>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-border/50">
                      <span className="text-muted-foreground">
                        Membership fee
                      </span>
                      <span className="font-medium tabular-nums">
                        {Number(membership.membershipFee).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-border/50">
                      <span className="text-muted-foreground">
                        Total contribution
                      </span>
                      <span className="font-medium tabular-nums">
                        {Number(membership.totalContribution).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-border/50">
                      <span className="text-muted-foreground">Disability</span>
                      <span className="font-medium">
                        {yesNo(membership.disability)}
                      </span>
                    </div>
                    {membership.createdBy && (
                      <div className="flex justify-between py-1.5 border-b border-border/50">
                        <span className="text-muted-foreground">
                          Created by
                        </span>
                        <span className="font-medium">
                          {membership.createdBy.email}
                        </span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Household */}
              <Card>
                <CardHeader>
                  <CardTitle>Household</CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-2">
                  {membership.hod && (
                    <p>
                      <span className="font-medium">Head of household:</span>{" "}
                      {membership.hod.fullName} (
                      {membership.hod.nameWithInitials})
                      {membership.hod.nicNumber &&
                        ` – ${membership.hod.nicNumber}`}
                    </p>
                  )}
                  {membership.spouse && (
                    <p>
                      <span className="font-medium">Spouse:</span>{" "}
                      {membership.spouse.fullName} (
                      {membership.spouse.nameWithInitials})
                      {membership.spouse.relationToHOH && (
                        <span className="text-muted-foreground"> - {membership.spouse.relationToHOH}</span>
                      )}
                    </p>
                  )}
                  {membership.dependents &&
                    membership.dependents.length > 0 && (
                      <div>
                        <span className="font-medium">Dependents:</span>
                        <div className="mt-1 space-y-2">
                          {(["children", "other"] as const).map((group) => {
                            const items = membership.dependents?.filter((d) => (d.group ?? "other") === group) ?? [];
                            if (items.length === 0) return null;
                            return (
                              <div key={group}>
                                <p className="text-xs uppercase text-muted-foreground">
                                  {group === "children" ? "Children" : "Other dependents"}
                                </p>
                                <ul className="list-disc list-inside mt-0.5 space-y-0.5">
                                  {items.map((d) => (
                                    <li key={d.person.id}>
                                      {d.person.fullName} ({d.person.nameWithInitials})
                                      {d.person.relationToHOH && (
                                        <span className="text-muted-foreground"> - {d.person.relationToHOH}</span>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                </CardContent>
              </Card>

              {/* Dues & record payment */}
              <Card>
                <CardHeader>
                  <CardTitle>Dues & Payments</CardTitle>
                </CardHeader>
                <CardContent>
                  {balance && balance.dues.length > 0 ? (
                    <div className="rounded-md border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-left p-2.5 font-medium">
                              Period
                            </th>
                            <th className="text-right p-2.5 font-medium">
                              Due
                            </th>
                            <th className="text-right p-2.5 font-medium">
                              Paid
                            </th>
                            <th className="text-center p-2.5 font-medium">
                              Status
                            </th>
                            <th className="p-2.5"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {balance.dues.map((d) => {
                            const remaining =
                              Number(d.amountDue) - Number(d.amountPaid);
                            return (
                              <tr key={d.id} className="border-t">
                                <td className="p-2.5">{d.period}</td>
                                <td className="p-2.5 text-right tabular-nums">
                                  {Number(d.amountDue).toFixed(2)}
                                </td>
                                <td className="p-2.5 text-right tabular-nums">
                                  {Number(d.amountPaid).toFixed(2)}
                                </td>
                                <td className="p-2.5 text-center">
                                  <span
                                    className={`text-xs px-2 py-0.5 rounded-full ${
                                      statusColors[d.status] ?? ""
                                    }`}
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
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No dues generated yet.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── Tab 2: Payment History ──────────────────────── */}
          <TabsContent value="history">
            <Card>
              <CardHeader>
                <CardTitle>Transaction History</CardTitle>
              </CardHeader>
              <CardContent>
                {payments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No payments recorded yet.
                  </p>
                ) : (
                  <>
                    <div className="rounded-md border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-left p-2.5 font-medium">
                              Date
                            </th>
                            <th className="text-left p-2.5 font-medium">
                              Period
                            </th>
                            <th className="text-right p-2.5 font-medium">
                              Amount
                            </th>
                            <th className="text-left p-2.5 font-medium">
                              Collected by
                            </th>
                            <th className="text-left p-2.5 font-medium">
                              Note
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {payments.map((p) => (
                            <tr key={p.id} className="border-t">
                              <td className="p-2.5">
                                {new Date(p.paymentDate).toLocaleDateString()}
                              </td>
                              <td className="p-2.5">
                                {p.paymentDue?.period ?? "—"}
                              </td>
                              <td className="p-2.5 text-right tabular-nums font-medium text-green-600">
                                {Number(p.amount).toFixed(2)}
                              </td>
                              <td className="p-2.5">
                                {p.collectedBy?.email ?? "—"}
                              </td>
                              <td className="p-2.5 text-muted-foreground">
                                {p.note || "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex items-center justify-between text-sm text-muted-foreground mt-4">
                      <span>{paymentsTotal} transactions</span>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={paymentsPage <= 1}
                          onClick={() =>
                            setPaymentsPage((p) => Math.max(1, p - 1))
                          }
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span>
                          Page {paymentsPage} of {totalPaymentPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={paymentsPage >= totalPaymentPages}
                          onClick={() =>
                            setPaymentsPage((p) =>
                              Math.min(totalPaymentPages, p + 1)
                            )
                          }
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Record payment dialog */}
      <Dialog open={payDialogOpen} onOpenChange={setPayDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record payment – {payDue?.period}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRecordPayment} className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Due: {payDue ? Number(payDue.amountDue).toFixed(2) : ""} | Paid so
              far: {payDue ? Number(payDue.amountPaid).toFixed(2) : ""} |
              Remaining:{" "}
              {payDue
                ? (
                    Number(payDue.amountDue) - Number(payDue.amountPaid)
                  ).toFixed(2)
                : ""}
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
            {payError && (
              <p className="text-sm text-destructive">{payError}</p>
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={paySubmitting}>
                {paySubmitting ? "Recording…" : "Record payment"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPayDialogOpen(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* QR Code dialog */}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-center">{membership?.membershipNo}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4">
            {qrDataUrl && (
              <img
                src={qrDataUrl}
                alt={`QR code for ${membership?.membershipNo}`}
                className="w-64 h-64 rounded-lg"
              />
            )}
            <p className="text-xs text-muted-foreground text-center">
              Scan to view membership details
            </p>
            <Button variant="outline" size="sm" onClick={downloadQr} className="gap-1.5">
              <Download className="h-4 w-4" />
              Download PNG
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
