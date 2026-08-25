"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowLeftRight, Download, FileText, Printer, RefreshCw, Undo2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api, apiUrl } from "@/lib/api";
import { dashboardFlowHref } from "@/lib/dashboard-flows";
import { Header } from "@/components/header";
import { Breadcrumb } from "@/components/breadcrumb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type PaymentMovement = {
  key: string; type: "payment" | "reversal"; movementDate: string; enteredAt: string;
  memberName: string; membershipId: string; zone: string; receiptNumber: string;
  linkedReceiptNumber: string | null; paymentMethod: string; enteredBy: string; amount: number;
  status: "posted" | "reversed" | "reversal"; reversalReason: string | null;
  relatedDate: string | null; runningTotal: number;
};

type MemberPaymentReport = {
  organizationName: string; generatedAt: string; generatedBy: string; fromDate: string; toDate: string;
  totalPayments: number; activePayments: number; reversedPayments: number;
  totalCollected: number; totalReversed: number; netCollected: number;
  paymentMethodSummary: Array<{ paymentMethod: string; amount: number }>;
  dueTypeSummary: Array<{ dueType: string; amount: number }>;
  movements: PaymentMovement[];
};

function localDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function money(value: number) {
  return Math.abs(value).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function amount(value: number) { return value < 0 ? `(${money(value)})` : money(value); }

function reportDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Colombo" }).format(new Date(value));
}

function enteredDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Colombo" }).format(new Date(value));
}

export default function MemberPaymentReportPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const today = new Date();
  const [fromDate, setFromDate] = useState(localDate(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [toDate, setToDate] = useState(localDate(today));
  const [report, setReport] = useState<MemberPaymentReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { if (!authLoading && !user) router.replace("/login"); }, [authLoading, router, user]);

  async function loadReport() {
    setLoading(true); setError("");
    try {
      setReport(await api<MemberPaymentReport>("/payments/report/periodic", { params: { fromDate, toDate } }));
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : "Unable to generate the member payment report");
    } finally { setLoading(false); }
  }

  function exportCsv() {
    const token = localStorage.getItem("token");
    const url = `${apiUrl("/payments/report/periodic")}?fromDate=${fromDate}&toDate=${toDate}&format=csv`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((response) => { if (!response.ok) throw new Error("Unable to export CSV"); return response.blob(); })
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = blobUrl; link.download = `member-payment-report-${fromDate}-to-${toDate}.csv`; link.click();
        URL.revokeObjectURL(blobUrl);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to export CSV"));
  }

  if (authLoading || !user) return null;

  return (
    <div className="min-h-screen bg-slate-50/60">
      <Header />
      <main className="mx-auto max-w-[1800px] p-4 md:p-6 print:max-w-none print:p-0">
        <div className="print:hidden">
          <Breadcrumb items={[{ label: "Dashboard", href: dashboardFlowHref("reports") }, { label: "Reports", href: "/reports" }, { label: "Member Payment Report" }]} />
          <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Member Payment Report</h1>
              <p className="mt-1 text-sm text-slate-500">Review member receipts, reversals, payment methods, and due type collections for a selected period.</p>
            </div>
            <div className="grid w-full gap-3 sm:grid-cols-2 xl:w-auto xl:grid-cols-[170px_170px_auto_auto_auto] xl:items-end">
              <div><Label>From</Label><Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></div>
              <div><Label>To</Label><Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></div>
              <Button onClick={loadReport} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />{loading ? "Generating..." : "Generate"}</Button>
              <Button variant="outline" disabled={!report} onClick={exportCsv}><Download className="mr-2 h-4 w-4" />Export CSV</Button>
              <Button variant="outline" disabled={!report} onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print / PDF</Button>
            </div>
          </div>
          {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        </div>
        {report ? <PaymentReport report={report} /> : !loading && !error ? <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 print:hidden">Select a reporting period and generate the report.</div> : null}
      </main>
    </div>
  );
}

function PaymentReport({ report }: { report: MemberPaymentReport }) {
  const pages = useMemo(() => {
    if (report.movements.length <= 8) return [report.movements];
    const result = [report.movements.slice(0, 8)];
    const remaining = report.movements.slice(8);
    const continuationPages = Math.ceil(remaining.length / 14);
    const rowsPerPage = Math.ceil(remaining.length / continuationPages);
    for (let index = 0; index < remaining.length; index += rowsPerPage) result.push(remaining.slice(index, index + rowsPerPage));
    return result;
  }, [report.movements]);

  return <>
    <section className="member-payment-report overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm md:p-8 print:hidden">
      <ReportHeader report={report} /><SummaryTiles report={report} /><Breakdowns report={report} />
      <MovementTable movements={report.movements} /><Reconciliation report={report} /><ReportFooter page={1} totalPages={1} />
    </section>
    <div className="hidden print:block">
      {pages.map((movements, pageIndex) => {
        const first = pageIndex === 0; const final = pageIndex === pages.length - 1;
        return <section key={pageIndex} className="member-payment-report payment-print-sheet text-slate-900">
          {first ? <><ReportHeader report={report} /><SummaryTiles report={report} /><Breakdowns report={report} /></> : <ContinuationHeader report={report} />}
          <MovementTable movements={movements} />{final && <Reconciliation report={report} />}
          <ReportFooter page={pageIndex + 1} totalPages={pages.length} />
        </section>;
      })}
    </div>
    <style jsx global>{`
      .member-payment-report { font-family:Inter,Arial,sans-serif; }
      .member-payment-table th { background:#0b2a50;color:#fff;padding:11px 12px;text-align:left;font-size:11px;font-weight:700;letter-spacing:.025em;text-transform:uppercase; }
      .member-payment-table td { height:48px;border-bottom:1px solid #d7e1ed;padding:7px 12px;vertical-align:middle; }
      .member-payment-table tbody tr:nth-child(even):not(.payment-reversal-row) { background:#f8fafc; }
      .member-payment-table .payment-reversal-row { background:#fff8f8; }
      .member-payment-table .col-date { width:10%; }.member-payment-table .col-member { width:16%; }.member-payment-table .col-receipt { width:13%; }
      .member-payment-table .col-method { width:11%; }.member-payment-table .col-entered { width:13%; }.member-payment-table .col-amount { width:9%; }
      .member-payment-table .col-status { width:9%; }.member-payment-table .col-reversal { width:12%; }.member-payment-table .col-total { width:10%; }
      @media print {
        @page { size:A4 landscape;margin:9mm 10mm; }
        html,body { background:#fff !important; }
        .payment-print-sheet { position:relative;height:192mm;overflow:hidden; }
        .payment-print-sheet + .payment-print-sheet { break-before:page; }
        .payment-report-header { margin-bottom:10px; }.payment-report-logo { width:38px;height:38px;border-radius:8px; }
        .payment-report-header h2 { font-size:20px;line-height:1.1; }.payment-summary-grid { gap:8px;margin-bottom:9px; }
        .payment-summary-tile { min-height:72px;padding:9px !important; }.payment-summary-tile .summary-value { font-size:16px !important; }
        .payment-breakdown { margin-bottom:8px;padding:7px 10px; }.member-payment-table { font-size:7.5px; }
        .member-payment-table th { padding:5px 6px;font-size:6.5px; }.member-payment-table td { height:29px;padding:3px 6px; }
        .member-payment-table td p { line-height:1.12; }.member-payment-table td .text-\\[10px\\] { font-size:6px !important; }
        .payment-reconciliation { margin-top:8px;padding:7px 10px; }.payment-report-footer { position:absolute;right:0;bottom:0;left:0;margin-top:0;padding-top:4px; }
      }
    `}</style>
  </>;
}

function ReportHeader({ report }: { report: MemberPaymentReport }) {
  return <div className="payment-report-header mb-5 flex items-start justify-between gap-8">
    <div className="flex min-w-0 items-start gap-4"><div className="payment-report-logo flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><ArrowDownLeft className="h-7 w-7" /></div>
      <div><p className="text-[15px] font-semibold uppercase tracking-[0.04em] text-slate-600">{report.organizationName}</p><h2 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Member Payment Report</h2><div className="mt-1.5 flex items-center gap-2"><p className="text-lg font-semibold text-slate-700">All Member Payments</p><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Membership</span></div></div>
    </div>
    <div className="shrink-0 text-right"><p className="text-base font-bold text-slate-900">{reportDate(report.fromDate)} - {reportDate(report.toDate)}</p><p className="mt-1 text-sm text-slate-500">Amounts in LKR</p><p className="mt-2 text-xs text-slate-500">Generated {enteredDate(report.generatedAt)}</p><p className="mt-1 text-xs text-slate-500">Generated by {report.generatedBy}</p></div>
  </div>;
}

function ContinuationHeader({ report }: { report: MemberPaymentReport }) {
  return <div className="mb-3 flex items-end justify-between border-b border-slate-200 pb-2"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{report.organizationName}</p><h2 className="text-xl font-bold text-slate-950">Member Payment Report</h2></div><p className="text-sm font-bold text-slate-800">{reportDate(report.fromDate)} - {reportDate(report.toDate)}</p></div>;
}

function SummaryTiles({ report }: { report: MemberPaymentReport }) {
  return <div className="payment-summary-grid mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 print:grid-cols-4">
    <SummaryTile icon={<ArrowDownLeft />} label="Total Received" value={`LKR ${money(report.totalCollected)}`} tone="received" />
    <SummaryTile icon={<Undo2 />} label="Amount Reversed" value={`LKR ${money(report.totalReversed)}`} tone="reversed" />
    <SummaryTile icon={<ArrowDownLeft />} label="Net Received" value={`LKR ${money(report.netCollected)}`} tone="net" />
    <SummaryTile icon={<ArrowLeftRight />} label="Transaction Movements" value={`${report.activePayments} POSTED`} detail={`${report.totalPayments} payments + ${report.reversedPayments} reversals - ${report.movements.length} movements`} tone="movements" />
  </div>;
}

function Breakdowns({ report }: { report: MemberPaymentReport }) {
  return <div className="space-y-3 print:space-y-2">
    <Breakdown title="Payment Methods" description="Gross payments by payment method" items={report.paymentMethodSummary.map((item) => ({ label:item.paymentMethod, amount:item.amount }))} />
    <Breakdown title="Collected by Due Type" description="Net receipts by due type" items={report.dueTypeSummary.map((item) => ({ label:item.dueType, amount:item.amount }))} />
  </div>;
}

function Breakdown({ title, description, items }: { title:string; description:string; items:Array<{ label:string; amount:number }> }) {
  return <div className="payment-breakdown grid gap-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-3 md:grid-cols-[300px_1fr] print:grid-cols-[190px_1fr]">
    <div className="border-slate-200 md:border-r md:pr-5 print:border-r print:pr-4"><h3 className="text-sm font-bold text-slate-900">{title}</h3><p className="mt-0.5 text-xs text-slate-500">{description}</p></div>
    <div className="grid auto-cols-fr grid-flow-col gap-3">{items.length ? items.map((item) => <div key={item.label} className="border-r border-slate-200 pr-3 last:border-0"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{item.label}</p><p className="mt-0.5 text-sm font-bold tabular-nums text-slate-900">{money(item.amount)}</p></div>) : <p className="text-xs text-slate-500">No collections in this period.</p>}</div>
  </div>;
}

function MovementTable({ movements }: { movements:PaymentMovement[] }) {
  return <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 print:mt-0 print:overflow-visible"><table className="member-payment-table w-full min-w-[1380px] border-collapse text-sm print:min-w-0">
    <colgroup><col className="col-date" /><col className="col-member" /><col className="col-receipt" /><col className="col-method" /><col className="col-entered" /><col className="col-amount" /><col className="col-status" /><col className="col-reversal" /><col className="col-total" /></colgroup>
    <thead><tr><th>Date</th><th>Member Details</th><th>Receipt / Link</th><th>Payment Method</th><th>Entered By</th><th className="text-right">Amount</th><th>Status</th><th>Reversal Details</th><th className="text-right">Running Total</th></tr></thead>
    <tbody>{movements.map((movement) => <tr key={movement.key} className={movement.status === "posted" ? "" : "payment-reversal-row"}>
      <td><p className="font-semibold text-slate-900">{reportDate(movement.movementDate)}</p><p className="mt-0.5 text-[10px] text-slate-500">Entered {reportDate(movement.enteredAt)}</p></td>
      <td><p className="font-semibold text-slate-900">{movement.memberName}</p><p className="mt-0.5 text-[10px] text-slate-500">ID {movement.membershipId} - {movement.zone}</p></td>
      <td><p className="font-semibold text-slate-900">{movement.receiptNumber}</p>{movement.linkedReceiptNumber && <p className="mt-0.5 text-[10px] font-medium text-red-600">{movement.type === "payment" ? "Linked reversal" : "Reversal of"}: {movement.linkedReceiptNumber}</p>}</td>
      <td className="text-slate-700">{movement.paymentMethod}</td><td className="text-slate-700">{movement.enteredBy}</td>
      <td className={`text-right font-semibold tabular-nums ${movement.amount < 0 ? "text-red-600" : "text-slate-900"}`}>{amount(movement.amount)}</td><td><StatusBadge status={movement.status} /></td>
      <td>{movement.reversalReason ? <><p className="font-semibold text-red-600">{movement.reversalReason}</p>{movement.relatedDate && <p className="mt-0.5 text-[10px] text-slate-500">{movement.type === "payment" ? "Reversed" : "Original entry"} {reportDate(movement.relatedDate)}</p>}</> : <span className="text-slate-400">-</span>}</td>
      <td className="text-right font-semibold tabular-nums text-slate-900">{amount(movement.runningTotal)}</td>
    </tr>)}{!movements.length && <tr><td colSpan={9} className="py-10 text-center text-slate-500">No payments found for the selected period.</td></tr>}</tbody>
  </table></div>;
}

function Reconciliation({ report }: { report:MemberPaymentReport }) {
  return <div className="payment-reconciliation mt-5 flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 md:flex-row md:items-center md:justify-between print:flex-row print:items-center print:justify-between"><div><h3 className="text-xs font-bold uppercase tracking-wide text-slate-600">Payment Reconciliation</h3><div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm"><span>Total Received <strong className="ml-2 tabular-nums">{money(report.totalCollected)}</strong></span><span>-</span><span>Reversals <strong className="ml-2 tabular-nums text-red-600">{money(report.totalReversed)}</strong></span><span>=</span><span>Net Received <strong className="ml-2 tabular-nums text-emerald-700">{money(report.netCollected)}</strong></span></div></div><p className="max-w-md text-right text-xs leading-5 text-slate-500">Posted payments increase the running total. Reversal lines reduce it and remain linked to the original receipt.</p></div>;
}

function ReportFooter({ page, totalPages }: { page:number; totalPages:number }) {
  return <div className="payment-report-footer mt-5 flex items-center justify-between border-t border-slate-200 pt-3 text-[11px] text-slate-500"><span>Member Payment Report</span><span className="flex items-center gap-1"><FileText className="h-3 w-3" />Powered by Civica</span><span>Page {page} of {totalPages}</span></div>;
}

function SummaryTile({ icon, label, value, detail, tone }: { icon:ReactNode; label:string; value:string; detail?:string; tone:"received"|"reversed"|"net"|"movements" }) {
  const styles = { received:"border-emerald-200 bg-emerald-50 text-emerald-700", reversed:"border-red-200 bg-red-50 text-red-600", net:"border-slate-900 bg-[#0b2a50] text-white", movements:"border-slate-200 bg-slate-50 text-slate-800" }[tone];
  return <div className={`payment-summary-tile min-h-[126px] rounded-xl border p-5 ${styles}`}><div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide"><span className="[&>svg]:h-5 [&>svg]:w-5">{icon}</span>{label}</div><p className="summary-value mt-3 text-[28px] font-bold leading-none tabular-nums">{value}</p>{detail && <p className="mt-2 text-xs opacity-75">{detail}</p>}</div>;
}

function StatusBadge({ status }: { status:PaymentMovement["status"] }) {
  const labels = { posted:"Posted", reversed:"Reversed", reversal:"Reversal" };
  const styles = status === "posted" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600";
  return <span className={`inline-flex rounded-md px-2.5 py-1 text-[11px] font-bold uppercase ${styles}`}>{labels[status]}</span>;
}
