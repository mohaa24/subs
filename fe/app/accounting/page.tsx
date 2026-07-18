"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/header";
import { AbstractBg } from "@/components/abstract-bg";
import { Breadcrumb } from "@/components/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth-context";
import { api, type FundPot, type FundSummaryReport } from "@/lib/api";
import { dashboardFlowHref } from "@/lib/dashboard-flows";
import { Landmark, Plus, ReceiptText, RefreshCcw, WalletCards } from "lucide-react";

type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
type AssetSubtype =
  | "cash"
  | "bank"
  | "loan_receivable"
  | "service_receivable"
  | "other"
  | "loan_payable"
  | "service_payable"
  | "other_liability"
  | "general_fund"
  | "project_fund"
  | "operating_income"
  | "project_fund_surplus"
  | "operating_expense"
  | "project_fund_deficit";
type LineSide = "debit" | "credit";
type AccountingPeriod = "this_month" | "this_year" | "all_time" | "custom";
type FundReportPeriod = "from_start" | "current_month" | "current_year" | "custom";
type FundReportStatus = "all" | "active" | "closed";
type JournalSortOrder = "desc" | "asc";
type AccountingTab = "accounts" | "expenses" | "income" | "transfers" | "reports" | "journal";
type JournalEntryKind = "all" | "payment" | "expense" | "income" | "transfer" | "credit_application";

type Account = {
  id: string;
  name: string;
  accountType: AccountType;
  assetSubtype: AssetSubtype;
  systemKey?: string | null;
  description?: string | null;
  isActive: boolean;
  balance?: number;
};

type JournalLine = {
  id: string;
  side: LineSide;
  amount: number;
  memo?: string | null;
  account: Account;
};

type JournalEntry = {
  id: string;
  entryDate: string;
  entryType: string;
  description: string;
  referenceType?: string | null;
  referenceId?: string | null;
  isSystemEntry: boolean;
  createdBy?: { email: string } | null;
  lines: JournalLine[];
};

type ProfitLossReport = {
  income: Array<{ id: string; name: string; amount: number }>;
  expenses: Array<{ id: string; name: string; amount: number }>;
  incomeTotal: number;
  expenseTotal: number;
  netIncome: number;
};

type BalanceSheetReport = {
  assets: Account[];
  liabilities: Account[];
  equity: Account[];
  assetTotal: number;
  liabilityTotal: number;
  equityTotal: number;
  liabilitiesAndEquityTotal: number;
};

const accountTypeLabels: Record<AccountType, string> = {
  asset: "Asset",
  liability: "Liability",
  equity: "Fund Balance",
  income: "Income",
  expense: "Expense",
};

const assetSubtypeLabels: Record<AssetSubtype, string> = {
  cash: "Cash",
  bank: "Bank",
  loan_receivable: "Loan Receivables",
  service_receivable: "Service Receivables",
  other: "Other Assets",
  loan_payable: "Loan Payables",
  service_payable: "Service Payables",
  other_liability: "Other Liabilities",
  general_fund: "General Funds",
  project_fund: "Project Funds",
  operating_income: "Operating Income",
  project_fund_surplus: "Project Fund Surplus",
  operating_expense: "Operating Expense",
  project_fund_deficit: "Project Fund Deficit",
};

const subtypesByAccountType: Record<AccountType, AssetSubtype[]> = {
  asset: ["cash", "bank", "loan_receivable", "service_receivable", "other"],
  liability: ["loan_payable", "service_payable", "other_liability"],
  equity: ["general_fund", "project_fund"],
  income: ["operating_income", "project_fund_surplus"],
  expense: ["operating_expense", "project_fund_deficit"],
};

const defaultSubtypeByAccountType: Record<AccountType, AssetSubtype> = {
  asset: "other",
  liability: "other_liability",
  equity: "general_fund",
  income: "operating_income",
  expense: "operating_expense",
};

const accountingPeriodLabels: Record<AccountingPeriod, string> = {
  this_month: "This Month",
  this_year: "This Year",
  all_time: "All Time",
  custom: "Custom",
};

const fundReportPeriodLabels: Record<FundReportPeriod, string> = {
  from_start: "From Start of Project",
  current_month: "Current Month",
  current_year: "Current Year",
  custom: "Custom Period",
};

const fundReportStatusLabels: Record<FundReportStatus, string> = {
  all: "All Statuses",
  active: "Active",
  closed: "Closed",
};

const journalEntryKindLabels: Record<JournalEntryKind, string> = {
  all: "All Types",
  payment: "Payments",
  expense: "Expenses",
  income: "Income",
  transfer: "Transfers",
  credit_application: "Credit Applications",
};

const hiddenSystemAccountKeys = new Set(["income_other"]);

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function firstOfYearString() {
  const d = new Date();
  return `${d.getFullYear()}-01-01`;
}

function accountingPeriodRange(period: AccountingPeriod) {
  if (period === "this_year") {
    return { fromDate: firstOfYearString(), toDate: todayString() };
  }
  if (period === "all_time") {
    return { fromDate: "1900-01-01", toDate: todayString() };
  }
  return { fromDate: firstOfMonthString(), toDate: todayString() };
}

function journalPeriodRange(period: AccountingPeriod) {
  if (period === "all_time") return { fromDate: "", toDate: "" };
  return accountingPeriodRange(period);
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

function accountDisplayName(account: Pick<Account, "id" | "name" | "systemKey">) {
  if (account.id === "current-earnings") return "Current Year Earnings";
  return account.name;
}

function accountTone(accountType: AccountType) {
  if (accountType === "asset") return "text-emerald-700";
  if (accountType === "liability") return "text-amber-700";
  if (accountType === "income") return "text-blue-700";
  if (accountType === "expense") return "text-red-700";
  return "text-foreground";
}

function accountSubtypeLabel(account: Pick<Account, "assetSubtype">) {
  return assetSubtypeLabels[account.assetSubtype] ?? "Other";
}

export default function AccountingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const canManageAccounting = user?.role === "admin" || user?.role === "super_user";

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [journalTotal, setJournalTotal] = useState(0);
  const [plReport, setPlReport] = useState<ProfitLossReport | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetReport | null>(null);
  const [funds, setFunds] = useState<FundPot[]>([]);
  const [fundSummaryReport, setFundSummaryReport] = useState<FundSummaryReport | null>(null);
  const [activeTab, setActiveTab] = useState<AccountingTab>("accounts");
  const [accountingPeriod, setAccountingPeriod] = useState<AccountingPeriod>("this_month");
  const [fromDate, setFromDate] = useState(firstOfMonthString);
  const [toDate, setToDate] = useState(todayString);
  const [asOfDate, setAsOfDate] = useState(todayString);
  const [fundReportStatus, setFundReportStatus] = useState<FundReportStatus>("all");
  const [fundReportFundId, setFundReportFundId] = useState("all");
  const [fundReportPeriod, setFundReportPeriod] = useState<FundReportPeriod>("from_start");
  const [fundReportFromDate, setFundReportFromDate] = useState(firstOfMonthString);
  const [fundReportToDate, setFundReportToDate] = useState(todayString);
  const [journalEntryKind, setJournalEntryKind] = useState<JournalEntryKind>("all");
  const [journalSearch, setJournalSearch] = useState("");
  const [journalPeriod, setJournalPeriod] = useState<AccountingPeriod>("all_time");
  const [journalFromDate, setJournalFromDate] = useState("");
  const [journalToDate, setJournalToDate] = useState("");
  const [journalSortOrder, setJournalSortOrder] = useState<JournalSortOrder>("desc");
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState("");

  const [newAccount, setNewAccount] = useState({
    name: "",
    accountType: "asset" as AccountType,
    assetSubtype: "other" as AssetSubtype,
    description: "",
  });
  const [expense, setExpense] = useState({
    sourceAccountId: "",
    expenseAccountId: "",
    amount: "",
    entryDate: todayString(),
    description: "",
    memo: "",
  });
  const [income, setIncome] = useState({
    destinationAccountId: "",
    incomeAccountId: "",
    amount: "",
    entryDate: todayString(),
    description: "",
    memo: "",
  });
  const [transfer, setTransfer] = useState({
    fromAccountId: "",
    toAccountId: "",
    amount: "",
    entryDate: todayString(),
    description: "",
  });

  const assetAccounts = useMemo(
    () => accounts.filter((account) => account.accountType === "asset" && account.isActive),
    [accounts],
  );
  const cashBankAssetAccounts = useMemo(
    () => assetAccounts.filter((account) => account.assetSubtype === "cash" || account.assetSubtype === "bank"),
    [assetAccounts],
  );
  const expenseAccounts = useMemo(
    () => accounts.filter((account) => account.accountType === "expense" && account.isActive),
    [accounts],
  );
  const incomeAccounts = useMemo(
    () => accounts.filter((account) => account.accountType === "income" && account.isActive && !hiddenSystemAccountKeys.has(account.systemKey ?? "")),
    [accounts],
  );
  const visibleAccounts = useMemo(
    () => accounts.filter((account) => !hiddenSystemAccountKeys.has(account.systemKey ?? "")),
    [accounts],
  );
  const netIncomePeriodLabel =
    accountingPeriod === "custom"
      ? `${fromDate || "Start"} to ${toDate || "Today"}`
      : accountingPeriodLabels[accountingPeriod];
  const journalPeriodLabel =
    journalPeriod === "custom"
      ? `${journalFromDate || "Start"} to ${journalToDate || "Today"}`
      : accountingPeriodLabels[journalPeriod];

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, router, user]);

  useEffect(() => {
    if (!loading && user) void loadAccounting();
  }, [loading, user]);

  function handleAccountingPeriodChange(value: string) {
    const nextPeriod = value as AccountingPeriod;
    setAccountingPeriod(nextPeriod);
    if (nextPeriod === "custom") return;

    const range = accountingPeriodRange(nextPeriod);
    setFromDate(range.fromDate);
    setToDate(range.toDate);
    void loadAccounting(range);
  }

  function handleJournalPeriodChange(value: string) {
    const nextPeriod = value as AccountingPeriod;
    setJournalPeriod(nextPeriod);
    if (nextPeriod === "custom") return;

    const range = journalPeriodRange(nextPeriod);
    setJournalFromDate(range.fromDate);
    setJournalToDate(range.toDate);
    void loadAccounting({ journalFromDate: range.fromDate, journalToDate: range.toDate });
  }

  function handleJournalSortChange(value: string) {
    const nextSortOrder = value as JournalSortOrder;
    setJournalSortOrder(nextSortOrder);
    void loadAccounting({ journalSortOrder: nextSortOrder });
  }

  function handleFundReportPeriodChange(value: string) {
    const nextPeriod = value as FundReportPeriod;
    setFundReportPeriod(nextPeriod);
    if (nextPeriod === "current_month") {
      setFundReportFromDate(firstOfMonthString());
      setFundReportToDate(todayString());
    }
    if (nextPeriod === "current_year") {
      setFundReportFromDate(firstOfYearString());
      setFundReportToDate(todayString());
    }
  }

  async function loadAccounting(overrides?: {
    fromDate?: string;
    toDate?: string;
    asOfDate?: string;
    journalSearch?: string;
    journalEntryKind?: JournalEntryKind;
    journalFromDate?: string;
    journalToDate?: string;
    journalSortOrder?: JournalSortOrder;
    fundReportStatus?: FundReportStatus;
    fundReportFundId?: string;
    fundReportPeriod?: FundReportPeriod;
    fundReportFromDate?: string;
    fundReportToDate?: string;
  }) {
    const profitLossFromDate = overrides?.fromDate ?? fromDate;
    const profitLossToDate = overrides?.toDate ?? toDate;
    const balanceSheetAsOfDate = overrides?.asOfDate ?? asOfDate;
    const nextJournalSearch = (overrides?.journalSearch ?? journalSearch).trim();
    const nextJournalEntryKind = overrides?.journalEntryKind ?? journalEntryKind;
    const nextJournalFromDate = overrides?.journalFromDate ?? journalFromDate;
    const nextJournalToDate = overrides?.journalToDate ?? journalToDate;
    const nextJournalSortOrder = overrides?.journalSortOrder ?? journalSortOrder;
    const nextFundReportStatus = overrides?.fundReportStatus ?? fundReportStatus;
    const nextFundReportFundId = overrides?.fundReportFundId ?? fundReportFundId;
    const nextFundReportPeriod = overrides?.fundReportPeriod ?? fundReportPeriod;
    const nextFundReportFromDate = overrides?.fundReportFromDate ?? fundReportFromDate;
    const nextFundReportToDate = overrides?.fundReportToDate ?? fundReportToDate;
    const journalParams: Record<string, string> = {
      limit: "25",
      sortOrder: nextJournalSortOrder,
    };
    if (nextJournalSearch) journalParams.search = nextJournalSearch;
    if (nextJournalEntryKind === "payment") journalParams.entryType = "payment";
    if (nextJournalEntryKind === "expense") journalParams.entryType = "expense";
    if (nextJournalEntryKind === "transfer") journalParams.entryType = "transfer";
    if (nextJournalEntryKind === "credit_application") journalParams.entryType = "credit_application";
    if (nextJournalEntryKind === "income") journalParams.referenceType = "manual_income";
    if (nextJournalFromDate) journalParams.fromDate = nextJournalFromDate;
    if (nextJournalToDate) journalParams.toDate = nextJournalToDate;
    const fundReportParams: Record<string, string> = {
      period: nextFundReportPeriod,
    };
    if (nextFundReportStatus !== "all") fundReportParams.status = nextFundReportStatus;
    if (nextFundReportFundId !== "all") fundReportParams.fundId = nextFundReportFundId;
    if (nextFundReportPeriod === "custom") {
      if (nextFundReportFromDate) fundReportParams.fromDate = nextFundReportFromDate;
      if (nextFundReportToDate) fundReportParams.toDate = nextFundReportToDate;
    }

    setLoadingData(true);
    setError("");
    try {
      const [accountsData, journalData, plData, bsData, fundsData, fundSummaryData] = await Promise.all([
        api<Account[]>("/accounting/accounts", { params: { includeInactive: "true" } }),
        api<{ items: JournalEntry[]; total: number }>("/accounting/journal", {
          params: journalParams,
        }),
        api<ProfitLossReport>("/accounting/reports/profit-loss", {
          params: { fromDate: profitLossFromDate, toDate: profitLossToDate },
        }),
        api<BalanceSheetReport>("/accounting/reports/balance-sheet", {
          params: { asOfDate: balanceSheetAsOfDate },
        }),
        api<FundPot[]>("/accounting/funds"),
        api<FundSummaryReport>("/accounting/reports/fund-summary", {
          params: fundReportParams,
        }),
      ]);
      setAccounts(accountsData);
      setJournal(journalData.items);
      setJournalTotal(journalData.total);
      setPlReport(plData);
      setBalanceSheet(bsData);
      setFunds(fundsData);
      setFundSummaryReport(fundSummaryData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load accounting");
    } finally {
      setLoadingData(false);
    }
  }

  async function handleCreateAccount(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api<Account>("/accounting/accounts", {
        method: "POST",
        body: JSON.stringify(newAccount),
      });
      setNewAccount({ name: "", accountType: "asset", assetSubtype: "other", description: "" });
      await loadAccounting();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create account");
    }
  }

  async function handleExpense(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api<JournalEntry>("/accounting/expenses", {
        method: "POST",
        body: JSON.stringify({
          ...expense,
          amount: Number(expense.amount),
          memo: expense.memo || null,
        }),
      });
      setExpense({
        sourceAccountId: expense.sourceAccountId,
        expenseAccountId: expense.expenseAccountId,
        amount: "",
        entryDate: todayString(),
        description: "",
        memo: "",
      });
      setActiveTab("journal");
      setJournalEntryKind("expense");
      setJournalSearch("");
      setJournalPeriod("all_time");
      setJournalFromDate("");
      setJournalToDate("");
      setJournalSortOrder("desc");
      await loadAccounting({
        journalEntryKind: "expense",
        journalSearch: "",
        journalFromDate: "",
        journalToDate: "",
        journalSortOrder: "desc",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to record expense");
    }
  }

  async function handleIncome(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api<JournalEntry>("/accounting/income", {
        method: "POST",
        body: JSON.stringify({
          ...income,
          amount: Number(income.amount),
          memo: income.memo || null,
        }),
      });
      setIncome({
        destinationAccountId: income.destinationAccountId,
        incomeAccountId: income.incomeAccountId,
        amount: "",
        entryDate: todayString(),
        description: "",
        memo: "",
      });
      setActiveTab("journal");
      setJournalEntryKind("income");
      setJournalSearch("");
      setJournalPeriod("all_time");
      setJournalFromDate("");
      setJournalToDate("");
      setJournalSortOrder("desc");
      await loadAccounting({
        journalEntryKind: "income",
        journalSearch: "",
        journalFromDate: "",
        journalToDate: "",
        journalSortOrder: "desc",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to record income");
    }
  }

  async function handleTransfer(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api<JournalEntry>("/accounting/transfers", {
        method: "POST",
        body: JSON.stringify({
          ...transfer,
          amount: Number(transfer.amount),
        }),
      });
      setTransfer({
        fromAccountId: transfer.fromAccountId,
        toAccountId: transfer.toAccountId,
        amount: "",
        entryDate: todayString(),
        description: "",
      });
      setActiveTab("journal");
      setJournalEntryKind("transfer");
      setJournalSearch("");
      setJournalPeriod("all_time");
      setJournalFromDate("");
      setJournalToDate("");
      setJournalSortOrder("desc");
      await loadAccounting({
        journalEntryKind: "transfer",
        journalSearch: "",
        journalFromDate: "",
        journalToDate: "",
        journalSortOrder: "desc",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to record transfer");
    }
  }

  if (loading || !user) {
    return <div className="p-8 text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-background relative">
      <AbstractBg />
      <Header />
      <main className="relative mx-auto max-w-6xl p-6">
        <Breadcrumb
          items={[
            { label: "Dashboard", href: dashboardFlowHref("accounting") },
            { label: "Accounting" },
          ]}
        />

        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Landmark className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold text-foreground">Accounting</h1>
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              Beta
            </span>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-[180px] space-y-1">
              <Label className="text-xs text-muted-foreground">P&amp;L period</Label>
              <Select value={accountingPeriod} onValueChange={handleAccountingPeriodChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="this_month">This Month</SelectItem>
                  <SelectItem value="this_year">This Year</SelectItem>
                  <SelectItem value="all_time">All Time</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => loadAccounting()} disabled={loadingData}>
              <RefreshCcw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>

        <>
            {error && (
              <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="mb-5 grid gap-3 md:grid-cols-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Assets</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{formatRs(balanceSheet?.assetTotal ?? 0)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Liabilities</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{formatRs(balanceSheet?.liabilityTotal ?? 0)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Net Income</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{formatRs(plReport?.netIncome ?? 0)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{netIncomePeriodLabel}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Journal Entries</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{journalTotal}</p>
                </CardContent>
              </Card>
            </div>

            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as AccountingTab)} className="w-full">
              <TabsList className="mb-4 h-auto flex-wrap justify-start gap-1 bg-transparent p-0">
                <TabsTrigger value="accounts" className="rounded-md border border-border px-3 py-1.5">Accounts</TabsTrigger>
                {canManageAccounting && (
                  <TabsTrigger value="expenses" className="rounded-md border border-border px-3 py-1.5">Expenses</TabsTrigger>
                )}
                {canManageAccounting && (
                  <TabsTrigger value="income" className="rounded-md border border-border px-3 py-1.5">Income</TabsTrigger>
                )}
                {canManageAccounting && (
                  <TabsTrigger value="transfers" className="rounded-md border border-border px-3 py-1.5">Transfers</TabsTrigger>
                )}
                <TabsTrigger value="reports" className="rounded-md border border-border px-3 py-1.5">Reports</TabsTrigger>
                <TabsTrigger value="journal" className="rounded-md border border-border px-3 py-1.5">Journal</TabsTrigger>
              </TabsList>

              <TabsContent value="accounts">
                <div className={canManageAccounting ? "grid gap-4 lg:grid-cols-[1fr_360px]" : "grid gap-4"}>
                  <Card>
                    <CardHeader className="flex flex-row items-center gap-3 space-y-0">
                      <WalletCards className="h-5 w-5 text-muted-foreground" />
                      <CardTitle className="text-base">Chart of Accounts</CardTitle>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      <table className="w-full min-w-[640px] text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="p-2 text-left font-medium">Account</th>
                            <th className="p-2 text-left font-medium">Type</th>
                            <th className="p-2 text-left font-medium">Subtype</th>
                            <th className="p-2 text-left font-medium">Status</th>
                            <th className="p-2 text-right font-medium">Balance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleAccounts.map((account) => (
                            <tr key={account.id} className="border-t">
                              <td className="p-2">
                                <div className="font-medium">{accountDisplayName(account)}</div>
                                {account.description && <div className="text-xs text-muted-foreground">{account.description}</div>}
                              </td>
                              <td className={`p-2 font-medium ${accountTone(account.accountType)}`}>{accountTypeLabels[account.accountType]}</td>
                              <td className="p-2 text-muted-foreground">{accountSubtypeLabel(account)}</td>
                              <td className="p-2 text-muted-foreground">{account.isActive ? "Active" : "Archived"}</td>
                              <td className="p-2 text-right tabular-nums">{formatRs(account.balance ?? 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>

                  {canManageAccounting && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Create Account</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <form className="space-y-3" onSubmit={handleCreateAccount}>
                          <div className="space-y-1.5">
                            <Label>Name</Label>
                            <Input value={newAccount.name} onChange={(e) => setNewAccount((v) => ({ ...v, name: e.target.value }))} required />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Type</Label>
                            <Select
                              value={newAccount.accountType}
                              onValueChange={(value) => {
                                const accountType = value as AccountType;
                                setNewAccount((v) => ({
                                  ...v,
                                  accountType,
                                  assetSubtype: defaultSubtypeByAccountType[accountType],
                                }));
                              }}
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {Object.entries(accountTypeLabels).map(([value, label]) => (
                                  <SelectItem key={value} value={value}>{label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label>Subtype</Label>
                            <Select value={newAccount.assetSubtype} onValueChange={(value) => setNewAccount((v) => ({ ...v, assetSubtype: value as AssetSubtype }))}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {subtypesByAccountType[newAccount.accountType].map((value) => (
                                  <SelectItem key={value} value={value}>{assetSubtypeLabels[value]}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label>Description</Label>
                            <Textarea value={newAccount.description} onChange={(e) => setNewAccount((v) => ({ ...v, description: e.target.value }))} />
                          </div>
                          <Button type="submit" className="w-full">
                            <Plus className="mr-2 h-4 w-4" />
                            Create
                          </Button>
                        </form>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </TabsContent>

              {canManageAccounting && (
                <TabsContent value="expenses">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Record Expense</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <form className="grid gap-3 md:grid-cols-2" onSubmit={handleExpense}>
                        <div className="space-y-1.5">
                          <Label>Paid From</Label>
                          <Select value={expense.sourceAccountId} onValueChange={(value) => setExpense((v) => ({ ...v, sourceAccountId: value }))}>
                            <SelectTrigger><SelectValue placeholder="Select asset account" /></SelectTrigger>
                            <SelectContent>{cashBankAssetAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Expense Account</Label>
                          <Select value={expense.expenseAccountId} onValueChange={(value) => setExpense((v) => ({ ...v, expenseAccountId: value }))}>
                            <SelectTrigger><SelectValue placeholder="Select expense account" /></SelectTrigger>
                            <SelectContent>{expenseAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Amount</Label>
                          <Input type="number" min="0" step="0.01" value={expense.amount} onChange={(e) => setExpense((v) => ({ ...v, amount: e.target.value }))} required />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Date</Label>
                          <Input type="date" value={expense.entryDate} onChange={(e) => setExpense((v) => ({ ...v, entryDate: e.target.value }))} />
                        </div>
                        <div className="space-y-1.5 md:col-span-2">
                          <Label>Description</Label>
                          <Input value={expense.description} onChange={(e) => setExpense((v) => ({ ...v, description: e.target.value }))} required />
                        </div>
                        <div className="space-y-1.5 md:col-span-2">
                          <Label>Memo</Label>
                          <Textarea value={expense.memo} onChange={(e) => setExpense((v) => ({ ...v, memo: e.target.value }))} />
                        </div>
                        <Button type="submit" className="md:col-span-2">Record Expense</Button>
                      </form>
                    </CardContent>
                  </Card>
                </TabsContent>
              )}

              {canManageAccounting && (
                <TabsContent value="income">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Record Non-Member Income</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <form className="grid gap-3 md:grid-cols-2" onSubmit={handleIncome}>
                        <div className="space-y-1.5">
                          <Label>Received To</Label>
                          <Select value={income.destinationAccountId} onValueChange={(value) => setIncome((v) => ({ ...v, destinationAccountId: value }))}>
                            <SelectTrigger><SelectValue placeholder="Select asset account" /></SelectTrigger>
                            <SelectContent>{cashBankAssetAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Income Account</Label>
                          <Select value={income.incomeAccountId} onValueChange={(value) => setIncome((v) => ({ ...v, incomeAccountId: value }))}>
                            <SelectTrigger><SelectValue placeholder="Select income account" /></SelectTrigger>
                            <SelectContent>{incomeAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Amount</Label>
                          <Input type="number" min="0" step="0.01" value={income.amount} onChange={(e) => setIncome((v) => ({ ...v, amount: e.target.value }))} required />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Date</Label>
                          <Input type="date" value={income.entryDate} onChange={(e) => setIncome((v) => ({ ...v, entryDate: e.target.value }))} />
                        </div>
                        <div className="space-y-1.5 md:col-span-2">
                          <Label>Description</Label>
                          <Input value={income.description} onChange={(e) => setIncome((v) => ({ ...v, description: e.target.value }))} placeholder="Donation, rental income, bank interest..." required />
                        </div>
                        <div className="space-y-1.5 md:col-span-2">
                          <Label>Memo</Label>
                          <Textarea value={income.memo} onChange={(e) => setIncome((v) => ({ ...v, memo: e.target.value }))} />
                        </div>
                        <p className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground md:col-span-2">
                          Use this only for non-member income. Member payments should still be recorded through the payment flow to avoid double counting.
                        </p>
                        <Button type="submit" className="md:col-span-2">Record Income</Button>
                      </form>
                    </CardContent>
                  </Card>
                </TabsContent>
              )}

              {canManageAccounting && (
                <TabsContent value="transfers">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Transfer Between Asset Accounts</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <form className="grid gap-3 md:grid-cols-2" onSubmit={handleTransfer}>
                        <div className="space-y-1.5">
                          <Label>From</Label>
                          <Select value={transfer.fromAccountId} onValueChange={(value) => setTransfer((v) => ({ ...v, fromAccountId: value }))}>
                            <SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger>
                            <SelectContent>{cashBankAssetAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>To</Label>
                          <Select value={transfer.toAccountId} onValueChange={(value) => setTransfer((v) => ({ ...v, toAccountId: value }))}>
                            <SelectTrigger><SelectValue placeholder="Select destination" /></SelectTrigger>
                            <SelectContent>{cashBankAssetAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Amount</Label>
                          <Input type="number" min="0" step="0.01" value={transfer.amount} onChange={(e) => setTransfer((v) => ({ ...v, amount: e.target.value }))} required />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Date</Label>
                          <Input type="date" value={transfer.entryDate} onChange={(e) => setTransfer((v) => ({ ...v, entryDate: e.target.value }))} />
                        </div>
                        <div className="space-y-1.5 md:col-span-2">
                          <Label>Description</Label>
                          <Input value={transfer.description} onChange={(e) => setTransfer((v) => ({ ...v, description: e.target.value }))} required />
                        </div>
                        <Button type="submit" className="md:col-span-2">Record Transfer</Button>
                      </form>
                    </CardContent>
                  </Card>
                </TabsContent>
              )}

              <TabsContent value="reports">
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Profit & Loss</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="mb-4 grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label>From</Label>
                          <Input
                            type="date"
                            value={fromDate}
                            onChange={(e) => {
                              setAccountingPeriod("custom");
                              setFromDate(e.target.value);
                            }}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>To</Label>
                          <Input
                            type="date"
                            value={toDate}
                            onChange={(e) => {
                              setAccountingPeriod("custom");
                              setToDate(e.target.value);
                            }}
                          />
                        </div>
                        <Button
                          type="button"
                          className="sm:col-span-2"
                          onClick={() => loadAccounting()}
                          disabled={loadingData}
                        >
                          Generate Profit &amp; Loss
                        </Button>
                      </div>
                      <ReportRows title="Income" rows={plReport?.income ?? []} />
                      <ReportRows title="Expenses" rows={plReport?.expenses ?? []} />
                      <div className="mt-3 border-t pt-3 text-sm">
                        <div className="flex justify-between"><span>Income</span><strong>{formatRs(plReport?.incomeTotal ?? 0)}</strong></div>
                        <div className="flex justify-between"><span>Expenses</span><strong>{formatRs(plReport?.expenseTotal ?? 0)}</strong></div>
                        <div className="flex justify-between text-base"><span>Net Income</span><strong>{formatRs(plReport?.netIncome ?? 0)}</strong></div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Statement of Financial Position</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="mb-4 space-y-1.5">
                        <Label>As Of</Label>
                        <Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
                        <Button
                          type="button"
                          className="mt-3 w-full"
                          onClick={() => loadAccounting()}
                          disabled={loadingData}
                        >
                          Generate Statement
                        </Button>
                      </div>
                      <ReportRows title="Assets" rows={(balanceSheet?.assets ?? []).map((a) => ({ id: a.id, name: accountDisplayName(a), amount: a.balance ?? 0 }))} />
                      <ReportRows title="Liabilities" rows={(balanceSheet?.liabilities ?? []).map((a) => ({ id: a.id, name: accountDisplayName(a), amount: a.balance ?? 0 }))} />
                      <ReportRows title="Fund Balances" rows={(balanceSheet?.equity ?? []).map((a) => ({ id: a.id, name: accountDisplayName(a), amount: a.balance ?? 0 }))} />
                      <div className="mt-3 border-t pt-3 text-sm">
                        <div className="flex justify-between"><span>Assets</span><strong>{formatRs(balanceSheet?.assetTotal ?? 0)}</strong></div>
                        <div className="flex justify-between"><span>Liabilities + Fund Balances</span><strong>{formatRs(balanceSheet?.liabilitiesAndEquityTotal ?? 0)}</strong></div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="lg:col-span-2">
                    <CardHeader>
                      <CardTitle className="text-base">Project Fund Summary Report</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-[180px_1fr_210px]">
                        <div className="space-y-1.5">
                          <Label>Fund Status</Label>
                          <Select value={fundReportStatus} onValueChange={(value) => setFundReportStatus(value as FundReportStatus)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(fundReportStatusLabels).map(([value, label]) => (
                                <SelectItem key={value} value={value}>{label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Fund Name</Label>
                          <Select value={fundReportFundId} onValueChange={setFundReportFundId}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All Funds</SelectItem>
                              {funds.map((fund) => (
                                <SelectItem key={fund.id} value={fund.id}>{fund.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Period</Label>
                          <Select value={fundReportPeriod} onValueChange={handleFundReportPeriodChange}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(fundReportPeriodLabels).map(([value, label]) => (
                                <SelectItem key={value} value={value}>{label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {fundReportPeriod === "custom" ? (
                          <>
                            <div className="space-y-1.5">
                              <Label>From</Label>
                              <Input type="date" value={fundReportFromDate} onChange={(e) => setFundReportFromDate(e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                              <Label>To</Label>
                              <Input type="date" value={fundReportToDate} onChange={(e) => setFundReportToDate(e.target.value)} />
                            </div>
                          </>
                        ) : null}
                        <div className="flex items-end">
                          <Button
                            type="button"
                            className="w-full"
                            onClick={() => loadAccounting()}
                            disabled={loadingData}
                          >
                            Generate Fund Summary
                          </Button>
                        </div>
                      </div>

                      <div className="overflow-x-auto rounded-md border">
                        <table className="w-full min-w-[900px] text-sm">
                          <thead className="bg-muted/50">
                            <tr>
                              <th className="p-2 text-left font-medium">Fund Name</th>
                              <th className="p-2 text-left font-medium">Status</th>
                              <th className="p-2 text-right font-medium">Opening Balance</th>
                              <th className="p-2 text-right font-medium">Total Collected</th>
                              <th className="p-2 text-right font-medium">Total Spent</th>
                              <th className="p-2 text-right font-medium">Total Transferred</th>
                              <th className="p-2 text-right font-medium">Remaining Balance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(fundSummaryReport?.rows ?? []).map((row) => (
                              <tr key={row.id} className="border-t">
                                <td className="p-2">
                                  <div className="font-medium">{row.name}</div>
                                  {row.managerName ? <div className="text-xs text-muted-foreground">Manager: {row.managerName}</div> : null}
                                </td>
                                <td className="p-2 capitalize text-muted-foreground">{row.status}</td>
                                <td className="p-2 text-right tabular-nums">{formatRs(row.openingBalance)}</td>
                                <td className="p-2 text-right tabular-nums">{formatRs(row.totalCollected)}</td>
                                <td className="p-2 text-right tabular-nums">{formatRs(row.totalSpent)}</td>
                                <td className="p-2 text-right tabular-nums">{formatRs(row.totalTransferred)}</td>
                                <td className="p-2 text-right font-semibold tabular-nums">{formatRs(row.remainingBalance)}</td>
                              </tr>
                            ))}
                            {(fundSummaryReport?.rows ?? []).length === 0 ? (
                              <tr>
                                <td colSpan={7} className="p-6 text-center text-muted-foreground">No fund activity found for this filter.</td>
                              </tr>
                            ) : null}
                          </tbody>
                          <tfoot className="border-t bg-muted/30 font-semibold">
                            <tr>
                              <td className="p-2" colSpan={2}>Total</td>
                              <td className="p-2 text-right tabular-nums">{formatRs(fundSummaryReport?.totals.openingBalance ?? 0)}</td>
                              <td className="p-2 text-right tabular-nums">{formatRs(fundSummaryReport?.totals.totalCollected ?? 0)}</td>
                              <td className="p-2 text-right tabular-nums">{formatRs(fundSummaryReport?.totals.totalSpent ?? 0)}</td>
                              <td className="p-2 text-right tabular-nums">{formatRs(fundSummaryReport?.totals.totalTransferred ?? 0)}</td>
                              <td className="p-2 text-right tabular-nums">{formatRs(fundSummaryReport?.totals.remainingBalance ?? 0)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="journal">
                <Card>
                  <CardHeader className="flex flex-row items-center gap-3 space-y-0">
                    <ReceiptText className="h-5 w-5 text-muted-foreground" />
                    <CardTitle className="text-base">Journal Entries</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <form
                      className="grid gap-3 rounded-md border bg-muted/20 p-3 lg:grid-cols-[1.3fr_180px_160px_150px_150px_170px_auto]"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void loadAccounting({
                          journalSearch,
                          journalEntryKind,
                          journalFromDate,
                          journalToDate,
                          journalSortOrder,
                        });
                      }}
                    >
                      <div className="space-y-1.5">
                        <Label>Search</Label>
                        <Input
                          value={journalSearch}
                          onChange={(event) => setJournalSearch(event.target.value)}
                          placeholder="Description, account, reference, user"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Type</Label>
                        <Select value={journalEntryKind} onValueChange={(value) => setJournalEntryKind(value as JournalEntryKind)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(journalEntryKindLabels).map(([value, label]) => (
                              <SelectItem key={value} value={value}>{label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Period</Label>
                        <Select value={journalPeriod} onValueChange={handleJournalPeriodChange}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all_time">All Time</SelectItem>
                            <SelectItem value="this_month">This Month</SelectItem>
                            <SelectItem value="this_year">This Year</SelectItem>
                            <SelectItem value="custom">Custom</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>From</Label>
                        <Input
                          type="date"
                          value={journalFromDate}
                          onChange={(event) => {
                            setJournalPeriod("custom");
                            setJournalFromDate(event.target.value);
                          }}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>To</Label>
                        <Input
                          type="date"
                          value={journalToDate}
                          onChange={(event) => {
                            setJournalPeriod("custom");
                            setJournalToDate(event.target.value);
                          }}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Sort by time</Label>
                        <Select value={journalSortOrder} onValueChange={handleJournalSortChange}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="desc">Newest first</SelectItem>
                            <SelectItem value="asc">Oldest first</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-end">
                        <Button type="submit" className="w-full" disabled={loadingData}>
                          Apply
                        </Button>
                      </div>
                    </form>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>
                        Showing {journal.length} of {journalTotal} entries
                        {journalPeriodLabel ? ` · ${journalPeriodLabel}` : ""}
                        {journalEntryKind !== "all" ? ` · ${journalEntryKindLabels[journalEntryKind]}` : ""}
                      </span>
                      {(journalSearch || journalEntryKind !== "all" || journalFromDate || journalToDate || journalPeriod !== "all_time") && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            setJournalSearch("");
                            setJournalEntryKind("all");
                            setJournalPeriod("all_time");
                            setJournalFromDate("");
                            setJournalToDate("");
                            void loadAccounting({
                              journalSearch: "",
                              journalEntryKind: "all",
                              journalFromDate: "",
                              journalToDate: "",
                            });
                          }}
                        >
                          Clear filters
                        </Button>
                      )}
                    </div>
                    {journal.length === 0 ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        No journal entries yet. New payments, expenses, transfers, and credit allocations will appear here.
                      </p>
                    ) : (
                      journal.map((entry) => (
                        <div key={entry.id} className="rounded-md border p-3">
                          <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-medium">{entry.description}</p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(entry.entryDate).toLocaleDateString()} · {entry.entryType.replace(/_/g, " ")}
                                {entry.isSystemEntry ? " · System" : ""}
                              </p>
                            </div>
                            <p className="text-xs text-muted-foreground">{entry.createdBy?.email ?? ""}</p>
                          </div>
                          <table className="w-full text-sm">
                            <tbody>
                              {entry.lines.map((line) => (
                                <tr key={line.id} className="border-t">
                                  <td className="py-1.5">{accountDisplayName(line.account)}</td>
                                  <td className="py-1.5 text-right text-muted-foreground">{line.side}</td>
                                  <td className="py-1.5 text-right tabular-nums">{formatRs(line.amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
        </>
      </main>
    </div>
  );
}

function ReportRows({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ id: string; name: string; amount: number }>;
}) {
  return (
    <div className="mb-3">
      <p className="mb-1 text-sm font-medium text-muted-foreground">{title}</p>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-2 text-sm text-muted-foreground">No activity</p>
      ) : (
        <div className="rounded-md border">
          {rows.map((row) => (
            <div key={row.id} className="flex justify-between border-t px-3 py-2 text-sm first:border-t-0">
              <span>{row.name}</span>
              <span className="tabular-nums">{formatRs(row.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
