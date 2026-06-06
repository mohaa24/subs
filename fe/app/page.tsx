"use client";

import { useAuth } from "@/lib/auth-context";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, useCallback, useRef } from "react";
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
  ScanLine,
  Repeat,
  Star,
  MessageSquare,
  Package,
  FileText,
  Settings,
  BarChart3,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, DashboardStats, UserBookmark } from "@/lib/api";
import { useTranslation } from "@/lib/i18n";
import { normalizeDashboardFlow } from "@/lib/dashboard-flows";

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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeFlow = normalizeDashboardFlow(searchParams.get("flow"));
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsWindowDays, setStatsWindowDays] = useState("30");
  const [bookmarks, setBookmarks] = useState<UserBookmark[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState("");
  const [scanTargetTab, setScanTargetTab] = useState<"details" | "payments">("details");
  const scannerRef = useRef<any>(null);
  const scannerContainerId = "qr-reader";

  const setActiveFlow = useCallback(
    (flow: string) => {
      const nextFlow = normalizeDashboardFlow(flow);
      const params = new URLSearchParams(searchParams.toString());
      params.set("flow", nextFlow);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

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

  const ROW1_CARDS = [
    {
      label: "Dues Generated",
      value: stats ? formatCompactRs(stats.totalDueThisMonth) : "—",
      icon: Receipt,
      color: "text-rose-500",
      bg: "bg-rose-500/10",
    },
    {
      label: "No of Payments",
      value: stats ? formatCompactInteger(stats.activePaymentsInPeriod) : "—",
      icon: CreditCard,
      color: "text-sky-500",
      bg: "bg-sky-500/10",
    },
    {
      label: "Net Collected",
      value: stats ? formatCompactRs(stats.netCollectedInPeriod) : "—",
      icon: Banknote,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
    },
    {
      label: "Outstanding(Current)",
      value: stats ? formatCompactRs(stats.currentOutstanding) : "—",
      icon: Receipt,
      color: "text-amber-500",
      bg: "bg-amber-500/10",
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
  ];

  return (
    <div className="min-h-screen bg-background relative">
      <AbstractBg />
      <Header />
      <main className="relative z-10 p-6 max-w-5xl mx-auto">
        <div className="mb-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-foreground">{t("dashboard.title")}</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {stats ? formatPeriod(stats.period) : t("dashboard.overview")}
              </p>
            </div>
            <div className="w-full sm:w-[180px]">
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
        </div>

        {/* ── Stat cards — Row 1 ────────────────────────────── */}
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {ROW1_CARDS.map(({ label, value, icon: Icon, color, bg }) => (
            <Card key={label} className="relative overflow-hidden">
              <CardHeader className="flex flex-row items-start justify-between space-y-0 px-3 pb-1 pt-3 sm:px-4 sm:pt-4">
                <p className="pr-2 text-[11px] font-medium leading-tight text-muted-foreground sm:text-xs">
                  {label}
                </p>
                <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${bg} sm:h-7 sm:w-7`}>
                  <Icon className={`h-3.5 w-3.5 ${color}`} />
                </div>
              </CardHeader>
              <CardContent className="px-3 pb-3 pt-0 sm:px-4 sm:pb-4">
                {statsLoading ? (
                  <div className="h-7 w-20 rounded bg-muted animate-pulse" />
                ) : (
                  <p className="truncate text-lg font-bold leading-none tracking-tight text-foreground sm:text-xl">
                    {value}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ── Stat cards — Row 2 ────────────────────────────── */}
        <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {ROW2_CARDS.map(({ label, value, icon: Icon, color, bg }) => (
            <Card key={label} className="relative overflow-hidden">
              <CardHeader className="flex flex-row items-start justify-between space-y-0 px-3 pb-1 pt-3 sm:px-4 sm:pt-4">
                <p className="pr-2 text-[11px] font-medium leading-tight text-muted-foreground sm:text-xs">
                  {label}
                </p>
                <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${bg} sm:h-7 sm:w-7`}>
                  <Icon className={`h-3.5 w-3.5 ${color}`} />
                </div>
              </CardHeader>
              <CardContent className="px-3 pb-3 pt-0 sm:px-4 sm:pb-4">
                {statsLoading ? (
                  <div className="h-7 w-20 rounded bg-muted animate-pulse" />
                ) : (
                  <p className="truncate text-lg font-bold leading-none tracking-tight text-foreground sm:text-xl">
                    {value}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ── Quick Actions (bookmarks) ─────────────────────── */}
        {bookmarks.length > 0 && (
          <>
            <div className="mb-4">
              <h3 className="text-sm font-medium text-muted-foreground">{t("dashboard.quickActions")}</h3>
            </div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 mb-8">
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
          </>
        )}

        {/* ── Flow tabs ─────────────────────────────────────── */}
        <div className="mb-4">
          <h3 className="text-sm font-medium text-muted-foreground">{t("dashboard.flows")}</h3>
        </div>
        <Tabs value={activeFlow} onValueChange={setActiveFlow} className="w-full">
          <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
            {FLOW_TABS.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="rounded-md border border-border px-3 py-1.5 data-[state=active]:border-primary/40 data-[state=active]:bg-primary/10"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {FLOW_TABS.map((tab) => {
            const actions = tab.actions.filter(
              (item) => !item.roles || item.roles.includes(user.role),
            );

            return (
              <TabsContent key={tab.value} value={tab.value}>
                {actions.length === 0 ? (
                  <Card>
                    <CardContent className="pt-6">
                      <p className="text-sm text-muted-foreground">
                        No actions available for your role in this flow.
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {actions.map(({ actionKey, title, description, icon: Icon, href, action, disabled, badge }) => {
                      const isBookmarked = bookmarks.some((b) => b.actionKey === actionKey);
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
                            aria-label={isBookmarked ? "Remove bookmark" : "Add bookmark"}
                          >
                            {isBookmarked ? (
                              <Star className="h-5 w-5 text-primary fill-primary" />
                            ) : (
                              <Star className="h-5 w-5 text-muted-foreground/40" />
                            )}
                          </button>
                          <CardHeader className={`flex flex-row items-center gap-3 space-y-0 pb-2 pr-12 ${badge ? "pt-8" : ""}`}>
                            <div className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors shrink-0 ${disabled ? "bg-muted" : "bg-primary/10 group-hover:bg-primary/20"}`}>
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
                          <Link key={`${tab.value}-${title}`} href={href}>
                            {card}
                          </Link>
                        );
                      }

                      return (
                        <button
                          key={`${tab.value}-${title}`}
                          type="button"
                          className="text-left"
                          onClick={disabled ? undefined : action}
                          disabled={disabled}
                        >
                          {card}
                        </button>
                      );
                    })}
                  </div>
                )}
              </TabsContent>
            );
          })}
        </Tabs>
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
