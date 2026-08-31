"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Download,
  FileText,
  RefreshCw,
  Undo2,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { dashboardFlowHref } from "@/lib/dashboard-flows";
import { Header } from "@/components/header";
import { Breadcrumb } from "@/components/breadcrumb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type IncomeAccount = {
  id: string;
  name: string;
  accountType: string;
  assetSubtype: string;
  systemKey?: string | null;
  isActive: boolean;
};

type IncomeMovement = {
  key: string;
  type: "receipt" | "reversal";
  movementDate: string;
  enteredAt: string;
  documentNumber: string | null;
  linkedDocumentNumber: string | null;
  receivedInto: string;
  enteredBy: string | null;
  amount: number;
  status: "posted" | "reversed" | "reversal";
  reversalReason: string | null;
  relatedDate: string | null;
  runningTotal: number;
};

type IncomeAccountReport = {
  organizationName: string;
  account: IncomeAccount & { category: string };
  fromDate: string;
  toDate: string;
  currency: string;
  generatedAt: string;
  summary: {
    totalReceived: number;
    amountReversed: number;
    netReceived: number;
    postedCount: number;
    receiptCount: number;
    reversalCount: number;
    movementCount: number;
  };
  receivedInto: Array<{ accountId: string; accountName: string; amount: number }>;
  movements: IncomeMovement[];
};

function localDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function money(value: number) {
  return Math.abs(value).toLocaleString("en-LK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function amount(value: number) {
  return value < 0 ? `(${money(value)})` : money(value);
}

function reportDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Colombo",
  }).format(new Date(value));
}

function enteredDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Colombo",
  }).format(new Date(value));
}

export default function AccountReportPage() {
  const pathname = usePathname();
  const reportType = pathname.includes("expense-account") ? "expense" : "income";
  const isExpense = reportType === "expense";
  const reportName = isExpense ? "Expense Account Report" : "Income Account Report";
  const accountsEndpoint = isExpense
    ? "/accounting/reports/expense-accounts"
    : "/accounting/reports/income-accounts";
  const reportEndpoint = isExpense
    ? "/accounting/reports/expense-account"
    : "/accounting/reports/income-account";
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const today = new Date();
  const [accounts, setAccounts] = useState<IncomeAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [fromDate, setFromDate] = useState(localDate(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [toDate, setToDate] = useState(localDate(today));
  const [report, setReport] = useState<IncomeAccountReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, router, user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api<IncomeAccount[]>(accountsEndpoint)
      .then((data) => {
        if (cancelled) return;
        setAccounts(data);
        if (data[0]) {
          setAccountId(data[0].id);
          void loadReport(data[0].id);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : `Unable to load ${reportType} accounts`);
      });
    return () => { cancelled = true; };
    // The initial dates are intentionally captured when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, accountsEndpoint, reportType]);

  async function loadReport(selectedAccountId = accountId) {
    if (!selectedAccountId) {
      setError(`Select an ${reportType} account`);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setReport(await api<IncomeAccountReport>(reportEndpoint, {
        params: { accountId: selectedAccountId, fromDate, toDate },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to generate the ${reportType} account report`);
    } finally {
      setLoading(false);
    }
  }

  if (authLoading || !user) return null;

  return (
    <div className="min-h-screen bg-slate-50/60">
      <Header />
      <main className="mx-auto max-w-[1800px] p-4 md:p-6 print:max-w-none print:p-0">
        <div className="print:hidden">
          <Breadcrumb items={[
            { label: "Dashboard", href: dashboardFlowHref("reports") },
            { label: "Financial Reports", href: "/finance-reports" },
            { label: reportName },
          ]} />
          <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">{reportName}</h1>
              <p className="mt-1 text-sm text-slate-500">
                {isExpense
                  ? "Review payments, reversals, cash or bank allocation, and the net movement for one expense account."
                  : "Review receipts, reversals, cash or bank allocation, and the net movement for one income account."}
              </p>
            </div>
            <div className="grid w-full gap-3 sm:grid-cols-2 xl:w-auto xl:grid-cols-[260px_160px_160px_auto_auto] xl:items-end">
              <div>
                <Label>Account Name</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>From</Label><Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></div>
              <div><Label>To</Label><Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></div>
              <Button onClick={() => loadReport()} disabled={loading || !accountId}>
                <RefreshCw className="mr-2 h-4 w-4" />{loading ? "Generating..." : "Generate"}
              </Button>
              <Button variant="outline" disabled={!report} onClick={() => window.print()}>
                <Download className="mr-2 h-4 w-4" />Download PDF
              </Button>
            </div>
          </div>
          {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        </div>

        {report && <IncomeStatement report={report} isExpense={isExpense} />}
        {!report && !loading && !error && (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 print:hidden">
            Select an account and reporting period to generate the report.
          </div>
        )}
      </main>
    </div>
  );
}

function IncomeStatement({ report, isExpense }: { report: IncomeAccountReport; isExpense: boolean }) {
  const estimatedPageCount = Math.max(1, Math.ceil(report.movements.length / 10));
  const reportName = isExpense ? "Expense Account Report" : "Income Account Report";
  const DirectionIcon = isExpense ? ArrowUpRight : ArrowDownLeft;
  return (
    <section className="income-account-report overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm md:p-8 print:rounded-none print:border-0 print:p-0 print:shadow-none">
      <div className="income-report-header mb-5 flex items-start justify-between gap-8">
        <div className="flex min-w-0 items-start gap-4">
          <div className={`income-report-logo flex h-14 w-14 shrink-0 items-center justify-center rounded-xl ${isExpense ? "bg-blue-100 text-sky-700" : "bg-emerald-100 text-emerald-700"}`}>
            <DirectionIcon className="h-7 w-7" />
          </div>
          <div>
            <p className="income-org-name text-[15px] font-semibold uppercase tracking-[0.04em] text-slate-600">{report.organizationName}</p>
            <h2 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">{reportName}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <p className="income-account-name text-lg font-semibold text-slate-700">{report.account.name}</p>
              <span className={`income-category-badge rounded-full px-2.5 py-1 text-xs font-semibold ${isExpense ? "bg-blue-50 text-sky-700" : "bg-slate-100 text-slate-600"}`}>{report.account.category}</span>
            </div>
          </div>
        </div>
        <div className="income-generated shrink-0 text-right">
          <p className="income-period text-base font-bold text-slate-900">{reportDate(report.fromDate)} - {reportDate(report.toDate)}</p>
          <p className="mt-1 text-sm text-slate-500">Amounts in {report.currency}</p>
          <p className="mt-2 text-xs text-slate-500">Generated {enteredDate(report.generatedAt)}</p>
        </div>
      </div>

      <div className="income-summary-grid mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 print:grid-cols-4">
        <SummaryTile icon={<DirectionIcon />} label={isExpense ? "Total Paid" : "Total Received"} value={`LKR ${money(report.summary.totalReceived)}`} tone={isExpense ? "paid" : "received"} />
        <SummaryTile icon={<Undo2 />} label="Amount Reversed" value={`LKR ${money(report.summary.amountReversed)}`} tone="reversed" />
        <SummaryTile icon={<DirectionIcon />} label={isExpense ? "Net Paid" : "Net Received"} value={`LKR ${money(report.summary.netReceived)}`} tone="net" />
        <SummaryTile
          icon={<ArrowLeftRight />}
          label="Transaction Movements"
          value={`${report.summary.postedCount} POSTED`}
          detail={`${report.summary.receiptCount} ${isExpense ? "payments" : "receipts"} + ${report.summary.reversalCount} reversals - ${report.summary.movementCount} movements`}
          tone="movements"
        />
      </div>

      <div className="income-breakdown mb-5 grid gap-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 md:grid-cols-[260px_1fr] print:grid-cols-[190px_1fr]">
        <div className="border-slate-200 md:border-r md:pr-5 print:border-r print:pr-4">
          <h3 className="text-base font-bold text-slate-900">{isExpense ? "Paid from" : "Received into"}</h3>
          <p className="mt-1 text-xs text-slate-500">Gross {isExpense ? "payments" : "receipts"} by cash or bank account</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4">
          {report.receivedInto.length > 0 ? report.receivedInto.map((item) => (
            <div key={item.accountId} className="border-slate-200 lg:border-r lg:pr-4 lg:last:border-0 print:border-r print:pr-3 print:last:border-0">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{item.accountName}</p>
              <p className="mt-1 text-base font-bold tabular-nums text-slate-900">{money(item.amount)}</p>
            </div>
          )) : <p className="text-sm text-slate-500">No {isExpense ? "payments" : "receipts"} in this period.</p>}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 print:overflow-visible">
        <table className="income-report-table w-full min-w-[1260px] border-collapse text-sm print:min-w-0">
          <colgroup>
            <col className="col-date" /><col className="col-receipt" /><col className="col-account" />
            <col className="col-entered" /><col className="col-amount" /><col className="col-status" />
            <col className="col-reversal" /><col className="col-total" />
          </colgroup>
          <thead>
            <tr>
              <th>Date</th><th>Receipt / Link</th><th>{isExpense ? "Paid From" : "Received Into"}</th><th>Entered By</th>
              <th className="text-right">Amount</th><th>Status</th><th>Reversal Details</th><th className="text-right">Running Total</th>
            </tr>
          </thead>
          <tbody>
            {report.movements.map((movement) => (
              <tr key={movement.key} className={movement.status === "posted" ? "" : "income-reversal-row"}>
                <td>
                  <p className="font-semibold text-slate-900">{reportDate(movement.movementDate)}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">Entered {enteredDate(movement.enteredAt)}</p>
                </td>
                <td>
                  <p className="font-semibold text-slate-900">{movement.documentNumber ?? "-"}</p>
                  {movement.linkedDocumentNumber && (
                    <p className="mt-0.5 text-[11px] font-medium text-red-600">
                      {movement.type === "receipt" ? "Linked reversal" : "Reversal of"}: {movement.linkedDocumentNumber}
                    </p>
                  )}
                </td>
                <td className="font-medium text-slate-700">{movement.receivedInto}</td>
                <td className="text-slate-700">{movement.enteredBy ?? "-"}</td>
                <td className={`text-right font-semibold tabular-nums ${movement.amount < 0 ? "text-red-600" : isExpense ? "text-sky-700" : "text-slate-900"}`}>{amount(movement.amount)}</td>
                <td><StatusBadge status={movement.status} /></td>
                <td>
                  {movement.reversalReason ? (
                    <>
                      <p className="font-semibold text-red-600">{movement.reversalReason}</p>
                      {movement.relatedDate && (
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {movement.type === "receipt" ? "Reversed" : "Original entry"} {reportDate(movement.relatedDate)}
                        </p>
                      )}
                    </>
                  ) : <span className="text-slate-400">-</span>}
                </td>
                <td className="text-right font-semibold tabular-nums text-slate-900">{amount(movement.runningTotal)}</td>
              </tr>
            ))}
            {report.movements.length === 0 && (
              <tr><td colSpan={8} className="py-10 text-center text-slate-500">No transactions found for the selected period.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="income-reconciliation mt-5 flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 md:flex-row md:items-center md:justify-between print:flex-row print:items-center print:justify-between">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-600">Account Reconciliation</h3>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
            <span>{isExpense ? "Total Paid" : "Total Received"} <strong className="ml-2 tabular-nums">{money(report.summary.totalReceived)}</strong></span>
            <span>-</span>
            <span>Reversals <strong className="ml-2 tabular-nums text-red-600">{money(report.summary.amountReversed)}</strong></span>
            <span>=</span>
            <span>{isExpense ? "Net Paid" : "Net Received"} <strong className={`ml-2 tabular-nums ${isExpense ? "text-sky-700" : "text-emerald-700"}`}>{money(report.summary.netReceived)}</strong></span>
          </div>
        </div>
        <p className="max-w-md text-right text-xs leading-5 text-slate-500">
          Posted {isExpense ? "payments" : "receipts"} increase the running total. Reversal lines reduce it and remain linked to the original {isExpense ? "payment" : "receipt"}.
        </p>
      </div>

      <div className="income-report-footer mt-5 flex items-center justify-between border-t border-slate-200 pt-3 text-[11px] text-slate-500">
        <span>{reportName}</span>
        <span className="flex items-center gap-1"><FileText className="h-3 w-3" /> Powered by Civica</span>
        <span>Page {estimatedPageCount}</span>
      </div>

      <style jsx global>{`
        .income-account-report { font-family: Inter, Arial, sans-serif; }
        .income-report-table th { background:#0f172a; color:#fff; padding:12px 14px; text-align:left; font-size:12px; font-weight:700; letter-spacing:.035em; text-transform:uppercase; }
        .income-report-table td { height:56px; border-bottom:1px solid #d7e1ed; padding:9px 14px; vertical-align:middle; }
        .income-report-table tbody tr:nth-child(even):not(.income-reversal-row) { background:#f8fafc; }
        .income-report-table .income-reversal-row { background:#fff8f8; }
        .income-report-table .col-date { width:11%; } .income-report-table .col-receipt { width:15%; }
        .income-report-table .col-account { width:15%; } .income-report-table .col-entered { width:13%; }
        .income-report-table .col-amount { width:10%; } .income-report-table .col-status { width:10%; }
        .income-report-table .col-reversal { width:16%; } .income-report-table .col-total { width:10%; }
        @media print {
          @page { size: A4 landscape; margin: 9mm 10mm; }
          html, body { background:#fff !important; }
          .civica-sidebar,.civica-toolbar { display:none !important; }
          .income-account-report { width:100%;color:#0f172a;font-size:8pt;line-height:1.22; }
          .income-report-header { margin-bottom:9pt; }.income-report-logo { width:28.5pt;height:28.5pt;border-radius:6pt; }
          .income-report-logo svg { width:14px !important;height:14px !important;stroke-width:1.5; }
          .income-report-header h2 { font-size:17pt !important;font-weight:700;line-height:1.1; }
          .income-org-name,.income-account-name { font-size:10.5pt !important;font-weight:600;letter-spacing:.2pt; }
          .income-category-badge { font-size:7.25pt !important;font-weight:600; }.income-period { font-size:8.5pt !important;font-weight:600; }
          .income-generated,.income-generated p { font-size:7.75pt !important;font-weight:400;line-height:1.2; }
          .income-summary-grid { gap:6pt;margin-bottom:7.5pt; }.income-summary-tile { min-height:57pt;padding:7.5pt !important; }
          .income-summary-tile > div { font-size:8pt !important;font-weight:600; }.income-summary-tile .summary-value { font-size:14.5pt !important;font-weight:700; }
          .income-summary-tile p:last-child:not(.summary-value) { font-size:7.25pt !important; }
          .income-breakdown { gap:7.5pt;margin-bottom:7.5pt;padding:6.75pt 9pt; }.income-breakdown h3 { font-size:8.5pt !important;font-weight:700; }
          .income-breakdown h3 + p { font-size:7.25pt !important; }.income-breakdown .text-\[11px\] { font-size:8.25pt !important;font-weight:600; }.income-breakdown .text-base { font-size:9pt !important;font-weight:700; }
          .income-report-table { font-size:8pt;line-height:1.22; }.income-report-table th { padding:4.5pt 5.25pt;font-size:7.5pt;font-weight:600;letter-spacing:.2pt; }
          .income-report-table td { height:32pt;padding:4.5pt 5.25pt;font-size:8pt;font-weight:400; }.income-report-table td p { line-height:1.22; }
          .income-report-table td .font-semibold { font-size:8.25pt;font-weight:600; }.income-report-table td .text-\\[11px\\] { font-size:7.25pt !important;font-weight:400; }
          .income-status-badge { border:0 !important;border-radius:3pt;padding:2pt 5pt !important;font-size:7pt !important;font-weight:600 !important;line-height:1.1;letter-spacing:.15pt;box-shadow:none !important; }
          .income-reconciliation { margin-top:7.5pt;padding:6pt 9pt;font-size:8pt; }.income-reconciliation h3 { font-size:8pt !important;font-weight:600; }.income-reconciliation p { font-size:7.25pt !important; }
          .income-report-footer { margin-top:6pt;padding-top:3pt;font-size:7.5pt !important; }
        }
      `}</style>
    </section>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
  tone: "received" | "paid" | "reversed" | "net" | "movements";
}) {
  const styles = {
    received: "border-emerald-200 bg-emerald-50 text-emerald-700",
    paid: "border-sky-200 bg-blue-50 text-sky-700",
    reversed: "border-red-200 bg-red-50 text-red-600",
    net: "border-slate-900 bg-slate-950 text-white",
    movements: "border-slate-200 bg-slate-50 text-slate-800",
  }[tone];
  return (
    <div className={`income-summary-tile min-h-[126px] rounded-xl border p-5 ${styles}`}>
      <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide">
        <span className="[&>svg]:h-5 [&>svg]:w-5">{icon}</span>{label}
      </div>
      <p className="summary-value mt-3 text-[28px] font-bold leading-none tabular-nums">{value}</p>
      {detail && <p className="mt-2 text-xs opacity-75">{detail}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: IncomeMovement["status"] }) {
  const labels = { posted: "Posted", reversed: "Reversed", reversal: "Reversal" };
  const styles = status === "posted" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600";
  return <span className={`income-status-badge inline-flex rounded-md px-2.5 py-1 text-[11px] font-bold uppercase ${styles}`}>{labels[status]}</span>;
}
