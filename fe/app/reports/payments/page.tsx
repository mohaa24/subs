"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, apiUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Header } from "@/components/header";
import { AbstractBg } from "@/components/abstract-bg";
import { Breadcrumb } from "@/components/breadcrumb";
import { dashboardFlowHref } from "@/lib/dashboard-flows";
import { FileText, Download, Printer } from "lucide-react";

interface PeriodicPayment {
  id: string;
  paymentDate: string;
  memberName: string;
  fullName?: string | null;
  membershipNo: string;
  membershipId?: string;
  zone?: string;
  dueType?: string;
  period: string;
  amount: number;
  paymentMethod?: string | null;
  receiptNumber?: string | null;
  note: string | null;
  collectedBy: string;
  isReversed: boolean;
  reversedAt: string | null;
  reversalReason: string | null;
  reversedBy: string | null;
}

interface PeriodicReport {
  fromDate: string;
  toDate: string;
  totalPayments: number;
  activePayments: number;
  reversedPayments: number;
  totalCollected: number;
  totalReversed: number;
  netCollected: number;
  dueTypeSummary: Array<{
    dueType: string;
    amount: number;
  }>;
  payments: PeriodicPayment[];
}

function formatRs(n: number) {
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .format(n)
    .replace("LKR", "Rs.");
}

export default function PeriodicPaymentReportPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<PeriodicReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  async function loadReport() {
    setLoading(true);
    try {
      const data = await api<PeriodicReport>("/payments/report/periodic", {
        params: { fromDate, toDate },
      });
      setReport(data);
      setGeneratedAt(new Date());
    } catch {
      setReport(null);
      setGeneratedAt(null);
    } finally {
      setLoading(false);
    }
  }

  function handleExportCSV() {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    const url = `${apiUrl("/payments/report/periodic")}?fromDate=${fromDate}&toDate=${toDate}&format=csv`;
    const a = document.createElement("a");
    a.href = url;
    if (token) {
      fetch(url, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.blob())
        .then((blob) => {
          const blobUrl = URL.createObjectURL(blob);
          a.href = blobUrl;
          a.download = `payment-report-${fromDate}-to-${toDate}.csv`;
          a.click();
          URL.revokeObjectURL(blobUrl);
        });
    }
  }

  if (authLoading || !user) return <div className="p-8 text-muted-foreground">Loading…</div>;

  const dueTypeSummary =
    report?.dueTypeSummary && report.dueTypeSummary.length > 0
      ? report.dueTypeSummary
      : (() => {
          if (!report) return [];
          const totals = new Map<string, number>();
          for (const payment of report.payments) {
            const dueType = payment.dueType ?? "Unknown";
            const signedAmount = payment.isReversed ? -payment.amount : payment.amount;
            totals.set(dueType, (totals.get(dueType) ?? 0) + signedAmount);
          }
          return Array.from(totals.entries())
            .map(([dueType, amount]) => ({ dueType, amount }))
            .filter((item) => Math.abs(item.amount) > 0.000001)
            .sort((a, b) => {
              if (a.dueType === "Credit balance") return 1;
              if (b.dueType === "Credit balance") return -1;
              return a.dueType.localeCompare(b.dueType);
            });
        })();

  return (
    <div className="min-h-screen bg-background relative">
      <AbstractBg />
      <Header />
      <main className="relative p-6 max-w-5xl mx-auto print:p-0 print:max-w-none">
        <div className="print:hidden">
          <Breadcrumb items={[{ label: "Dashboard", href: dashboardFlowHref("reports") }, { label: "Reports", href: dashboardFlowHref("reports") }, { label: "Periodic Payment Report" }]} />
        </div>

        <div className="hidden print:block mb-4 pb-3 border-b-2 border-foreground/20">
          <h2 className="text-lg font-bold">Periodic Payment Report</h2>
          <p className="text-xs text-muted-foreground">
            {fromDate} to {toDate} · Printed on {new Date().toLocaleDateString()}
          </p>
        </div>

        <div className="flex items-center gap-2 mb-5 print:hidden">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold text-foreground">Periodic Payment Report</h1>
        </div>

        <Card className="mb-6 print:hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Date Range</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1">
                <Label>From</Label>
                <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-44" />
              </div>
              <div className="space-y-1">
                <Label>To</Label>
                <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-44" />
              </div>
              <Button onClick={loadReport} disabled={loading}>
                {loading ? "Loading…" : "Generate Report"}
              </Button>
              {report && (
                <>
                  <Button variant="outline" onClick={handleExportCSV} className="gap-1.5">
                    <Download className="h-4 w-4" />
                    Export CSV
                  </Button>
                  <Button variant="outline" onClick={() => window.print()} className="gap-1.5">
                    <Printer className="h-4 w-4" />
                    Print
                  </Button>
                </>
              )}
            </div>
            {report && generatedAt && (
              <div className="mt-4 rounded-lg border bg-muted/20 px-4 py-3 text-sm">
                <p className="font-medium text-foreground mb-2">Report Details</p>
                <div className="grid gap-1.5 text-muted-foreground">
                  <p>
                    <span className="font-medium text-foreground">Entity:</span>{" "}
                    {user.organization?.name ?? "—"}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Period:</span>{" "}
                    {report.fromDate} to {report.toDate}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Generated On:</span>{" "}
                    {generatedAt.toLocaleDateString()} - {generatedAt.toLocaleTimeString()}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Generated By:</span>{" "}
                    {user.email}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {report && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <Card>
                <CardContent className="pt-4 pb-4 px-4 text-center">
                  <p className="text-xs text-muted-foreground">Active Payments</p>
                  <p className="text-2xl font-bold tabular-nums">{report.activePayments}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4 px-4 text-center">
                  <p className="text-xs text-muted-foreground">Total Collected</p>
                  <p className="text-2xl font-bold tabular-nums text-emerald-600">{formatRs(report.netCollected)}</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Audit Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="rounded-lg border overflow-x-auto">
                    <table className="w-full text-sm min-w-[420px]">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-2.5 font-medium">Transaction Status</th>
                          <th className="text-right p-2.5 font-medium">No.</th>
                          <th className="text-right p-2.5 font-medium">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-t font-semibold">
                          <td className="p-2.5">Transactions</td>
                          <td className="p-2.5 text-right tabular-nums">{report.totalPayments}</td>
                          <td className="p-2.5 text-right tabular-nums">{formatRs(report.totalCollected)}</td>
                        </tr>
                        <tr className="border-t">
                          <td className="p-2.5">Reversed</td>
                          <td className="p-2.5 text-right tabular-nums">{report.reversedPayments}</td>
                          <td className="p-2.5 text-right tabular-nums">{formatRs(report.totalReversed)}</td>
                        </tr>
                        <tr className="border-t">
                          <td className="p-2.5">Active</td>
                          <td className="p-2.5 text-right tabular-nums">{report.activePayments}</td>
                          <td className="p-2.5 text-right tabular-nums">{formatRs(report.netCollected)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Due Type Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="rounded-lg border overflow-x-auto">
                    <table className="w-full text-sm min-w-[320px]">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-2.5 font-medium">Due Type</th>
                          <th className="text-right p-2.5 font-medium">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dueTypeSummary.length === 0 ? (
                          <tr className="border-t">
                            <td colSpan={2} className="p-2.5 text-center text-muted-foreground">
                              No due type totals available for this period.
                            </td>
                          </tr>
                        ) : (
                          dueTypeSummary.map((item) => (
                            <tr key={item.dueType} className="border-t">
                              <td className="p-2.5">{item.dueType}</td>
                              <td className="p-2.5 text-right tabular-nums">{formatRs(item.amount)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Payment Details</CardTitle>
              </CardHeader>
              <CardContent>
                {report.payments.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">No payments in this period.</p>
                ) : (
                  <div className="rounded-lg border overflow-x-auto">
                    <table className="w-full text-sm min-w-[800px]">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-2.5 font-medium">Date</th>
                          <th className="text-left p-2.5 font-medium">Member</th>
                          <th className="text-right p-2.5 font-medium">Amount</th>
                          <th className="text-left p-2.5 font-medium">Payment Method</th>
                          <th className="text-left p-2.5 font-medium">Receipt No</th>
                          <th className="text-left p-2.5 font-medium">Collected By</th>
                          <th className="text-center p-2.5 font-medium">Status</th>
                          <th className="text-left p-2.5 font-medium">Reversal Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.payments.map((p) => (
                          <tr key={p.id} className={`border-t ${p.isReversed ? "opacity-50" : ""}`}>
                            <td className="p-2.5">{new Date(p.paymentDate).toLocaleDateString()}</td>
                            <td className="p-2.5 align-top">
                              <div className="font-medium">{p.memberName}</div>
                              <div className="text-muted-foreground">{p.zone || "—"}</div>
                              <div className="text-muted-foreground">ID: {p.membershipId || p.membershipNo}</div>
                            </td>
                            <td className={`p-2.5 text-right tabular-nums ${p.isReversed ? "line-through" : ""}`}>
                              {p.amount.toFixed(2)}
                            </td>
                            <td className="p-2.5">{p.paymentMethod ?? "—"}</td>
                            <td className="p-2.5 font-mono text-xs">{p.receiptNumber ?? "—"}</td>
                            <td className="p-2.5 text-muted-foreground">{p.collectedBy}</td>
                            <td className="p-2.5 text-center">
                              {p.isReversed ? (
                                <span className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium border-red-200 bg-red-50 text-red-700">
                                  <span className="h-2 w-2 rounded-full bg-red-500" />
                                  Reversed
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium border-emerald-200 bg-emerald-50 text-emerald-700">
                                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                                  Active
                                </span>
                              )}
                            </td>
                            <td className="p-2.5 align-top text-muted-foreground">
                              {p.isReversed ? (
                                <div className="space-y-0.5">
                                  <div>{p.reversalReason || "—"}</div>
                                  <div>By: {p.reversedBy || "—"}</div>
                                </div>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
