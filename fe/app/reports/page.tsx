"use client";

import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, apiUrl, type DueType, type Zone } from "@/lib/api";
import { Header } from "@/components/header";
import { AbstractBg } from "@/components/abstract-bg";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowRight, Banknote, FileText, Download, Search, Filter, Receipt, Scale, TrendingDown, TrendingUp } from "lucide-react";
import { Breadcrumb } from "@/components/breadcrumb";
import { dashboardFlowHref } from "@/lib/dashboard-flows";

type EntityType =
  | "persons"
  | "memberships"
  | "payments"
  | "distributions"
  | "memberCredits"
  | "outstandingBalances"
  | "outstandingBreakdown";

const MEMBERSHIP_TYPES = ["Resident", "NonResident", "Widow", "Widower"];
const MEMBERSHIP_STATUSES = ["Active", "Inactive"];

type MultiSelectOption = {
  value: string;
  label: string;
};

function MultiSelectFilter({
  label,
  options,
  selectedValues,
  onChange,
  placeholder,
}: {
  label: string;
  options: MultiSelectOption[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}) {
  const selectedLabels = options
    .filter((option) => selectedValues.includes(option.value))
    .map((option) => option.label);
  const summary =
    selectedLabels.length > 2
      ? `${selectedLabels.slice(0, 2).join(", ")} +${selectedLabels.length - 2} more`
      : selectedLabels.join(", ");

  function toggleValue(value: string, checked: boolean) {
    onChange(
      checked
        ? [...selectedValues, value]
        : selectedValues.filter((selectedValue) => selectedValue !== value),
    );
  }

  return (
    <div className="relative">
      <label className="text-sm font-medium block mb-2">{label}</label>
      <details className="group relative">
        <summary className="flex h-10 w-full cursor-pointer list-none items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 [&::-webkit-details-marker]:hidden">
          <span
            className={cn(
              "truncate",
              selectedLabels.length === 0 && "text-muted-foreground",
            )}
          >
            {selectedLabels.length ? summary : placeholder}
          </span>
          <span className="ml-2 text-xs text-muted-foreground transition-transform group-open:rotate-180">
            v
          </span>
        </summary>
        <div className="absolute z-30 mt-1 w-full rounded-md border bg-popover p-2 shadow-md">
          <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
            {options.length === 0 && (
              <p className="px-2 py-1.5 text-sm text-muted-foreground">No options available</p>
            )}
            {options.map((option) => {
              const checkboxId = `report-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${option.value}`;
              const checked = selectedValues.includes(option.value);
              return (
                <div key={option.value} className="flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent">
                  <Checkbox
                    id={checkboxId}
                    checked={checked}
                    onCheckedChange={(value) => toggleValue(option.value, value === true)}
                  />
                  <label htmlFor={checkboxId} className="flex-1 cursor-pointer text-sm">
                    {option.label}
                  </label>
                </div>
              );
            })}
          </div>
          {selectedValues.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 h-8 w-full"
              onClick={() => onChange([])}
            >
              Clear selection
            </Button>
          )}
        </div>
      </details>
    </div>
  );
}

const PAYMENT_STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
];

interface PersonResult {
  id: string;
  fullName: string;
  nameWithInitials: string;
  dateOfBirth: string | null;
  isDisabled: boolean;
  isMadarasaStudent: boolean;
  membershipId: string | null;
}

interface MembershipResult {
  id: string;
  membershipNo: string;
  memberZone: string;
  nameWithInitials: string;
  fullName: string;
  membershipType: string;
  membershipStatus: string;
  totalHeadcount: number;
  adults: number;
  youth: number;
  children: number;
  paymentPeriod: string;
  membershipFee: number;
  discountAmount: number;
  voluntaryContributionAmount: number;
  totalContribution: number;
}

interface PaymentResult {
  id: string;
  membershipId: string;
  paymentKind: "due" | "credit";
  amount: number;
  paymentDate: string;
  note: string | null;
  membership?: { membershipNo: string };
  paymentDue?: { period: string; amountDue: number };
}

interface DistributionRecordResult {
  id: string;
  personId: string;
  personName: string;
  distributedAt: string;
  distributionDate: string;
}

interface MemberCreditLiabilityResult {
  membershipId: string;
  membershipNo: string;
  membershipType: string;
  membershipStatus: string;
  hodName: string;
  creditBalance: number;
}

interface OutstandingBalanceResult {
  membershipId: string;
  memberName: string;
  zone: string;
  membershipNo: string;
  totalOutstanding: number;
}

interface OutstandingBreakdownResult extends OutstandingBalanceResult {
  dueTypeAmounts: Record<string, number>;
}

type ReportResult =
  | PersonResult[]
  | MembershipResult[]
  | PaymentResult[]
  | DistributionRecordResult[]
  | MemberCreditLiabilityResult[]
  | OutstandingBalanceResult[]
  | OutstandingBreakdownResult[];

export default function ReportsPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [entity, setEntity] = useState<EntityType>("persons");

  // Entity-specific filter state (kept in sync for controlled inputs)
  const [membershipTypes, setMembershipTypes] = useState<string[]>([]);
  const [membershipZones, setMembershipZones] = useState<string[]>([]);
  const [membershipStatuses, setMembershipStatuses] = useState<string[]>([]);
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [isDisabled, setIsDisabled] = useState(false);
  const [isDisabledFilter, setIsDisabledFilter] = useState(false);
  const [isMadarasaStudent, setIsMadarasaStudent] = useState(false);
  const [isMadarasaFilter, setIsMadarasaFilter] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState("__all__");
  const [distributionId, setDistributionId] = useState("");
  const [areaCode, setAreaCode] = useState("__all__");
  const [dueTypeId, setDueTypeId] = useState("__all__");
  const [zones, setZones] = useState<Zone[]>([]);
  const [dueTypes, setDueTypes] = useState<DueType[]>([]);

  const [results, setResults] = useState<ReportResult>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user?.organizationId) return;
    api<Zone[]>("/zones", { params: { includeInactive: "true" } })
      .then(setZones)
      .catch(() => setZones([]));
    api<DueType[]>("/due-types", { params: { includeInactive: "true" } })
      .then(setDueTypes)
      .catch(() => setDueTypes([]));
  }, [user?.organizationId]);

  function buildFilters(): Record<string, unknown> {
    const f: Record<string, unknown> = {};
    const ps = paymentStatus !== "__all__" ? paymentStatus : "";
    if (entity === "persons") {
      if (membershipTypes.length > 0) f.membershipTypes = membershipTypes;
      if (membershipZones.length > 0) {
        f.membershipZones = membershipZones
          .map((zone) => Number.parseInt(zone, 10))
          .filter((zone) => Number.isInteger(zone));
      }
      if (membershipStatuses.length > 0) f.membershipStatuses = membershipStatuses;
      const min = parseInt(minAge, 10);
      if (!isNaN(min)) f.minAge = min;
      const max = parseInt(maxAge, 10);
      if (!isNaN(max)) f.maxAge = max;
      if (isDisabledFilter) f.isDisabled = isDisabled;
      if (isMadarasaFilter) f.isMadarasaStudent = isMadarasaStudent;
    } else if (entity === "memberships") {
      if (membershipTypes.length > 0) f.membershipTypes = membershipTypes;
      if (membershipZones.length > 0) {
        f.membershipZones = membershipZones
          .map((zone) => Number.parseInt(zone, 10))
          .filter((zone) => Number.isInteger(zone));
      }
      if (membershipStatuses.length > 0) f.membershipStatuses = membershipStatuses;
    } else if (entity === "payments") {
      if (ps) f.paymentStatus = ps;
    } else if (entity === "distributions") {
      if (distributionId.trim()) f.distributionId = distributionId.trim();
    } else if (entity === "outstandingBalances") {
      if (areaCode !== "__all__") f.areaCode = areaCode;
    } else if (entity === "outstandingBreakdown") {
      if (areaCode !== "__all__") f.areaCode = areaCode;
      if (dueTypeId !== "__all__") f.dueTypeId = dueTypeId;
    }
    return f;
  }

  async function handleQuery() {
    if (entity === "distributions" && !distributionId.trim()) {
      setError(t("reports.distributionIdRequired"));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const f = buildFilters();
      const data = await api<ReportResult>("/reports/query", {
        method: "POST",
        body: JSON.stringify({ entity, filters: f }),
      });
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run query");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleExport() {
    if (entity === "distributions" && !distributionId.trim()) {
      setError(t("reports.distributionIdRequiredExport"));
      return;
    }
    setError(null);
    setExporting(true);
    try {
      const f = buildFilters();
      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
      const url =
        apiUrl("/reports/export") +
        `?entity=${entity}&filters=${encodeURIComponent(JSON.stringify(f))}`;
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error((err as { error?: string }).error || "Export failed");
      }
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${entity}-export.csv`;
      a.click();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export CSV");
    } finally {
      setExporting(false);
    }
  }

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  const memberCreditRows =
    entity === "memberCredits" ? (results as MemberCreditLiabilityResult[]) : [];
  const totalLiability = memberCreditRows.reduce(
    (sum, row) => sum + Number(row.creditBalance || 0),
    0,
  );
  const outstandingBalanceRows =
    entity === "outstandingBalances" ? (results as OutstandingBalanceResult[]) : [];
  const outstandingBreakdownRows =
    entity === "outstandingBreakdown" ? (results as OutstandingBreakdownResult[]) : [];
  const selectedDueTypeNames =
    dueTypeId !== "__all__"
      ? dueTypes.filter((dueType) => dueType.id === dueTypeId).map((dueType) => dueType.name)
      : dueTypes.filter((dueType) => dueType.isActive).map((dueType) => dueType.name);
  const resultDueTypeNames = Array.from(
    new Set(
      outstandingBreakdownRows.flatMap((row) =>
        Object.keys(row.dueTypeAmounts || {}).filter(
          (name) => Number(row.dueTypeAmounts?.[name] || 0) > 0
        )
      )
    )
  );
  const breakdownColumns =
    entity === "outstandingBreakdown"
      ? (resultDueTypeNames.length > 0 ? resultDueTypeNames : selectedDueTypeNames).filter(
          (name) =>
            outstandingBreakdownRows.some((row) => Number(row.dueTypeAmounts?.[name] || 0) > 0) ||
            dueTypeId !== "__all__"
        )
      : [];
  const totalOutstandingBalance = outstandingBalanceRows.reduce(
    (sum, row) => sum + Number(row.totalOutstanding || 0),
    0,
  );
  const totalOutstandingBreakdown = outstandingBreakdownRows.reduce(
    (sum, row) => sum + Number(row.totalOutstanding || 0),
    0,
  );
  const membershipTypeOptions = MEMBERSHIP_TYPES.map((membershipType) => ({
    value: membershipType,
    label: membershipType,
  }));
  const membershipStatusOptions = MEMBERSHIP_STATUSES.map((membershipStatus) => ({
    value: membershipStatus,
    label: membershipStatus,
  }));
  const membershipZoneOptions = zones.map((zone) => ({
    value: String(zone.code),
    label: `${zone.code} - ${zone.name}`,
  }));

  return (
    <div className="min-h-screen bg-background relative">
      <AbstractBg />
      <Header />
      <main className="relative z-10 p-6 max-w-6xl mx-auto">
        <Breadcrumb
          items={[{ label: t("dashboard.title"), href: dashboardFlowHref("reports") }, { label: t("reports.title") }]}
        />

        <div className="flex items-center justify-between mb-5">
          <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            {t("reports.title")}
          </h1>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}

        <Card className="mb-6 border-slate-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Financial Reports</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <Link href="/reports/profit-loss" className="group flex items-center gap-3 rounded-xl border border-slate-200 p-4 transition-colors hover:border-primary/40 hover:bg-slate-50">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700"><Scale className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-slate-900">Profit &amp; Loss Report</span>
                <span className="mt-0.5 block text-xs text-slate-500">Compare income and expenses, including special fund results and net margin.</span>
              </span>
              <ArrowRight className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link href="/reports/payments" className="group flex items-center gap-3 rounded-xl border border-slate-200 p-4 transition-colors hover:border-primary/40 hover:bg-slate-50">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><Receipt className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-slate-900">Member Payment Report</span>
                <span className="mt-0.5 block text-xs text-slate-500">Review member receipts, reversals, payment methods, and due type collections.</span>
              </span>
              <ArrowRight className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link href="/reports/cash-movement" className="group flex items-center gap-3 rounded-xl border border-slate-200 p-4 transition-colors hover:border-primary/40 hover:bg-slate-50">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700"><Banknote className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-slate-900">Cash Movement Report</span>
                <span className="mt-0.5 block text-xs text-slate-500">Reconcile money received, paid, transferred, and held.</span>
              </span>
              <ArrowRight className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link href="/reports/income-account" className="group flex items-center gap-3 rounded-xl border border-slate-200 p-4 transition-colors hover:border-primary/40 hover:bg-slate-50">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><TrendingUp className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-slate-900">Income Account Report</span>
                <span className="mt-0.5 block text-xs text-slate-500">Review receipts, reversals, and net income by account.</span>
              </span>
              <ArrowRight className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link href="/reports/expense-account" className="group flex items-center gap-3 rounded-xl border border-slate-200 p-4 transition-colors hover:border-primary/40 hover:bg-slate-50">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-sky-700"><TrendingDown className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-slate-900">Expense Account Report</span>
                <span className="mt-0.5 block text-xs text-slate-500">Review payments, reversals, and net expenses by account.</span>
              </span>
              <ArrowRight className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </CardContent>
        </Card>

        <Card className="border-primary/20 mb-6">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="h-4 w-4 text-primary" />
              {t("reports.buildReport")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="text-sm font-medium block mb-2">
                  {t("reports.entity")}
                </label>
                <Select
                  value={entity}
                  onValueChange={(v) => setEntity(v as EntityType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="persons">{t("reports.persons")}</SelectItem>
                    <SelectItem value="memberships">Membership Data Report</SelectItem>
                    <SelectItem value="distributions">{t("reports.distributions")}</SelectItem>
                    <SelectItem value="memberCredits">Member Credit Liability</SelectItem>
                    <SelectItem value="outstandingBalances">Outstanding Balance Report</SelectItem>
                    <SelectItem value="outstandingBreakdown">Outstanding Breakdown Report</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {entity === "persons" && (
                <>
                  <MultiSelectFilter
                    label={t("reports.membershipType")}
                    options={membershipTypeOptions}
                    selectedValues={membershipTypes}
                    onChange={setMembershipTypes}
                    placeholder={t("reports.any")}
                  />
                  <MultiSelectFilter
                    label="Member Zone"
                    options={membershipZoneOptions}
                    selectedValues={membershipZones}
                    onChange={setMembershipZones}
                    placeholder={t("reports.any")}
                  />
                  <MultiSelectFilter
                    label="Membership Status"
                    options={membershipStatusOptions}
                    selectedValues={membershipStatuses}
                    onChange={setMembershipStatuses}
                    placeholder={t("reports.any")}
                  />
                  <div>
                    <label className="text-sm font-medium block mb-2">
                      {t("reports.minAge")}
                    </label>
                    <Input
                      type="number"
                      min={0}
                      placeholder={t("reports.any")}
                      value={minAge}
                      onChange={(e) => setMinAge(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-2">
                      {t("reports.maxAge")}
                    </label>
                    <Input
                      type="number"
                      min={0}
                      placeholder={t("reports.any")}
                      value={maxAge}
                      onChange={(e) => setMaxAge(e.target.value)}
                    />
                  </div>
                  <div className="flex items-center gap-2 sm:col-span-2">
                    <Checkbox
                      id="filter-disabled"
                      checked={isDisabledFilter}
                      onCheckedChange={(c) =>
                        setIsDisabledFilter(c === true)
                      }
                    />
                    <label
                      htmlFor="filter-disabled"
                      className="text-sm font-medium cursor-pointer"
                    >
                      {t("reports.filterByDisabled")}
                    </label>
                    {isDisabledFilter && (
                      <Select
                        value={isDisabled ? "true" : "false"}
                        onValueChange={(v) => setIsDisabled(v === "true")}
                      >
                        <SelectTrigger className="w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="true">{t("common.yes")}</SelectItem>
                          <SelectItem value="false">{t("common.no")}</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  <div className="flex items-center gap-2 sm:col-span-2">
                    <Checkbox
                      id="filter-madarasa"
                      checked={isMadarasaFilter}
                      onCheckedChange={(c) =>
                        setIsMadarasaFilter(c === true)
                      }
                    />
                    <label
                      htmlFor="filter-madarasa"
                      className="text-sm font-medium cursor-pointer"
                    >
                      {t("reports.filterByMadarasa")}
                    </label>
                    {isMadarasaFilter && (
                      <Select
                        value={isMadarasaStudent ? "true" : "false"}
                        onValueChange={(v) => setIsMadarasaStudent(v === "true")}
                      >
                        <SelectTrigger className="w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="true">{t("common.yes")}</SelectItem>
                          <SelectItem value="false">{t("common.no")}</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </>
              )}

              {entity === "memberships" && (
                <>
                  <MultiSelectFilter
                    label={t("reports.membershipType")}
                    options={membershipTypeOptions}
                    selectedValues={membershipTypes}
                    onChange={setMembershipTypes}
                    placeholder={t("reports.any")}
                  />
                  <MultiSelectFilter
                    label="Member Zone"
                    options={membershipZoneOptions}
                    selectedValues={membershipZones}
                    onChange={setMembershipZones}
                    placeholder={t("reports.any")}
                  />
                  <MultiSelectFilter
                    label="Membership Status"
                    options={membershipStatusOptions}
                    selectedValues={membershipStatuses}
                    onChange={setMembershipStatuses}
                    placeholder={t("reports.any")}
                  />
                </>
              )}

              {entity === "payments" && (
                <div>
                  <label className="text-sm font-medium block mb-2">
                    {t("reports.paymentStatus")}
                  </label>
                  <Select
                    value={paymentStatus}
                    onValueChange={setPaymentStatus}
                  >
                  <SelectTrigger>
                    <SelectValue placeholder={t("reports.any")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{t("reports.any")}</SelectItem>
                    {PAYMENT_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {t(`payments.${s.value}`)}
                      </SelectItem>
                    ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {entity === "distributions" && (
                <div>
                    <label className="text-sm font-medium block mb-2">
                    {t("reports.distributionId")} <span className="text-destructive">*</span>
                  </label>
                  <Input
                    placeholder={t("reports.enterDistributionId")}
                    value={distributionId}
                    onChange={(e) => setDistributionId(e.target.value)}
                  />
                </div>
              )}

              {entity === "outstandingBalances" && (
                <div>
                  <label className="text-sm font-medium block mb-2">Member Zone</label>
                  <Select value={areaCode} onValueChange={setAreaCode}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("reports.any")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">{t("reports.any")}</SelectItem>
                      {zones.map((zone) => (
                        <SelectItem key={zone.id} value={String(zone.code)}>
                          {zone.code} - {zone.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {entity === "outstandingBreakdown" && (
                <>
                  <div>
                    <label className="text-sm font-medium block mb-2">Member Zone</label>
                    <Select value={areaCode} onValueChange={setAreaCode}>
                      <SelectTrigger>
                        <SelectValue placeholder={t("reports.any")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">{t("reports.any")}</SelectItem>
                        {zones.map((zone) => (
                          <SelectItem key={zone.id} value={String(zone.code)}>
                            {zone.code} - {zone.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-2">Due Type</label>
                    <Select value={dueTypeId} onValueChange={setDueTypeId}>
                      <SelectTrigger>
                        <SelectValue placeholder={t("reports.any")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">{t("reports.any")}</SelectItem>
                        {dueTypes
                          .filter((dueType) => dueType.isActive)
                          .map((dueType) => (
                            <SelectItem key={dueType.id} value={dueType.id}>
                              {dueType.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                onClick={handleQuery}
                disabled={loading}
                className="gap-2"
              >
                <Search className="h-4 w-4" />
                {loading ? t("reports.querying") : t("reports.query")}
              </Button>
              <Button
                variant="outline"
                onClick={handleExport}
                disabled={exporting}
                className="gap-2"
              >
                <Download className="h-4 w-4" />
                {exporting ? t("reports.exporting") : t("reports.exportCSV")}
              </Button>
            </div>
          </CardContent>
        </Card>

        {results.length > 0 && (
          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle className="text-base">
                {t("reports.results")} ({results.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {entity === "memberCredits" && (
                <div className="mb-4 rounded-lg border bg-muted/30 px-4 py-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Total Liability
                  </p>
                  <p className="text-2xl font-semibold tabular-nums">
                    {totalLiability.toFixed(2)}
                  </p>
                </div>
              )}
              {entity === "outstandingBalances" && (
                <div className="mb-4 rounded-lg border bg-muted/30 px-4 py-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Total Outstanding
                  </p>
                  <p className="text-2xl font-semibold tabular-nums">
                    {totalOutstandingBalance.toFixed(2)}
                  </p>
                </div>
              )}
              {entity === "outstandingBreakdown" && (
                <div className="mb-4 rounded-lg border bg-muted/30 px-4 py-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Total Outstanding
                  </p>
                  <p className="text-2xl font-semibold tabular-nums">
                    {totalOutstandingBreakdown.toFixed(2)}
                  </p>
                </div>
              )}
              <div className="rounded-md border overflow-x-auto">
                {entity === "persons" && (
                  <table className="w-full text-sm min-w-[500px]">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-3 font-medium">Name</th>
                        <th className="text-left p-3 font-medium">Initials</th>
                        <th className="text-left p-3 font-medium">DOB</th>
                        <th className="text-center p-3 font-medium">Disabled</th>
                        <th className="text-center p-3 font-medium">Madarasa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(results as PersonResult[]).map((r) => (
                        <tr key={r.id} className="border-t">
                          <td className="p-3">{r.fullName}</td>
                          <td className="p-3 text-muted-foreground">
                            {r.nameWithInitials}
                          </td>
                          <td className="p-3">
                            {r.dateOfBirth
                              ? new Date(r.dateOfBirth).toLocaleDateString()
                              : "—"}
                          </td>
                          <td className="p-3 text-center">
                            {r.isDisabled ? "Yes" : "No"}
                          </td>
                          <td className="p-3 text-center">
                            {r.isMadarasaStudent ? "Yes" : "No"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {entity === "memberships" && (
                  <table className="w-full text-sm min-w-[1500px]">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-3 font-medium">Membership No</th>
                        <th className="text-left p-3 font-medium">Member Zone</th>
                        <th className="text-left p-3 font-medium">Name with Initials</th>
                        <th className="text-left p-3 font-medium">Full Name</th>
                        <th className="text-left p-3 font-medium">Membership Type</th>
                        <th className="text-left p-3 font-medium">Membership Status</th>
                        <th className="text-right p-3 font-medium">Total Headcount</th>
                        <th className="text-right p-3 font-medium">Adults (18+)</th>
                        <th className="text-right p-3 font-medium">Youth (13-17)</th>
                        <th className="text-right p-3 font-medium">Children (0-12)</th>
                        <th className="text-left p-3 font-medium">Payment Period</th>
                        <th className="text-right p-3 font-medium">Membership Fee</th>
                        <th className="text-right p-3 font-medium">Discount Amount</th>
                        <th className="text-right p-3 font-medium">Voluntary Contribution Amount</th>
                        <th className="text-right p-3 font-medium">Total Contribution</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(results as MembershipResult[]).map((r) => (
                        <tr key={r.id} className="border-t">
                          <td className="p-3 font-medium">{r.membershipNo}</td>
                          <td className="p-3">{r.memberZone || "—"}</td>
                          <td className="p-3">{r.nameWithInitials || "—"}</td>
                          <td className="p-3">{r.fullName || "—"}</td>
                          <td className="p-3">{r.membershipType}</td>
                          <td className="p-3">{r.membershipStatus}</td>
                          <td className="p-3 text-right tabular-nums">{r.totalHeadcount}</td>
                          <td className="p-3 text-right tabular-nums">{r.adults}</td>
                          <td className="p-3 text-right tabular-nums">{r.youth}</td>
                          <td className="p-3 text-right tabular-nums">{r.children}</td>
                          <td className="p-3">{r.paymentPeriod || "—"}</td>
                          <td className="p-3 text-right tabular-nums">{Number(r.membershipFee).toFixed(2)}</td>
                          <td className="p-3 text-right tabular-nums">{Number(r.discountAmount).toFixed(2)}</td>
                          <td className="p-3 text-right tabular-nums">{Number(r.voluntaryContributionAmount).toFixed(2)}</td>
                          <td className="p-3 text-right tabular-nums">{Number(r.totalContribution).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {entity === "payments" && (
                  <table className="w-full text-sm min-w-[500px]">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-3 font-medium">Membership</th>
                        <th className="text-left p-3 font-medium">Period</th>
                        <th className="text-right p-3 font-medium">Amount</th>
                        <th className="text-left p-3 font-medium">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(results as PaymentResult[]).map((r) => (
                        <tr key={r.id} className="border-t">
                          <td className="p-3">
                            {r.membership?.membershipNo ?? r.membershipId}
                          </td>
                          <td className="p-3">
                            {r.paymentDue?.period ?? (r.paymentKind === "credit" ? "Credit Payment" : "—")}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {Number(r.amount).toFixed(2)}
                          </td>
                          <td className="p-3">
                            {new Date(r.paymentDate).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {entity === "distributions" && (
                  <table className="w-full text-sm min-w-[500px]">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-3 font-medium">Person</th>
                        <th className="text-left p-3 font-medium">
                          Distribution Date
                        </th>
                        <th className="text-left p-3 font-medium">
                          Distributed At
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(results as DistributionRecordResult[]).map((r) => (
                        <tr key={r.id} className="border-t">
                          <td className="p-3">{r.personName}</td>
                          <td className="p-3">{r.distributionDate}</td>
                          <td className="p-3 text-muted-foreground">
                            {new Date(r.distributedAt).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {entity === "memberCredits" && (
                  <table className="w-full text-sm min-w-[650px]">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-3 font-medium">Membership No.</th>
                        <th className="text-left p-3 font-medium">Head</th>
                        <th className="text-left p-3 font-medium">Type</th>
                        <th className="text-left p-3 font-medium">Status</th>
                        <th className="text-right p-3 font-medium">Liability</th>
                      </tr>
                    </thead>
                    <tbody>
                      {memberCreditRows.map((r) => (
                        <tr key={r.membershipId} className="border-t">
                          <td className="p-3 font-medium">{r.membershipNo || "—"}</td>
                          <td className="p-3">{r.hodName || "—"}</td>
                          <td className="p-3">{r.membershipType || "—"}</td>
                          <td className="p-3">{r.membershipStatus || "—"}</td>
                          <td className="p-3 text-right tabular-nums font-medium">
                            {Number(r.creditBalance).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {entity === "outstandingBalances" && (
                  <table className="w-full text-sm min-w-[650px]">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-3 font-medium">Member Name</th>
                        <th className="text-left p-3 font-medium">Zone</th>
                        <th className="text-left p-3 font-medium">Membership Number</th>
                        <th className="text-right p-3 font-medium">Total Outstanding</th>
                      </tr>
                    </thead>
                    <tbody>
                      {outstandingBalanceRows.map((r) => (
                        <tr key={r.membershipId} className="border-t">
                          <td className="p-3">{r.memberName || "—"}</td>
                          <td className="p-3 text-muted-foreground">{r.zone || "—"}</td>
                          <td className="p-3 font-medium">{r.membershipNo || "—"}</td>
                          <td className="p-3 text-right tabular-nums font-medium">
                            {Number(r.totalOutstanding).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {entity === "outstandingBreakdown" && (
                  <table className="w-full text-sm min-w-[900px]">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-3 font-medium">Member Name</th>
                        <th className="text-left p-3 font-medium">Zone</th>
                        <th className="text-left p-3 font-medium">Membership Number</th>
                        {breakdownColumns.map((column) => (
                          <th key={column} className="text-right p-3 font-medium">
                            {column}
                          </th>
                        ))}
                        <th className="text-right p-3 font-medium">Total Outstanding</th>
                      </tr>
                    </thead>
                    <tbody>
                      {outstandingBreakdownRows.map((r) => (
                        <tr key={r.membershipId} className="border-t">
                          <td className="p-3">{r.memberName || "—"}</td>
                          <td className="p-3 text-muted-foreground">{r.zone || "—"}</td>
                          <td className="p-3 font-medium">{r.membershipNo || "—"}</td>
                          {breakdownColumns.map((column) => (
                            <td key={`${r.membershipId}-${column}`} className="p-3 text-right tabular-nums">
                              {Number(r.dueTypeAmounts?.[column] || 0).toFixed(2)}
                            </td>
                          ))}
                          <td className="p-3 text-right tabular-nums font-medium">
                            {Number(r.totalOutstanding).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {!loading && results.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            {t("reports.runQueryHint")}
          </p>
        )}
      </main>
    </div>
  );
}
