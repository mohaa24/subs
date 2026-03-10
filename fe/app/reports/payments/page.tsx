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
import { FileText, Download, Printer, RotateCcw } from "lucide-react";

interface PeriodicPayment {
  id: string;
  paymentDate: string;
  memberName: string;
  membershipNo: string;
  period: string;
  amount: number;
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
    } catch {
      setReport(null);
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

  return (
    <div className="min-h-screen bg-background relative">
      <AbstractBg />
      <Header />
      <main className="relative p-6 max-w-5xl mx-auto print:p-0 print:max-w-none">
        <div className="print:hidden">
          <Breadcrumb items={[{ label: "Dashboard", href: "/" }, { label: "Reports", href: "/reports" }, { label: "Periodic Payment Report" }]} />
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
          </CardContent>
        </Card>

        {report && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <Card>
                <CardContent className="pt-4 pb-4 px-4 text-center">
                  <p className="text-xs text-muted-foreground">Total Payments</p>
                  <p className="text-2xl font-bold tabular-nums">{report.activePayments}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4 px-4 text-center">
                  <p className="text-xs text-muted-foreground">Total Collected</p>
                  <p className="text-2xl font-bold tabular-nums text-emerald-600">{formatRs(report.totalCollected)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4 px-4 text-center">
                  <p className="text-xs text-muted-foreground">Reversed</p>
                  <p className="text-2xl font-bold tabular-nums text-red-600">{report.reversedPayments}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4 px-4 text-center">
                  <p className="text-xs text-muted-foreground">Net Collected</p>
                  <p className="text-2xl font-bold tabular-nums">{formatRs(report.netCollected)}</p>
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
                          <th className="text-left p-2.5 font-medium">Membership No</th>
                          <th className="text-left p-2.5 font-medium">Period</th>
                          <th className="text-right p-2.5 font-medium">Amount</th>
                          <th className="text-left p-2.5 font-medium">Note</th>
                          <th className="text-left p-2.5 font-medium">Collected By</th>
                          <th className="text-center p-2.5 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.payments.map((p) => (
                          <tr key={p.id} className={`border-t ${p.isReversed ? "opacity-50" : ""}`}>
                            <td className="p-2.5">{new Date(p.paymentDate).toLocaleDateString()}</td>
                            <td className="p-2.5 font-medium">{p.memberName}</td>
                            <td className="p-2.5 text-muted-foreground">{p.membershipNo}</td>
                            <td className="p-2.5">{p.period}</td>
                            <td className={`p-2.5 text-right tabular-nums ${p.isReversed ? "line-through" : ""}`}>
                              {p.amount.toFixed(2)}
                            </td>
                            <td className="p-2.5 text-muted-foreground max-w-[150px] truncate">{p.note ?? "—"}</td>
                            <td className="p-2.5 text-muted-foreground">{p.collectedBy}</td>
                            <td className="p-2.5 text-center">
                              {p.isReversed ? (
                                <span className="inline-flex items-center gap-1 text-xs text-red-600">
                                  <RotateCcw className="h-3 w-3" />
                                  Reversed
                                </span>
                              ) : (
                                <span className="text-xs text-emerald-600">Active</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 bg-muted/30 font-semibold">
                          <td colSpan={4} className="p-2.5 text-right">Net Total:</td>
                          <td className="p-2.5 text-right tabular-nums">{formatRs(report.netCollected)}</td>
                          <td colSpan={3}></td>
                        </tr>
                      </tfoot>
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
