"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { Header } from "@/components/header";
import { Breadcrumb } from "@/components/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dashboardFlowHref } from "@/lib/dashboard-flows";

type MovementRow = {
  key: string;
  group: string;
  description: string;
  total: number;
  accounts: Record<string, number>;
};

type CashMovementReport = {
  organizationName: string;
  fromDate: string;
  toDate: string;
  accounts: Array<{ id: string; name: string; assetSubtype: "cash" | "bank" }>;
  summary: {
    openingBalance: number;
    moneyReceived: number;
    moneyPaid: number;
    netCashMovement: number;
    closingBalance: number;
  };
  openingByAccount: Record<string, number>;
  receivedByAccount: Record<string, number>;
  paidByAccount: Record<string, number>;
  transferByAccount: Record<string, number>;
  closingByAccount: Record<string, number>;
  received: MovementRow[];
  paid: MovementRow[];
  transfers: MovementRow[];
};

function localDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function money(value: number, dashForZero = false) {
  if (dashForZero && Math.abs(value) < 0.005) return "–";
  const formatted = Math.abs(value).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value < 0 ? `(${formatted})` : formatted;
}

export default function CashMovementReportPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const today = new Date();
  const [fromDate, setFromDate] = useState(localDate(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [toDate, setToDate] = useState(localDate(today));
  const [report, setReport] = useState<CashMovementReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, router, user]);

  async function loadReport() {
    setLoading(true);
    setError("");
    try {
      setReport(await api<CashMovementReport>("/accounting/reports/cash-movement", {
        params: { fromDate, toDate },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate the cash movement report");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user) loadReport();
    // Initial report only; date changes are applied with Generate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (authLoading || !user) return null;

  const totalColumns = report ? report.accounts.length + 2 : 2;

  function movementRows(rows: MovementRow[], tone: "received" | "paid" | "transfer") {
    const groups = Array.from(new Set(rows.map((row) => row.group)));
    return groups.flatMap((group) => {
      const groupRows = rows.filter((row) => row.group === group);
      return [
        <tr key={`${tone}-${group}`} className="cash-movement-subgroup">
          <td colSpan={totalColumns}>{group}</td>
        </tr>,
        ...groupRows.map((row) => (
          <tr key={row.key}>
            <td className="pl-7">{row.description}</td>
            <td className="text-right tabular-nums">{money(row.total, true)}</td>
            {report!.accounts.map((account) => (
              <td key={account.id} className="text-right tabular-nums">{money(row.accounts[account.id] ?? 0, true)}</td>
            ))}
          </tr>
        )),
      ];
    });
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-[1500px] p-4 md:p-6 print:max-w-none print:p-0">
        <div className="print:hidden">
          <Breadcrumb items={[{ label: "Dashboard", href: dashboardFlowHref("reports") }, { label: "Reports", href: "/reports" }, { label: "Cash Movement Report" }]} />
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold">Cash Movement Report</h1>
              <p className="mt-1 text-sm text-muted-foreground">Reconcile opening, receipts, payments, transfers, and closing balances by cash or bank account.</p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div><Label>From</Label><Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></div>
              <div><Label>To</Label><Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></div>
              <Button onClick={loadReport} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />{loading ? "Generating…" : "Generate"}</Button>
              <Button variant="outline" disabled={!report} onClick={() => window.print()}><Download className="mr-2 h-4 w-4" />Download PDF</Button>
            </div>
          </div>
          {error && <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        </div>

        {report && (
          <div className="cash-movement-report">
            <div className="mb-4 hidden text-center print:block">
              <h1 className="text-xl font-bold">{report.organizationName}</h1>
              <h2 className="text-base font-semibold">Cash Movement Report</h2>
              <p className="text-xs text-slate-500">{report.fromDate} to {report.toDate}</p>
            </div>
            <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 print:grid-cols-4">
              <SummaryCard label="Opening Balance" value={report.summary.openingBalance} className="bg-slate-100 text-slate-700" />
              <SummaryCard label="Money Received" value={report.summary.moneyReceived} className="bg-emerald-50 text-emerald-700" />
              <SummaryCard label="Money Paid" value={report.summary.moneyPaid} className="bg-sky-50 text-sky-700" />
              <SummaryCard label="Closing Balance" value={report.summary.closingBalance} className="bg-slate-900 text-white" />
            </div>

            <Card className="overflow-hidden print:border-0 print:shadow-none">
              <CardContent className="overflow-x-auto p-0">
                <table className="cash-movement-table w-full min-w-[900px] text-xs print:min-w-0">
                  <thead><tr><th>Description</th><th className="text-right">Total</th>{report.accounts.map((account) => <th key={account.id} className="text-right">{account.name}</th>)}</tr></thead>
                  <tbody>
                    <BalanceRow label="Opening Balance" total={report.summary.openingBalance} accounts={report.openingByAccount} report={report} />
                    <SectionRow label="Money Received" tone="received" colSpan={totalColumns} />
                    {movementRows(report.received, "received")}
                    <TotalRow label="Total Money Received" total={report.summary.moneyReceived} accounts={report.receivedByAccount} report={report} tone="received" />
                    <SectionRow label="Money Paid" tone="paid" colSpan={totalColumns} />
                    {movementRows(report.paid, "paid")}
                    <TotalRow label="Total Money Paid" total={report.summary.moneyPaid} accounts={report.paidByAccount} report={report} tone="paid" />
                    <SectionRow label="Internal Transfers" tone="transfer" colSpan={totalColumns} />
                    {movementRows(report.transfers, "transfer")}
                    <TotalRow label="Net Internal Transfers" total={0} accounts={report.transferByAccount} report={report} tone="transfer" signed />
                    <tr className="font-bold"><td>Net Cash Movement</td><td className="text-right">{money(report.summary.netCashMovement)}</td>{report.accounts.map((account) => <td key={account.id} className="text-right">{money((report.receivedByAccount[account.id] ?? 0) - (report.paidByAccount[account.id] ?? 0) + (report.transferByAccount[account.id] ?? 0))}</td>)}</tr>
                    <tr className="bg-slate-900 font-bold text-white"><td>Closing Balance</td><td className="text-right">{money(report.summary.closingBalance)}</td>{report.accounts.map((account) => <td key={account.id} className="text-right">{money(report.closingByAccount[account.id] ?? 0)}</td>)}</tr>
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
      <style jsx global>{`
        .cash-movement-table th { background:#0f172a; color:white; padding:10px 12px; text-transform:uppercase; letter-spacing:.03em; }
        .cash-movement-table td { border-bottom:1px solid #e2e8f0; padding:8px 12px; }
        .cash-movement-subgroup td { background:#f8fafc; color:#475569; font-weight:600; }
        @media print {
          @page { size: A4 landscape; margin: 8mm; }
          .civica-sidebar, .civica-toolbar, header { display:none !important; }
          body { background:white !important; }
          .cash-movement-report { color:#0f172a; }
          .cash-movement-table { font-size:8px; }
          .cash-movement-table th, .cash-movement-table td { padding:4px 6px; }
        }
      `}</style>
    </div>
  );
}

function SummaryCard({ label, value, className }: { label: string; value: number; className: string }) {
  return <div className={`rounded-xl p-4 ${className}`}><div className="text-[11px] font-semibold uppercase">{label}</div><div className="mt-1 text-xl font-bold">LKR {money(value)}</div></div>;
}

function BalanceRow({ label, total, accounts, report }: { label: string; total: number; accounts: Record<string, number>; report: CashMovementReport }) {
  return <tr className="bg-slate-100 font-semibold"><td>{label}</td><td className="text-right">{money(total)}</td>{report.accounts.map((account) => <td key={account.id} className="text-right">{money(accounts[account.id] ?? 0)}</td>)}</tr>;
}

function SectionRow({ label, tone, colSpan }: { label: string; tone: "received" | "paid" | "transfer"; colSpan: number }) {
  const styles = tone === "received" ? "bg-emerald-50 text-emerald-700" : tone === "paid" ? "bg-sky-50 text-sky-700" : "bg-violet-50 text-violet-700";
  return <tr className={`font-bold uppercase ${styles}`}><td colSpan={colSpan}>{label}</td></tr>;
}

function TotalRow({ label, total, accounts, report, tone, signed = false }: { label: string; total: number; accounts: Record<string, number>; report: CashMovementReport; tone: "received" | "paid" | "transfer"; signed?: boolean }) {
  const styles = tone === "received" ? "bg-emerald-50 text-emerald-700" : tone === "paid" ? "bg-sky-50 text-sky-700" : "bg-violet-50 text-violet-700";
  return <tr className={`font-bold ${styles}`}><td>{label}</td><td className="text-right">{money(total)}</td>{report.accounts.map((account) => <td key={account.id} className="text-right">{money(accounts[account.id] ?? 0, !signed)}</td>)}</tr>;
}
