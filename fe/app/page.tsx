"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  Users,
  Building2,
  UserPlus,
  UserCog,
  CreditCard,
  Baby,
  User,
  Home,
  Receipt,
  Banknote,
  ChevronRight,
  ScanLine,
  Repeat,
  Star,
  MessageSquare,
  Package,
  FileText,
  Settings,
  BarChart3,
  Landmark,
  Clock3,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Header } from "@/components/header";
import { AbstractBg } from "@/components/abstract-bg";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, DashboardStats, UserBookmark } from "@/lib/api";
import { useTranslation } from "@/lib/i18n";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  CartesianGrid,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from "recharts";

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

function formatCompactInteger(n: number) {
  if (Math.abs(n) < 100000) return String(n);
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  })
    .format(n)
    .replace(".0", "")
    .toLowerCase();
}

function formatCompactRs(n: number) {
  if (Math.abs(n) < 100000) return formatRs(n);
  return `Rs.${new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  })
    .format(n)
    .replace(".0", "")
    .toLowerCase()}`;
}

function formatPeriod(period: string) {
  const [start, end] = period.split(":");
  if (!start || !end) return period;
  return `${start} to ${end}`;
}

function relativeTime(value: string) {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 60) return `${Math.max(diffMinutes, 1)}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  return `${diffDays}d ago`;
}

function activityToneClass(tone?: string | null) {
  if (tone === "emerald") return "bg-emerald-100 text-emerald-700";
  if (tone === "rose") return "bg-rose-100 text-rose-700";
  if (tone === "orange") return "bg-orange-100 text-orange-700";
  if (tone === "violet") return "bg-violet-100 text-violet-700";
  if (tone === "slate") return "bg-slate-100 text-slate-700";
  return "bg-blue-100 text-blue-700";
}

function ActivityIcon({ kind, className }: { kind: string; className?: string }) {
  if (kind === "payment" || kind === "payment_reversal") return <CreditCard className={className} />;
  if (kind === "cash_out" || kind === "fund_expense") return <ArrowDownRight className={className} />;
  if (kind === "cash_in" || kind === "fund_collection" || kind === "income") return <ArrowUpRight className={className} />;
  if (kind === "remark") return <MessageSquare className={className} />;
  return <Receipt className={className} />;
}

function MiniSparkline({
  data,
  dataKey,
  stroke,
}: {
  data: Array<Record<string, any>>;
  dataKey: string;
  stroke: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <Line type="monotone" dataKey={dataKey} stroke={stroke} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
  className,
  colorA,
  colorB,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  className?: string;
  colorA?: string;
  colorB?: string;
}) {
  return (
    <div className={`rounded-lg border bg-card p-3 shadow-sm ${className ?? ""}`}>
      <div className="mb-3">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground">{subtitle}</div>
      </div>
      <div className="h-36">{children}</div>
    </div>
  );
}

type FlowAction = {
  actionKey: string;
  title: string;
  description: string;
  icon: LucideIcon;
  href?: string;
  action?: () => void;
  roles?: string[];
  disabled?: boolean;
  badge?: string;
};

type FlowTab = {
  value: string;
  label: string;
  actions: FlowAction[];
};

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            <p className="text-sm text-muted-foreground">Loading…</p>
          </div>
        </div>
      }
    >
      <HomePageContent />
    </Suspense>
  );
}

function HomePageContent() {
  const { user, loading } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsWindowDays, setStatsWindowDays] = useState("30");
  const [bookmarks, setBookmarks] = useState<UserBookmark[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState("");
  const [scanTargetTab, setScanTargetTab] = useState<"details" | "payments">("details");
  const [now, setNow] = useState(() => new Date());
  const scannerRef = useRef<any>(null);
  const scannerContainerId = "qr-reader";

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch {}
      try { scannerRef.current.clear(); } catch {}
      scannerRef.current = null;
    }
  }, []);

  const openScanner = useCallback((targetTab: "details" | "payments") => {
    setScanTargetTab(targetTab);
    setScannerOpen(true);
  }, []);

  const startScanner = useCallback(async () => {
    setScanError("");
    await stopScanner();
    // dynamic import to avoid SSR issues
    const { Html5Qrcode } = await import("html5-qrcode");
    const scanner = new Html5Qrcode(scannerContainerId);
    scannerRef.current = scanner;
    try {
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          try {
            const url = new URL(decodedText);
            const match = url.pathname.match(/\/members\/(.+)/);
            if (match) {
              const membershipId = match[1].split("?")[0];
              stopScanner();
              setScannerOpen(false);
              const nextPath = scanTargetTab === "payments" ? `/members/${membershipId}?tab=payments` : `/members/${membershipId}`;
              router.push(nextPath);
            }
          } catch {
            // not a valid URL, try as path
            if (decodedText.includes("/members/")) {
              const match = decodedText.match(/\/members\/(.+)/);
              if (match) {
                const membershipId = match[1].split("?")[0];
                stopScanner();
                setScannerOpen(false);
                const nextPath = scanTargetTab === "payments" ? `/members/${membershipId}?tab=payments` : `/members/${membershipId}`;
                router.push(nextPath);
              }
            }
          }
        },
        () => {},
      );
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Could not start camera");
    }
  }, [router, scanTargetTab, stopScanner]);

  useEffect(() => {
    if (scannerOpen) {
      const timer = setTimeout(startScanner, 300);
      return () => clearTimeout(timer);
    } else {
      stopScanner();
    }
  }, [scannerOpen, startScanner, stopScanner]);

  useEffect(() => {
    if (searchParams.get("scan") === "membership") {
      openScanner("details");
      router.replace("/", { scroll: false });
    }
  }, [openScanner, router, searchParams]);

  const fetchStats = useCallback(async () => {
    try {
      setStatsLoading(true);
      const data = await api<DashboardStats>("/dashboard", {
        params: { windowDays: statsWindowDays },
      });
      setStats(data);
    } catch {
      /* stats are non-critical — silently degrade */
    } finally {
      setStatsLoading(false);
    }
  }, [statsWindowDays]);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (user) fetchStats();
  }, [user, fetchStats]);

  const fetchBookmarks = useCallback(async () => {
    try {
      const data = await api<UserBookmark[]>("/bookmarks");
      setBookmarks(data);
    } catch {
      /* bookmarks are non-critical */
    }
  }, []);

  useEffect(() => {
    if (user) fetchBookmarks();
  }, [user, fetchBookmarks]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const toggleBookmark = useCallback(
    async (actionKey: string) => {
      const isBookmarked = bookmarks.some((b) => b.actionKey === actionKey);
      try {
        if (isBookmarked) {
          await api(`/bookmarks/${encodeURIComponent(actionKey)}`, { method: "DELETE" });
        } else {
          await api("/bookmarks", {
            method: "POST",
            body: JSON.stringify({ actionKey }),
          });
        }
        await fetchBookmarks();
      } catch {
        /* ignore */
      }
    },
    [bookmarks, fetchBookmarks]
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }
  if (!user) return null;

  const displayName = user.email.split("@")[0].replace(/[._-]+/g, " ");
  const greeting =
    now.getHours() < 12 ? "Good morning" : now.getHours() < 18 ? "Good afternoon" : "Good evening";
  const financial = stats?.financialOverview ?? null;
  const financialSeries = financial?.series ?? [];
  const recentActivity = stats?.recentActivity ?? [];
  const latestSeries = financialSeries.length ? financialSeries : Array.from({ length: 7 }, (_, idx) => ({
    label: `Day ${idx + 1}`,
    memberCollection: 0,
    income: 0,
    expense: 0,
    cashIn: 0,
    cashOut: 0,
    netIncome: 0,
    outstanding: 0,
  }));

  const ROW1_CARDS = [
    {
      label: "Member Collect",
      value: stats ? formatCompactRs(stats.netCollectedInPeriod) : "—",
      delta: stats ? `${Math.round((stats.netCollectedInPeriod / Math.max(stats.totalDueThisMonth || 1, 1)) * 100)}% collected` : "",
      icon: Users,
      color: "text-emerald-600",
      bg: "bg-emerald-500/10",
      stroke: "#16a34a",
      dataKey: "memberCollection",
    },
    {
      label: "Total Income",
      value: stats ? formatCompactRs(financial?.totalIncome ?? 0) : "—",
      delta: "From P&L",
      icon: Banknote,
      color: "text-blue-600",
      bg: "bg-blue-500/10",
      stroke: "#2563eb",
      dataKey: "income",
    },
    {
      label: "Total Expense",
      value: stats ? formatCompactRs(financial?.totalExpense ?? 0) : "—",
      delta: "From P&L",
      icon: Receipt,
      color: "text-red-500",
      bg: "bg-red-500/10",
      stroke: "#ef4444",
      dataKey: "expense",
    },
    {
      label: "Net Income",
      value: stats ? formatCompactRs(financial?.netIncome ?? 0) : "—",
      delta: "Income - Expense",
      icon: ArrowUpRight,
      color: "text-violet-600",
      bg: "bg-violet-500/10",
      stroke: "#8b5cf6",
      dataKey: "netIncome",
    },
  ];

  const ROW2_CARDS = [
    {
      label: t("dashboard.totalHouseholds"),
      value: stats ? formatCompactInteger(stats.totalHouseholds) : "—",
      icon: Home,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
    },
    {
      label: t("dashboard.totalHeadcount"),
      value: stats ? formatCompactInteger(stats.totalHeadcount) : "—",
      icon: Users,
      color: "text-indigo-500",
      bg: "bg-indigo-500/10",
    },
    {
      label: t("dashboard.adults"),
      value: stats ? formatCompactInteger(stats.adults) : "—",
      icon: User,
      color: "text-sky-500",
      bg: "bg-sky-500/10",
    },
    {
      label: t("dashboard.youth"),
      value: stats ? formatCompactInteger(stats.youth) : "—",
      icon: UserPlus,
      color: "text-purple-500",
      bg: "bg-purple-500/10",
    },
    {
      label: t("dashboard.children"),
      value: stats ? formatCompactInteger(stats.children) : "—",
      icon: Baby,
      color: "text-amber-500",
      bg: "bg-amber-500/10",
    },
  ];

  const quickActionItems = [
    { label: "Record Cash In", href: "/cash-in", icon: Banknote, tone: "text-emerald-600 bg-emerald-500/10" },
    { label: "Record Cash Out", href: "/cash-out", icon: Receipt, tone: "text-red-600 bg-red-500/10" },
    { label: "Add Member", href: "/members/new", icon: UserPlus, tone: "text-blue-600 bg-blue-500/10" },
    { label: "Create Fund", href: "/funds", icon: Landmark, tone: "text-violet-600 bg-violet-500/10" },
    { label: "View Reports", href: "/reports", icon: FileText, tone: "text-amber-600 bg-amber-500/10" },
    { label: "Scan QR Code", href: "/?scan=membership", icon: ScanLine, tone: "text-cyan-600 bg-cyan-500/10" },
  ] as const;

  const FLOW_TABS: FlowTab[] = [
    {
      value: "person",
      label: t("flows.personFlow"),
      actions: [
        {
          actionKey: "person-manage-people",
          title: t("persons.title"),
          description: t("persons.manageDesc"),
          icon: Users,
          href: "/persons",
        },
        {
          actionKey: "person-add-new-person",
          title: t("persons.addPerson"),
          description: t("persons.addDesc"),
          icon: UserPlus,
          href: "/persons?open=new",
        },
      ],
    },
    {
      value: "membership",
      label: t("flows.membershipFlow"),
      actions: [
        {
          actionKey: "membership-manage-membership",
          title: t("memberships.title"),
          description: t("memberships.manageDesc"),
          icon: Users,
          href: "/members",
        },
        {
          actionKey: "membership-add-new-member",
          title: t("memberships.addMembership"),
          description: t("memberships.addDesc"),
          icon: UserPlus,
          href: "/members/new",
        },
        {
          actionKey: "membership-scan",
          title: t("memberships.scan"),
          description: t("memberships.scan"),
          icon: ScanLine,
          action: () => openScanner("details"),
        },
      ],
    },
    {
      value: "payment",
      label: t("flows.paymentFlow"),
      actions: [
        {
          actionKey: "payment-make-a-payment",
          title: t("payments.makePayment"),
          description: t("payments.makePayment"),
          icon: CreditCard,
          href: "/payments",
        },
        {
          actionKey: "payment-periodic-contributions",
          title: t("payments.paymentHistory"),
          description: t("payments.paymentHistory"),
          icon: Repeat,
          href: "/payments",
        },
        {
          actionKey: "payment-scan",
          title: t("memberships.scan"),
          description: t("memberships.scan"),
          icon: ScanLine,
          action: () => openScanner("payments"),
        },
      ],
    },
    {
      value: "cash-in",
      label: "Cash In",
      actions: [
        {
          actionKey: "cash-in-workspace",
          title: "Cash In",
          description: "Record income, project fund collections, and receivable collections",
          icon: Banknote,
          href: "/cash-in",
          roles: ["admin", "super_user"],
        },
      ],
    },
    {
      value: "cash-out",
      label: "Cash Out",
      actions: [
        {
          actionKey: "cash-out-workspace",
          title: "Cash Out",
          description: "Record expenses, project fund expenses, and payable payments",
          icon: Receipt,
          href: "/cash-out",
          roles: ["admin", "super_user"],
        },
      ],
    },
    {
      value: "admin",
      label: t("flows.adminFlow"),
      actions: [
        {
          actionKey: "admin-user-management",
          title: t("users.title"),
          description: t("users.title"),
          icon: UserCog,
          href: "/users",
          roles: ["admin", "super_user"],
        },
        {
          actionKey: "admin-organizations",
          title: t("organizations.title"),
          description: t("organizations.title"),
          icon: Building2,
          href: "/organizations",
          roles: ["admin", "super_user"],
        },
        {
          actionKey: "admin-form-config",
          title: t("settings.formConfig"),
          description: t("settings.formConfig"),
          icon: Settings,
          href: "/settings/form-config",
          roles: ["admin", "super_user"],
        },
        {
          actionKey: "admin-zones",
          title: t("settings.zones"),
          description: t("settings.zones"),
          icon: Building2,
          href: "/settings/zones",
          roles: ["admin", "super_user"],
        },
        {
          actionKey: "admin-due-types",
          title: "Due Types",
          description: "Manage manual and auto-allocated due categories",
          icon: CreditCard,
          href: "/settings/due-types",
          roles: ["admin", "super_user"],
        },
      ],
    },
    {
      value: "announcements",
      label: t("flows.announcements"),
      actions: [
        {
          actionKey: "announcements-manage",
          title: t("announcements.title"),
          description: t("announcements.sendAnnouncement"),
          icon: MessageSquare,
          href: "/announcements",
          disabled: true,
          badge: "Coming Soon",
        },
      ],
    },
    {
      value: "distributions",
      label: t("flows.distributions"),
      actions: [
        {
          actionKey: "distributions-manage",
          title: t("distributions.title"),
          description: t("distributions.createDistribution"),
          icon: Package,
          href: "/distributions",
          disabled: true,
          badge: "Coming Soon",
        },
      ],
    },
    {
      value: "reports",
      label: t("flows.reports"),
      actions: [
        {
          actionKey: "reports-builder",
          title: t("reports.title"),
          description: t("reports.exportCSV"),
          icon: FileText,
          href: "/reports",
        },
        {
          actionKey: "reports-periodic-payments",
          title: "Periodic Payment Report",
          description: t("reports.periodicPaymentsDesc"),
          icon: Receipt,
          href: "/reports/payments",
        },
        {
          actionKey: "reports-charts",
          title: t("charts.title"),
          description: t("charts.title"),
          icon: BarChart3,
          href: "/charts",
        },
      ],
    },
    {
      value: "accounting",
      label: "Accounting",
      actions: [
        {
          actionKey: "accounting-preview",
          title: "Accounting",
          description: "Explore the accounting workspace foundation",
          icon: Landmark,
          href: "/accounting",
          badge: "Beta",
        },
      ],
    },
    {
      value: "funds",
      label: "Funds Management",
      actions: [
        {
          actionKey: "funds-management",
          title: "Funds Management",
          description: "Create and track restricted project funds",
          icon: Landmark,
          href: "/funds",
          badge: "Beta",
        },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-background relative">
      <AbstractBg />
      <Header />
      <main className="relative z-10 mx-auto max-w-7xl space-y-6 p-4 md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold text-foreground md:text-3xl">
              {greeting}, {displayName}
            </h1>
            <div className="text-sm text-muted-foreground">
              {user.organization?.name ?? "Organization"}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1">
                <Clock3 className="h-3.5 w-3.5" />
                {now.toLocaleString(undefined, {
                  weekday: "short",
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
              <span className="rounded-full border bg-card px-3 py-1">
                {stats ? formatPeriod(stats.period) : t("dashboard.overview")}
              </span>
            </div>
          </div>
          <div className="w-full max-w-[220px]">
            <Select value={statsWindowDays} onValueChange={setStatsWindowDays}>
              <SelectTrigger>
                <SelectValue placeholder="Select period" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Today</SelectItem>
                <SelectItem value="7">Last 7 Days</SelectItem>
                <SelectItem value="14">Last 14 Days</SelectItem>
                <SelectItem value="30">Last 1 Month</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {ROW1_CARDS.map(({ label, value, delta, icon: Icon, color, bg, stroke, dataKey }) => (
            <Card key={label} className="overflow-hidden">
              <CardContent className="space-y-3 p-5">
                <div className="flex items-start gap-4">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${bg}`}>
                    <Icon className={`h-5 w-5 ${color}`} />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-semibold text-foreground">{label}</p>
                    <p className="text-xl font-semibold text-foreground">{statsLoading ? "—" : value}</p>
                    {delta ? <p className={`text-xs font-medium ${label === "Total Expense" ? "text-red-500" : "text-emerald-600"}`}>{delta}</p> : null}
                  </div>
                </div>
                <div className="h-12">
                  {statsLoading ? (
                    <div className="h-full rounded-md bg-muted/70 animate-pulse" />
                  ) : (
                    <MiniSparkline data={latestSeries} dataKey={dataKey} stroke={stroke} />
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {ROW2_CARDS.map(({ label, value, icon: Icon, color, bg }) => (
            <Card key={label} className="overflow-hidden">
              <CardContent className="flex items-center gap-3 p-4">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${bg}`}>
                  <Icon className={`h-5 w-5 ${color}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="truncate text-xl font-semibold text-foreground">{statsLoading ? "—" : value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">No change</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div>
          <h3 className="mb-3 text-base font-semibold text-foreground">Quick Actions</h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {quickActionItems.map(({ label, href, icon: Icon, tone }) => (
              <Link key={label} href={href} className="group">
                <Card className="h-full transition hover:border-primary/30 hover:bg-accent/20">
                  <CardContent className="flex h-28 flex-col items-center justify-center gap-2 p-3 text-center">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-full ${tone.split(" ")[1]}`}>
                      <Icon className={`h-5 w-5 ${tone.split(" ")[0]}`} />
                    </div>
                    <div className="text-sm font-medium text-foreground">{label}</div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(280px,0.35fr)_minmax(0,0.65fr)]">
          <Card className="overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between gap-3 border-b pb-4">
              <div>
                <CardTitle className="text-base">Recent Activity</CardTitle>
              </div>
              <Link href="/reports" className="text-xs font-semibold text-emerald-700 hover:underline">View All</Link>
            </CardHeader>
            <CardContent className="p-0">
              {statsLoading ? (
                <div className="p-4 space-y-3">
                  {Array.from({ length: 5 }).map((_, idx) => (
                    <div key={idx} className="h-16 rounded-xl bg-muted/60 animate-pulse" />
                  ))}
                </div>
              ) : recentActivity.length > 0 ? (
                <div className="divide-y">
                  {recentActivity.slice(0, 5).map((item) => (
                    <Link key={item.id} href={item.href ?? "#"} className={`flex items-center gap-3 p-3 transition ${item.href ? "hover:bg-muted/40" : "cursor-default"}`}>
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${activityToneClass(item.tone)}`}>
                        <ActivityIcon kind={item.type} className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-foreground">{item.title}</div>
                        <div className="truncate text-sm text-muted-foreground">{item.description}</div>
                      </div>
                      <div className="text-right">
                        {typeof item.amount === "number" ? (
                          <div className="font-semibold text-foreground">{formatCompactRs(item.amount)}</div>
                        ) : null}
                        <div className="text-xs text-muted-foreground">{relativeTime(item.occurredAt)}</div>
                      </div>
                      {item.href ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : null}
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="p-4 text-sm text-muted-foreground">No recent activity yet.</div>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="border-b pb-4">
              <CardTitle className="text-base">Financial Overview</CardTitle>
              <p className="text-sm text-muted-foreground">Income, expense, cash flow, and collection performance</p>
            </CardHeader>
            <CardContent className="grid gap-3 p-4 md:grid-cols-3">
              <ChartCard title="Income vs Expenses" subtitle="Daily totals" colorA="#2563eb" colorB="#ef4444">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={latestSeries}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <Tooltip />
                    <Bar dataKey="income" fill="#2563eb" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expense" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Cash Flow" subtitle="Inflows vs outflows" colorA="#16a34a" colorB="#f97316">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={latestSeries}>
                    <defs>
                      <linearGradient id="cashInFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#16a34a" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="cashOutFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f97316" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <Tooltip />
                    <Area type="monotone" dataKey="cashIn" stroke="#16a34a" fill="url(#cashInFill)" strokeWidth={2} dot={false} />
                    <Area type="monotone" dataKey="cashOut" stroke="#f97316" fill="url(#cashOutFill)" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Collection Rate" subtitle="Current period" colorA="#10b981" colorB="#e5e7eb">
                <div className="flex h-full items-center justify-center">
                  <ResponsiveContainer width="100%" height={150}>
                    <PieChart>
                      <Pie
                        data={[
                          { name: "Collected", value: financial?.collectionRate ?? 0 },
                          { name: "Remaining", value: Math.max(100 - (financial?.collectionRate ?? 0), 0) },
                        ]}
                        dataKey="value"
                        innerRadius={42}
                        outerRadius={58}
                        paddingAngle={4}
                      >
                        <Cell fill="#10b981" />
                        <Cell fill="#e5e7eb" />
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-[-20px] text-center">
                  <div className="text-2xl font-semibold text-foreground">{statsLoading ? "—" : `${financial?.collectionRate?.toFixed(0) ?? 0}%`}</div>
                  <div className="text-xs text-muted-foreground">Collected this period</div>
                </div>
              </ChartCard>

              <ChartCard title="Outstanding Dues" subtitle="Balance movement" colorA="#ef4444" colorB="#fde2e2" className="md:col-span-3 [&>div:last-child]:h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={latestSeries}>
                    <defs>
                      <linearGradient id="outstandingFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.24} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <Tooltip />
                    <Area type="monotone" dataKey="outstanding" stroke="#ef4444" fill="url(#outstandingFill)" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>
            </CardContent>
          </Card>
        </div>

        {bookmarks.length > 0 && (
          <div>
            <h3 className="mb-3 text-sm font-medium text-muted-foreground">{t("dashboard.quickActions")}</h3>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {bookmarks
                .sort((a, b) => a.displayOrder - b.displayOrder)
                .map((bm) => {
                  let found: { tab: FlowTab; action: FlowAction } | null = null;
                  for (const tab of FLOW_TABS) {
                    const action = tab.actions.find(
                      (a) => a.actionKey === bm.actionKey && (!a.roles || a.roles.includes(user.role))
                    );
                    if (action) {
                      found = { tab, action };
                      break;
                    }
                  }
                  if (!found) return null;
                  const { action } = found;
                  const { title, description, icon: Icon, href, action: act, actionKey, disabled, badge } = action;
                  const card = (
                    <Card className={`group h-full relative transition-all ${disabled ? "cursor-not-allowed border-dashed opacity-70" : "cursor-pointer hover:border-primary/30 hover:bg-accent/30"}`}>
                      {badge ? (
                        <span className="absolute left-3 top-3 z-10 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                          {badge}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleBookmark(actionKey);
                        }}
                        className="absolute top-2 right-2 z-10 rounded-lg p-2 transition-colors hover:bg-accent/60"
                        aria-label="Remove bookmark"
                      >
                        <Star className="h-5 w-5 text-primary fill-primary" />
                      </button>
                      <CardHeader className={`flex flex-row items-center gap-3 space-y-0 pb-2 pr-12 ${badge ? "pt-8" : ""}`}>
                        <div className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors shrink-0 ${disabled ? "bg-muted text-muted-foreground" : "bg-primary/10 group-hover:bg-primary/20"}`}>
                          <Icon className="h-4 w-4 text-primary" />
                        </div>
                        <CardTitle className="text-sm font-medium text-foreground">
                          {title}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground">{description}</p>
                      </CardContent>
                    </Card>
                  );
                  if (href && !disabled) {
                    return (
                      <Link key={bm.actionKey} href={href} onClick={(e) => e.stopPropagation()}>
                        {card}
                      </Link>
                    );
                  }
                  return (
                    <button
                      key={bm.actionKey}
                      type="button"
                      className="text-left"
                      onClick={disabled ? undefined : act}
                      disabled={disabled}
                    >
                      {card}
                    </button>
                  );
                })}
            </div>
          </div>
        )}

      </main>

      {/* QR Scanner dialog */}
      <Dialog open={scannerOpen} onOpenChange={(open) => { if (!open) { stopScanner(); setScannerOpen(false); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Scan Membership QR Code</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3">
            <div id={scannerContainerId} className="w-full rounded-lg overflow-hidden" />
            {scanError && (
              <p className="text-sm text-destructive text-center">{scanError}</p>
            )}
            <p className="text-xs text-muted-foreground text-center">
              Point your camera at a membership QR code
            </p>
            <Button variant="outline" size="sm" onClick={() => { stopScanner(); setScannerOpen(false); }}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
