"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Users,
  Building2,
  UserPlus,
  UserCog,
  CreditCard,
  Baby,
  GraduationCap,
  Receipt,
  Banknote,
  ScanLine,
  Search,
  Repeat,
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
import { api, DashboardStats } from "@/lib/api";

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

function formatPeriod(period: string) {
  const [y, m] = period.split("-");
  const date = new Date(Number(y), Number(m) - 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

type FlowAction = {
  title: string;
  description: string;
  icon: LucideIcon;
  href?: string;
  action?: () => void;
  roles?: string[];
};

type FlowTab = {
  value: string;
  label: string;
  actions: FlowAction[];
};

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState("");
  const scannerRef = useRef<any>(null);
  const scannerContainerId = "qr-reader";

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch {}
      try { scannerRef.current.clear(); } catch {}
      scannerRef.current = null;
    }
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
              stopScanner();
              setScannerOpen(false);
              router.push(`/members/${match[1]}`);
            }
          } catch {
            // not a valid URL, try as path
            if (decodedText.includes("/members/")) {
              const match = decodedText.match(/\/members\/(.+)/);
              if (match) {
                stopScanner();
                setScannerOpen(false);
                router.push(`/members/${match[1]}`);
              }
            }
          }
        },
        () => {},
      );
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Could not start camera");
    }
  }, [router, stopScanner]);

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
      const data = await api<DashboardStats>("/dashboard");
      setStats(data);
    } catch {
      /* stats are non-critical — silently degrade */
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (user) fetchStats();
  }, [user, fetchStats]);

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

  const STAT_CARDS = [
    {
      label: "Total Members",
      value: stats?.totalMembers ?? "—",
      icon: Users,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
    },
    {
      label: "Children (< 8)",
      value: stats?.children ?? "—",
      icon: Baby,
      color: "text-amber-500",
      bg: "bg-amber-500/10",
    },
    {
      label: "Teenagers (8–18)",
      value: stats?.teenagers ?? "—",
      icon: GraduationCap,
      color: "text-purple-500",
      bg: "bg-purple-500/10",
    },
    {
      label: "Due This Month",
      value: stats ? formatRs(stats.totalDueThisMonth) : "—",
      icon: Receipt,
      color: "text-rose-500",
      bg: "bg-rose-500/10",
    },
    {
      label: "Collected This Month",
      value: stats ? formatRs(stats.collectedThisMonth) : "—",
      icon: Banknote,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
    },
  ];

  const FLOW_TABS: FlowTab[] = [
    {
      value: "person",
      label: "Person Flow",
      actions: [
        {
          title: "People",
          description: "Search, view, edit and add people",
          icon: Users,
          href: "/persons",
        },
        {
          title: "Person Search (Memberships)",
          description: "Find memberships by person",
          icon: Search,
          href: "/members",
        },
        {
          title: "Add New Membership",
          description: "Create a new membership with persons",
          icon: UserPlus,
          href: "/members/new",
        },
      ],
    },
    {
      value: "membership",
      label: "Membership Flow",
      actions: [
        {
          title: "Membership Search",
          description: "Search and review memberships",
          icon: Users,
          href: "/members",
        },
        {
          title: "Add New Member",
          description: "Create a new membership record",
          icon: UserPlus,
          href: "/members/new",
        },
        {
          title: "Scan",
          description: "Scan a membership QR code to open details",
          icon: ScanLine,
          action: () => setScannerOpen(true),
        },
      ],
    },
    {
      value: "payment",
      label: "Payment Flow",
      actions: [
        {
          title: "Make a Payment",
          description: "Record and review member payments",
          icon: CreditCard,
          href: "/payments",
        },
        {
          title: "Periodic Contributions",
          description: "Track recurring contributions and status",
          icon: Repeat,
          href: "/payments",
        },
        {
          title: "Scan",
          description: "Scan membership QR code before collecting payment",
          icon: ScanLine,
          action: () => setScannerOpen(true),
        },
      ],
    },
    {
      value: "admin",
      label: "Admin Flow",
      actions: [
        {
          title: "User Management",
          description: "Manage users for your organization",
          icon: UserCog,
          href: "/users",
          roles: ["admin", "super_user"],
        },
        {
          title: "Organizations",
          description: "Create and manage organizations",
          icon: Building2,
          href: "/organizations",
          roles: ["super_user"],
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
          <h2 className="text-xl font-semibold text-foreground">Dashboard</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {stats ? formatPeriod(stats.period) : "Overview"}
          </p>
        </div>

        {/* ── Stat cards ────────────────────────────────────── */}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-5 mb-8">
          {STAT_CARDS.map(({ label, value, icon: Icon, color, bg }) => (
            <Card key={label} className="relative overflow-hidden">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-4 px-4">
                <p className="text-xs font-medium text-muted-foreground">{label}</p>
                <div className={`h-7 w-7 rounded-lg ${bg} flex items-center justify-center`}>
                  <Icon className={`h-3.5 w-3.5 ${color}`} />
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                {statsLoading ? (
                  <div className="h-7 w-20 rounded bg-muted animate-pulse" />
                ) : (
                  <p className="text-xl font-bold text-foreground tracking-tight">
                    {value}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ── Flow tabs ─────────────────────────────────────── */}
        <div className="mb-4">
          <h3 className="text-sm font-medium text-muted-foreground">Flows</h3>
        </div>
        <Tabs defaultValue="person" className="w-full">
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
                    {actions.map(({ title, description, icon: Icon, href, action }) => {
                      const card = (
                        <Card className="hover:border-primary/30 hover:bg-accent/30 transition-all group cursor-pointer h-full">
                          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-foreground">
                              {title}
                            </CardTitle>
                            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                              <Icon className="h-4 w-4 text-primary" />
                            </div>
                          </CardHeader>
                          <CardContent>
                            <p className="text-sm text-muted-foreground">{description}</p>
                          </CardContent>
                        </Card>
                      );

                      if (href) {
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
                          onClick={action}
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
            <DialogTitle>Scan membership QR code</DialogTitle>
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
