"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownRight, ArrowLeftRight, ArrowUpRight, Download, FileText, RefreshCw, WalletCards } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { Header } from "@/components/header";
import { Breadcrumb } from "@/components/breadcrumb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dashboardFlowHref } from "@/lib/dashboard-flows";

type MovementTone = "received" | "paid" | "transfer";
type MovementRow = { key: string; group: string; description: string; total: number; accounts: Record<string, number> };
type CashMovementReport = {
  organizationName: string; fromDate: string; toDate: string; currency: string; generatedAt: string; generatedBy: string;
  accounts: Array<{ id: string; name: string; assetSubtype: "cash" | "bank" }>;
  summary: { openingBalance: number; moneyReceived: number; moneyPaid: number; netCashMovement: number; closingBalance: number };
  openingByAccount: Record<string, number>; receivedByAccount: Record<string, number>; paidByAccount: Record<string, number>;
  transferByAccount: Record<string, number>; closingByAccount: Record<string, number>;
  received: MovementRow[]; paid: MovementRow[]; transfers: MovementRow[];
};
type TableRow =
  | { key: string; type: "opening" | "net" | "closing"; label: string; total: number; accounts: Record<string, number> }
  | { key: string; type: "section"; label: string; tone: MovementTone; continued?: boolean }
  | { key: string; type: "subgroup"; label: string; tone: MovementTone; continued?: boolean }
  | { key: string; type: "movement"; movement: MovementRow; tone: MovementTone }
  | { key: string; type: "empty"; label: string; tone: MovementTone }
  | { key: string; type: "subtotal"; label: string; total: number; accounts: Record<string, number>; tone: MovementTone };

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function money(value: number, dashForZero = false) {
  if (dashForZero && Math.abs(value) < 0.005) return "–";
  const formatted = Math.abs(value).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value < 0 ? `(${formatted})` : formatted;
}
function reportDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Colombo" }).format(new Date(`${value}T00:00:00+05:30`));
}
function generatedDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Colombo" }).format(new Date(value));
}
function sectionLabel(tone: MovementTone) {
  return tone === "received" ? "Money Received" : tone === "paid" ? "Money Paid" : "Internal Transfers";
}

function buildRows(report: CashMovementReport): TableRow[] {
  const rows: TableRow[] = [{ key: "opening", type: "opening", label: "Opening Balance", total: report.summary.openingBalance, accounts: report.openingByAccount }];
  const addSection = (tone: MovementTone, movements: MovementRow[], subtotalLabel: string, subtotal: number, accounts: Record<string, number>) => {
    rows.push({ key: `${tone}-section`, type: "section", label: sectionLabel(tone), tone });
    const groups = Array.from(new Set(movements.map((row) => row.group)));
    if (groups.length === 0) rows.push({ key: `${tone}-empty`, type: "empty", label: "No activity during this period", tone });
    for (const group of groups) {
      rows.push({ key: `${tone}-${group}`, type: "subgroup", label: group, tone });
      for (const movement of movements.filter((row) => row.group === group)) rows.push({ key: `${tone}-${movement.key}`, type: "movement", movement, tone });
    }
    rows.push({ key: `${tone}-subtotal`, type: "subtotal", label: subtotalLabel, total: subtotal, accounts, tone });
  };
  addSection("received", report.received, "Total Money Received", report.summary.moneyReceived, report.receivedByAccount);
  addSection("paid", report.paid, "Total Money Paid", report.summary.moneyPaid, report.paidByAccount);
  addSection("transfer", report.transfers, "Net Internal Transfers", 0, report.transferByAccount);
  const netByAccount = Object.fromEntries(report.accounts.map((account) => [account.id, (report.receivedByAccount[account.id] ?? 0) - (report.paidByAccount[account.id] ?? 0) + (report.transferByAccount[account.id] ?? 0)]));
  rows.push({ key: "net", type: "net", label: "Net Cash Movement", total: report.summary.netCashMovement, accounts: netByAccount });
  rows.push({ key: "closing", type: "closing", label: "Closing Balance", total: report.summary.closingBalance, accounts: report.closingByAccount });
  return rows;
}

function paginateRows(rows: TableRow[]) {
  const pages: TableRow[][] = [[]];
  const capacity = (pageIndex: number) => pageIndex === 0 ? 18 : 28;
  let currentSection: Extract<TableRow, { type: "section" }> | null = null;
  let currentGroup: Extract<TableRow, { type: "subgroup" }> | null = null;
  const remaining = () => capacity(pages.length - 1) - pages[pages.length - 1].length;
  const newPage = (repeatContext: boolean) => {
    pages.push([]);
    if (repeatContext && currentSection) {
      pages.at(-1)!.push({ ...currentSection, key: `${currentSection.key}-p${pages.length}`, continued: true });
      if (currentGroup) pages.at(-1)!.push({ ...currentGroup, key: `${currentGroup.key}-p${pages.length}`, continued: true });
    }
  };
  for (const row of rows) {
    const reserve = row.type === "section" ? 3 : row.type === "subgroup" ? 2 : row.type === "net" ? 2 : 1;
    if (remaining() < reserve) newPage(row.type === "movement" || row.type === "subtotal");
    if (row.type === "section") { currentSection = row; currentGroup = null; }
    else if (row.type === "subgroup") currentGroup = row;
    pages.at(-1)!.push(row);
  }
  return pages.filter((page) => page.length > 0);
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
  useEffect(() => { if (!authLoading && !user) router.replace("/login"); }, [authLoading, router, user]);
  async function loadReport() {
    setLoading(true); setError("");
    try { setReport(await api<CashMovementReport>("/accounting/reports/cash-movement", { params: { fromDate, toDate } })); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to generate the Cash Movement Report"); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (user) void loadReport(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user]);
  const pages = useMemo(() => report ? paginateRows(buildRows(report)) : [], [report]);
  if (authLoading || !user) return null;

  return (
    <div className="min-h-screen bg-slate-100/70">
      <Header />
      <main className="mx-auto max-w-[1800px] p-4 md:p-6 print:max-w-none print:p-0">
        <div className="print:hidden">
          <Breadcrumb items={[{ label: "Dashboard", href: dashboardFlowHref("reports") }, { label: "Reports", href: "/reports" }, { label: "Cash Movement Report" }]} />
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div><h1 className="text-xl font-semibold text-slate-900">Cash Movement Report</h1><p className="mt-1 text-sm text-slate-500">Reconcile opening balances, receipts, payments, internal transfers, and closing cash positions.</p></div>
            <div className="flex flex-wrap items-end gap-2">
              <div><Label>From</Label><Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></div>
              <div><Label>To</Label><Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></div>
              <Button onClick={loadReport} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />{loading ? "Generating..." : "Generate"}</Button>
              <Button variant="outline" disabled={!report} onClick={() => window.print()}><Download className="mr-2 h-4 w-4" />Download PDF</Button>
            </div>
          </div>
          {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        </div>
        {report && <div className="cash-report-pages space-y-5 print:space-y-0">{pages.map((rows, pageIndex) => <CashMovementPage key={pageIndex} report={report} rows={rows} pageIndex={pageIndex} pageCount={pages.length} />)}</div>}
        {!report && !loading && !error && <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 print:hidden">Select a reporting period to generate the report.</div>}
      </main>
      <ReportStyles />
    </div>
  );
}

function CashMovementPage({ report, rows, pageIndex, pageCount }: { report: CashMovementReport; rows: TableRow[]; pageIndex: number; pageCount: number }) {
  const firstPage = pageIndex === 0;
  return (
    <section className="cash-report-page relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 text-[#334155] shadow-sm md:p-7 print:rounded-none print:border-0 print:p-0 print:shadow-none">
      <ReportHeader report={report} compact={!firstPage} />
      {firstPage && <SummaryCards report={report} />}
      <div className="cash-table-wrap overflow-x-auto rounded-lg border border-slate-200 print:overflow-visible">
        <table className="cash-report-table w-full min-w-[820px] table-fixed border-collapse print:min-w-0">
          <colgroup><col className="cash-description-column" /><col className="cash-amount-column" />{report.accounts.map((account) => <col key={account.id} className="cash-account-column" />)}</colgroup>
          <thead><tr><th>Description</th><th className="text-right">Total</th>{report.accounts.map((account) => <th key={account.id} className="text-right">{account.name}</th>)}</tr></thead>
          <tbody>{rows.map((row) => <ReportTableRow key={row.key} row={row} report={report} />)}</tbody>
        </table>
      </div>
      {firstPage && <GuidanceNotes />}
      <footer className="cash-report-footer flex items-center justify-between border-t border-slate-200 pt-2 text-[10px] text-slate-500"><span>Generated by Civica | Cash Movement Report</span><span className="flex items-center gap-1"><FileText className="h-3 w-3" /> Page {pageIndex + 1} of {pageCount}</span></footer>
    </section>
  );
}

function ReportHeader({ report, compact }: { report: CashMovementReport; compact: boolean }) {
  if (compact) return <header className="cash-report-header cash-report-header-compact mb-3 flex items-end justify-between border-b border-slate-200 pb-2"><div><p className="text-xs font-bold uppercase text-slate-600">{report.organizationName}</p><h2 className="text-xl font-bold text-slate-950">Cash Movement Report</h2></div><p className="text-xs text-slate-500">{reportDate(report.fromDate)} - {reportDate(report.toDate)} · Amounts in {report.currency}</p></header>;
  return <header className="cash-report-header mb-4 text-center"><p className="text-base font-bold text-slate-900">{report.organizationName}</p><h2 className="mt-0.5 text-3xl font-bold tracking-tight text-slate-950">Cash Movement Report</h2><p className="mt-0.5 text-sm text-slate-500">{reportDate(report.fromDate)} - {reportDate(report.toDate)}</p><p className="mt-0.5 text-[11px] text-slate-400">Generated {generatedDate(report.generatedAt)} by {report.generatedBy}</p></header>;
}

function SummaryCards({ report }: { report: CashMovementReport }) {
  return <div className="cash-summary-grid mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 print:grid-cols-4">
    <SummaryCard label="Opening Balance" value={report.summary.openingBalance} tone={report.summary.openingBalance < 0 ? "negative" : "balance"} badge={report.summary.openingBalance < 0 ? "Negative" : undefined} icon={<WalletCards />} />
    <SummaryCard label="Money Received" value={report.summary.moneyReceived} tone="received" icon={<ArrowDownRight />} />
    <SummaryCard label="Money Paid" value={report.summary.moneyPaid} tone="paid" icon={<ArrowUpRight />} />
    <SummaryCard label="Closing Balance" value={report.summary.closingBalance} tone="closing" icon={<WalletCards />} />
  </div>;
}
function SummaryCard({ label, value, tone, badge, icon }: { label: string; value: number; tone: "balance" | "negative" | "received" | "paid" | "closing"; badge?: string; icon: ReactNode }) {
  const styles = { balance: "bg-slate-100 text-slate-700", negative: "bg-slate-100 text-red-700", received: "bg-emerald-50 text-emerald-700", paid: "bg-sky-50 text-sky-700", closing: "bg-slate-900 text-white" }[tone];
  return <div className={`rounded-xl border border-transparent px-4 py-3 ${styles}`}><div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-white/60 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>{label}</span>{badge && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[9px] font-bold uppercase text-red-700">{badge}</span>}</div><p className="mt-2 whitespace-nowrap text-xl font-bold tabular-nums 2xl:text-2xl">LKR {money(value)}</p></div>;
}

function ReportTableRow({ row, report }: { row: TableRow; report: CashMovementReport }) {
  const colSpan = report.accounts.length + 2;
  if (row.type === "section") {
    const Icon = row.tone === "received" ? ArrowDownRight : row.tone === "paid" ? ArrowUpRight : ArrowLeftRight;
    return <tr className={`cash-section cash-${row.tone}`}><td colSpan={colSpan}><span className="flex items-center gap-2"><span className="cash-section-icon"><Icon className="h-4 w-4" /></span>{row.label}{row.continued ? " (continued)" : ""}</span></td></tr>;
  }
  if (row.type === "subgroup") {
    const reversal = /reversal/i.test(row.label);
    return <tr className={`cash-subgroup cash-${row.tone} ${reversal ? "cash-reversal" : ""}`}><td colSpan={colSpan}><span className="cash-subgroup-label"><span className="cash-bullet" />{row.label}{row.continued ? " (continued)" : ""}</span></td></tr>;
  }
  if (row.type === "empty") return <tr><td colSpan={colSpan} className="cash-empty">{row.label}</td></tr>;
  if (row.type === "movement") {
    const reversal = /reversal/i.test(row.movement.group);
    const total = row.tone === "paid" ? -Math.abs(row.movement.total) : row.movement.total;
    return <tr className={reversal ? "cash-reversal-row" : ""}><td className="cash-account-name">{row.movement.description}</td><td className={`cash-number ${reversal ? "text-red-700" : ""}`}>{money(total, true)}</td>{report.accounts.map((account) => { const raw = row.movement.accounts[account.id] ?? 0; const value = row.tone === "paid" ? -Math.abs(raw) : raw; return <td key={account.id} className={`cash-number ${value < 0 || reversal ? "text-red-700" : ""}`}>{money(value, true)}</td>; })}</tr>;
  }
  if (row.type === "subtotal") {
    const total = row.tone === "paid" ? -Math.abs(row.total) : row.total;
    return <tr className={`cash-subtotal cash-${row.tone}`}><td>{row.label}</td><td className="cash-number">{money(total)}</td>{report.accounts.map((account) => { const raw = row.accounts[account.id] ?? 0; const value = row.tone === "paid" ? -Math.abs(raw) : raw; return <td key={account.id} className="cash-number">{money(value, row.tone !== "transfer")}</td>; })}</tr>;
  }
  const isClosing = row.type === "closing";
  return <tr className={isClosing ? "cash-closing" : row.type === "opening" ? "cash-opening" : "cash-net"}><td>{row.label}</td><td className={`cash-number ${row.total < 0 && !isClosing ? "text-red-700" : ""}`}>{money(row.total)}</td>{report.accounts.map((account) => { const value = row.accounts[account.id] ?? 0; return <td key={account.id} className={`cash-number ${!isClosing && value < 0 ? "text-red-700" : ""}`}>{money(value)}</td>; })}</tr>;
}

function GuidanceNotes() {
  return <div className="cash-guidance grid grid-cols-1 border-x border-b border-slate-200 bg-slate-50 text-[10px] leading-4 text-slate-600 md:grid-cols-3 print:grid-cols-3"><p><strong>How to read:</strong> Amounts in brackets represent a negative balance or money leaving that account.</p><p><strong>Internal transfers:</strong> Move money between your own accounts and do not change the overall total.</p><p><strong>Formula:</strong> Opening Balance + Money Received - Money Paid + Net Internal Transfers = Closing Balance.</p></div>;
}

function ReportStyles() {
  return <style jsx global>{`
    .cash-report-page { font-family: Inter, Arial, sans-serif; }
    .cash-report-table { color:#334155; font-size:12px; line-height:1.2; }
    .cash-description-column { width:32%; } .cash-amount-column { width:13%; }
    .cash-account-column { width:auto; }
    .cash-report-table th { background:#0f172a; color:#fff; padding:8px 10px; font-size:11px; font-weight:700; line-height:1.05; text-transform:uppercase; letter-spacing:.025em; }
    .cash-report-table th:first-child { text-align:left; }
    .cash-report-table td { border-bottom:1px solid #e2e8f0; padding:5px 10px; vertical-align:middle; }
    .cash-number { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .cash-opening, .cash-net { background:#f8fafc; font-weight:700; }
    .cash-section { font-size:13px; font-weight:700; text-transform:uppercase; }
    .cash-section td { padding-top:6px; padding-bottom:6px; }
    .cash-section-icon { display:inline-flex; width:26px; height:22px; align-items:center; justify-content:center; border-radius:6px; background:rgba(255,255,255,.65); }
    .cash-received { background:#ecfdf5; color:#047857; }
    .cash-paid { background:#f0f9ff; color:#0369a1; }
    .cash-transfer { background:#f5f3ff; color:#6d28d9; }
    .cash-subgroup { background:#f8fafc; font-weight:700; }
    .cash-subgroup-label { display:flex; align-items:center; gap:8px; padding-left:18px; }
    .cash-bullet { width:6px; height:6px; border-radius:9999px; background:currentColor; }
    .cash-account-name { padding-left:46px !important; }
    .cash-reversal { background:#fef2f2 !important; color:#b91c1c !important; }
    .cash-reversal-row { background:#fffafa; }
    .cash-empty { padding-left:46px !important; color:#64748b; font-style:italic; }
    .cash-subtotal { font-size:12.5px; font-weight:700; }
    .cash-closing { background:#0f172a; color:#fff; font-size:13px; font-weight:700; }
    .cash-closing td { border-color:#0f172a; padding-top:7px; padding-bottom:7px; }
    .cash-guidance p { padding:8px 10px; border-right:1px solid #e2e8f0; }
    .cash-guidance p:last-child { border-right:0; }
    .cash-report-footer { margin-top:18px; }
    @media print {
      @page { size:A4 landscape; margin:8mm; }
      .civica-sidebar, .civica-toolbar, header:not(.cash-report-header) { display:none !important; }
      html, body { background:#fff !important; print-color-adjust:exact; -webkit-print-color-adjust:exact; }
      .cash-report-page { width:281mm; height:194mm; padding:0 0 8mm !important; break-after:page; page-break-after:always; box-sizing:border-box; }
      .cash-report-page:last-child { break-after:auto; page-break-after:auto; }
      .cash-report-header { margin-bottom:3mm !important; }
      .cash-report-header h2 { font-size:17pt !important; line-height:1; }
      .cash-report-header > p:first-child { font-size:12.5pt !important; }
      .cash-report-header-compact h2 { font-size:14pt !important; }
      .cash-summary-grid { gap:2.5mm !important; margin-bottom:2.5mm !important; }
      .cash-summary-grid > div { padding:2.5mm 3mm !important; }
      .cash-summary-grid p:last-child { font-size:16pt !important; }
      .cash-report-table { font-size:9pt; line-height:10.8pt; }
      .cash-report-table th { padding:1.5mm 2mm; font-size:8.6pt; }
      .cash-report-table td { padding:1mm 2mm; }
      .cash-section { font-size:9.8pt; }
      .cash-subgroup { font-size:9pt; }
      .cash-subtotal { font-size:9.5pt; }
      .cash-closing { font-size:10pt; }
      .cash-guidance { font-size:8pt !important; line-height:10pt !important; }
      .cash-guidance p { padding:1.5mm 2mm; }
      .cash-report-footer { position:absolute; left:0; right:0; bottom:0; margin:0; font-size:7.5pt !important; }
    }
  `}</style>;
}
