"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownRight,
  ArrowUpRight,
  Download,
  FileText,
  PieChart,
  RefreshCw,
  Scale,
  TrendingUp,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { dashboardFlowHref } from "@/lib/dashboard-flows";
import { Header } from "@/components/header";
import { Breadcrumb } from "@/components/breadcrumb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ProfitLossRow = {
  id: string;
  name: string;
  accountType: "income" | "expense";
  assetSubtype: "operating_income" | "project_fund_surplus" | "operating_expense" | "project_fund_deficit";
  systemKey?: string | null;
  amount: number;
};

type ProfitLossReport = {
  organizationName: string;
  fromDate: string;
  toDate: string;
  currency: string;
  generatedAt: string;
  generatedBy: string;
  income: ProfitLossRow[];
  expenses: ProfitLossRow[];
  incomeTotal: number;
  expenseTotal: number;
  netIncome: number;
  categories: {
    operatingIncome: number;
    specialFundSurplus: number;
    operatingExpenses: number;
    specialFundDeficit: number;
  };
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

function reportDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Colombo",
  }).format(new Date(`${value}T00:00:00+05:30`));
}

function generatedDate(value: string) {
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

export default function ProfitLossReportPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const today = new Date();
  const [fromDate, setFromDate] = useState(localDate(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [toDate, setToDate] = useState(localDate(today));
  const [report, setReport] = useState<ProfitLossReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, router, user]);

  async function loadReport() {
    setLoading(true);
    setError("");
    try {
      setReport(await api<ProfitLossReport>("/accounting/reports/profit-loss", {
        params: { fromDate, toDate },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate the Profit & Loss Report");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user) void loadReport();
    // The initial dates are captured when the page opens; filters apply on Generate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (authLoading || !user) return null;

  return (
    <div className="min-h-screen bg-slate-50/60">
      <Header />
      <main className="mx-auto max-w-[1800px] p-4 md:p-6 print:max-w-none print:p-0">
        <div className="print:hidden">
          <Breadcrumb items={[
            { label: "Dashboard", href: dashboardFlowHref("reports") },
            { label: "Financial Reports", href: "/finance-reports" },
            { label: "Profit & Loss Report" },
          ]} />
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Profit &amp; Loss Report</h1>
              <p className="mt-1 text-sm text-slate-500">Review income, expenses, special fund results, and the net result for a selected period.</p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div><Label>From</Label><Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></div>
              <div><Label>To</Label><Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></div>
              <Button onClick={loadReport} disabled={loading}>
                <RefreshCw className="mr-2 h-4 w-4" />{loading ? "Generating..." : "Generate"}
              </Button>
              <Button variant="outline" disabled={!report} onClick={() => window.print()}>
                <Download className="mr-2 h-4 w-4" />Download PDF
              </Button>
            </div>
          </div>
          {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        </div>

        {report && <ProfitLossStatement report={report} />}
        {!report && !loading && !error && (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 print:hidden">
            Select a reporting period to generate the report.
          </div>
        )}
      </main>
    </div>
  );
}

function ProfitLossStatement({ report }: { report: ProfitLossReport }) {
  const netMargin = report.incomeTotal === 0 ? 0 : (report.netIncome / report.incomeTotal) * 100;
  const isDeficit = report.netIncome < 0;
  const operatingIncome = report.income.filter((row) => row.assetSubtype === "operating_income");
  const fundSurplus = report.income.filter((row) => row.assetSubtype === "project_fund_surplus");
  const operatingExpenses = report.expenses.filter((row) => row.assetSubtype === "operating_expense");
  const fundDeficit = report.expenses.filter((row) => row.assetSubtype === "project_fund_deficit");

  return (
    <section className="profit-loss-report overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm md:p-8 print:rounded-none print:border-0 print:p-0 print:shadow-none">
      <header className="pl-header mb-5 flex items-start justify-between gap-8">
        <div className="flex min-w-0 items-start gap-4">
          <div className="pl-logo flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-50 to-blue-50 text-slate-800 ring-1 ring-slate-200">
            <TrendingUp className="h-7 w-7" />
          </div>
          <div>
            <p className="text-[15px] font-semibold uppercase tracking-[0.04em] text-slate-700">{report.organizationName}</p>
            <h2 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Income &amp; Expense Statement</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <p className="text-lg font-semibold text-slate-700">Profit &amp; Loss</p>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Financial Report</span>
            </div>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-base font-bold text-slate-900">{reportDate(report.fromDate)} - {reportDate(report.toDate)}</p>
          <p className="mt-1 text-sm text-slate-500">Amounts in {report.currency}</p>
          <p className="mt-2 text-xs text-slate-500">Generated {generatedDate(report.generatedAt)}</p>
          <p className="mt-0.5 text-xs text-slate-500">Generated by {report.generatedBy}</p>
        </div>
      </header>

      <div className="pl-summary mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 print:grid-cols-4">
        <SummaryTile icon={<ArrowUpRight />} label="Total Income" value={`LKR ${money(report.incomeTotal)}`} tone="income" />
        <SummaryTile icon={<ArrowDownRight />} label="Total Expenses" value={`LKR ${money(report.expenseTotal)}`} tone="expense" />
        <SummaryTile icon={<Scale />} label={isDeficit ? "Net Deficit" : "Net Surplus"} value={`LKR ${money(report.netIncome)}`} tone={isDeficit ? "deficit" : "net"} />
        <SummaryTile icon={<PieChart />} label="Net Margin" value={`${netMargin.toFixed(1)}%`} detail={`${isDeficit ? "Deficit" : "Surplus"} as % of income`} tone="margin" />
      </div>

      <div className="pl-category-summary mb-4 grid gap-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-3 md:grid-cols-[210px_1fr] print:grid-cols-[160px_1fr]">
        <div className="border-slate-200 md:border-r md:pr-5 print:border-r print:pr-4">
          <h3 className="text-sm font-bold text-slate-900">Category Summary</h3>
          <p className="mt-0.5 text-xs text-slate-500">Totals by account group</p>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 print:grid-cols-4">
          <CategoryAmount label="Operating Income" amount={report.categories.operatingIncome} tone="income" />
          <CategoryAmount label="Special Fund Surplus" amount={report.categories.specialFundSurplus} tone="income" />
          <CategoryAmount label="Operating Expenses" amount={report.categories.operatingExpenses} tone="expense" />
          <CategoryAmount label="Special Fund Deficit" amount={report.categories.specialFundDeficit} tone="expense" />
        </div>
      </div>

      <div className="pl-panels grid gap-4 lg:grid-cols-2 print:grid-cols-2">
        <StatementPanel title="Income" total={report.incomeTotal} tone="income">
          <AccountGroup title="Operating Income" total={report.categories.operatingIncome} rows={operatingIncome} tone="income" />
          <AccountGroup title="Special Fund Surplus" total={report.categories.specialFundSurplus} rows={fundSurplus} tone="income" />
        </StatementPanel>
        <StatementPanel title="Expenses" total={report.expenseTotal} tone="expense">
          <AccountGroup title="Operating Expenses" total={report.categories.operatingExpenses} rows={operatingExpenses} tone="expense" />
          <AccountGroup title="Special Fund Deficit" total={report.categories.specialFundDeficit} rows={fundDeficit} tone="expense" />
        </StatementPanel>
      </div>

      <div className={`pl-result mt-4 grid gap-4 rounded-xl border px-5 py-3 md:grid-cols-[1.15fr_1fr] print:grid-cols-[1.15fr_1fr] ${isDeficit ? "border-red-200 bg-red-50/50" : "border-slate-200 bg-slate-50"}`}>
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">Financial Result</h3>
          <div className="mt-2 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-end gap-3 text-center text-sm">
            <ResultValue label="Total Income" value={report.incomeTotal} tone="income" />
            <strong className="pb-1 text-slate-700">-</strong>
            <ResultValue label="Total Expenses" value={report.expenseTotal} tone="expense" />
            <strong className="pb-1 text-slate-700">=</strong>
            <ResultValue label={isDeficit ? "Net Deficit" : "Net Surplus"} value={report.netIncome} tone={isDeficit ? "deficit" : "income"} />
          </div>
        </div>
        <div className="flex items-center border-slate-200 text-xs leading-5 text-slate-600 md:border-l md:pl-8 print:border-l print:pl-6">
          {isDeficit ? "Net deficit for the reporting period." : "Positive surplus for the reporting period."}<br />
          Expenses represent {report.incomeTotal === 0 ? "0.0" : ((report.expenseTotal / report.incomeTotal) * 100).toFixed(1)}% of total income.
        </div>
      </div>

      <footer className="pl-footer mt-4 flex items-center justify-between border-t border-slate-200 pt-3 text-[11px] text-slate-500">
        <span>Generated by Civica | Profit &amp; Loss Report</span>
        <span className="flex items-center gap-1"><FileText className="h-3 w-3" /> Page 1 of 1</span>
      </footer>

      <style jsx global>{`
        .profit-loss-report { font-family: Inter, Arial, sans-serif; }
        @media print {
          @page { size: A4 landscape; margin: 8mm; }
          .civica-sidebar, .civica-toolbar, header:not(.pl-header) { display: none !important; }
          html, body { background: #fff !important; }
          .profit-loss-report { width: 281mm; min-height: 194mm; padding: 0 !important; break-inside: avoid; font-size: 10px; }
          .pl-header { margin-bottom: 3.5mm !important; }
          .pl-logo { width: 12mm !important; height: 12mm !important; }
          .pl-summary, .pl-category-summary, .pl-panels { margin-bottom: 3mm !important; gap: 3mm !important; }
          .pl-result { margin-top: 3mm !important; }
          .pl-footer { margin-top: 3mm !important; }
        }
      `}</style>
    </section>
  );
}

function SummaryTile({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: string; detail?: string; tone: "income" | "expense" | "net" | "deficit" | "margin" }) {
  const styles = {
    income: "border-emerald-200 bg-emerald-50/70 text-emerald-700",
    expense: "border-sky-200 bg-sky-50 text-sky-700",
    net: "border-slate-900 bg-[#0b2a50] text-white",
    deficit: "border-red-700 bg-red-700 text-white",
    margin: "border-slate-200 bg-white text-slate-700",
  }[tone];
  return (
    <div className={`rounded-xl border p-4 ${styles}`}>
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/60 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
        <p className="text-xs font-bold uppercase tracking-wide">{label}</p>
      </div>
      <p className="mt-2 whitespace-nowrap text-2xl font-bold tabular-nums text-current">{value}</p>
      {detail && <p className="mt-0.5 text-[11px] opacity-80">{detail}</p>}
    </div>
  );
}

function CategoryAmount({ label, amount, tone }: { label: string; amount: number; tone: "income" | "expense" }) {
  return (
    <div className="border-slate-200 lg:border-r lg:pr-4 lg:last:border-0 print:border-r print:pr-3 print:last:border-0">
      <p className={`text-[11px] font-bold uppercase tracking-wide ${tone === "income" ? "text-emerald-700" : "text-sky-700"}`}>{label}</p>
      <p className={`mt-1 text-base font-bold tabular-nums ${tone === "income" ? "text-emerald-800" : "text-sky-700"}`}>{money(amount)}</p>
    </div>
  );
}

function StatementPanel({ title, total, tone, children }: { title: string; total: number; tone: "income" | "expense"; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200">
      <div className="flex items-center justify-between bg-[#0b2a50] px-4 py-2.5 text-white">
        <h3 className="text-sm font-bold uppercase tracking-wide">{title}</h3>
        <strong className="text-sm tabular-nums">LKR {money(total)}</strong>
      </div>
      <div className="grid grid-cols-[1fr_150px] border-b border-slate-200 bg-slate-50 px-4 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
        <span>Account</span><span className="text-right">Amount</span>
      </div>
      {children}
      <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2 text-sm font-bold uppercase text-slate-800">
        <span>Total {title}</span><span className={`tabular-nums ${tone === "income" ? "text-emerald-700" : "text-sky-700"}`}>{money(total)}</span>
      </div>
    </section>
  );
}

function AccountGroup({ title, total, rows, tone }: { title: string; total: number; rows: ProfitLossRow[]; tone: "income" | "expense" }) {
  const headingStyle = tone === "income" ? "bg-emerald-50 text-emerald-800" : "bg-sky-50 text-sky-700";
  return (
    <div>
      <div className={`flex items-center justify-between px-4 py-1.5 text-xs font-bold uppercase ${headingStyle}`}>
        <span>{title}</span><span className="tabular-nums">{money(total)}</span>
      </div>
      {rows.length > 0 ? rows.map((row) => (
        <div key={row.id} className="grid grid-cols-[1fr_150px] items-center border-t border-slate-100 px-4 py-1.5 text-xs text-slate-700 first:border-0">
          <span className="pl-2">{row.name}</span><span className="text-right tabular-nums text-slate-900">{money(row.amount)}</span>
        </div>
      )) : (
        <div className="px-6 py-2 text-xs text-slate-400">No activity</div>
      )}
    </div>
  );
}

function ResultValue({ label, value, tone }: { label: string; value: number; tone: "income" | "expense" | "deficit" }) {
  const style = tone === "income" ? "text-emerald-700" : tone === "expense" ? "text-sky-700" : "text-red-600";
  return <span><span className="block text-xs text-slate-600">{label}</span><strong className={`mt-0.5 block text-base tabular-nums ${style}`}>{money(value)}</strong></span>;
}
