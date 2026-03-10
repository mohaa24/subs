"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { Header } from "@/components/header";
import { AbstractBg } from "@/components/abstract-bg";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, TrendingUp, Users, ArrowLeft } from "lucide-react";
import type { Distribution, DashboardStats, PaymentDue, DistributionReport } from "@/lib/api";

interface DuesResponse {
  items: PaymentDue[];
  total: number;
  page: number;
  limit: number;
}

function formatPeriod(period: string) {
  const [y, m] = period.split("-");
  const date = new Date(Number(y), Number(m) - 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function formatRs(n: number) {
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
    .format(n)
    .replace("LKR", "Rs.");
}

export default function ChartsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [reports, setReports] = useState<Record<string, DistributionReport>>({});
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [duesData, setDuesData] = useState<DuesResponse | null>(null);
  const [loadingDist, setLoadingDist] = useState(true);
  const [loadingDues, setLoadingDues] = useState(true);
  const [loadingDashboard, setLoadingDashboard] = useState(true);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  const fetchData = useCallback(async () => {
    if (!user) return;

    try {
      setLoadingDist(true);
      const distList = await api<Distribution[]>("/distributions");
      setDistributions(distList);

      const reportPromises = distList.map((d) =>
        api<DistributionReport>(`/distributions/${d.id}/report`)
      );
      const reportsList = await Promise.all(reportPromises);
      const reportMap: Record<string, DistributionReport> = {};
      distList.forEach((d, i) => {
        reportMap[d.id] = reportsList[i];
      });
      setReports(reportMap);
    } catch {
      setDistributions([]);
    } finally {
      setLoadingDist(false);
    }
  }, [user]);

  const fetchDashboard = useCallback(async () => {
    if (!user) return;
    try {
      setLoadingDashboard(true);
      const stats = await api<DashboardStats>("/dashboard");
      setDashboardStats(stats);
    } catch {
      setDashboardStats(null);
    } finally {
      setLoadingDashboard(false);
    }
  }, [user]);

  const fetchDues = useCallback(async () => {
    if (!user) return;
    try {
      setLoadingDues(true);
      const data = await api<DuesResponse>("/payments/dues", {
        params: { page: "1", limit: "100" },
      });
      setDuesData(data);
    } catch {
      setDuesData(null);
    } finally {
      setLoadingDues(false);
    }
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    fetchDues();
  }, [fetchDues]);

  const periodsByMonth =
    duesData?.items.reduce(
      (acc, d) => {
        const period = d.period;
        if (!acc[period]) {
          acc[period] = { due: 0, paid: 0 };
        }
        acc[period].due += Number(d.amountDue);
        acc[period].paid += Number(d.amountPaid);
        return acc;
      },
      {} as Record<string, { due: number; paid: number }>
    ) ?? {};

  const sortedPeriods = Object.keys(periodsByMonth).sort().slice(-12);
  const maxPaid = Math.max(
    ...sortedPeriods.map((p) => periodsByMonth[p].paid),
    1
  );

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background relative">
      <AbstractBg />
      <Header />
      <main className="relative z-10 p-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </Link>
        </div>

        <div className="mb-6">
          <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Charts & Analytics
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Data visualizations and trends
          </p>
        </div>

        {/* Membership Stats */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Membership Stats
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingDashboard ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
                ))}
              </div>
            ) : dashboardStats ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="rounded-lg bg-muted/50 p-4">
                  <p className="text-xs text-muted-foreground uppercase">Total Households</p>
                  <p className="text-xl font-bold">{dashboardStats.totalHouseholds}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-4">
                  <p className="text-xs text-muted-foreground uppercase">Total Headcount</p>
                  <p className="text-xl font-bold">{dashboardStats.totalHeadcount}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-4">
                  <p className="text-xs text-muted-foreground uppercase">Adults (18+)</p>
                  <p className="text-xl font-bold">{dashboardStats.adults}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-4">
                  <p className="text-xs text-muted-foreground uppercase">Collected This Month</p>
                  <p className="text-xl font-bold">{formatRs(dashboardStats.collectedThisMonth)}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Unable to load dashboard stats</p>
            )}
          </CardContent>
        </Card>

        {/* Distribution Progress */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              Distribution Progress
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingDist ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />
                ))}
              </div>
            ) : distributions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No distributions</p>
            ) : (
              <div className="space-y-4">
                {distributions.map((d) => {
                  const r = reports[d.id];
                  const eligible = r?.totalEligible ?? 0;
                  const distributed = r?.totalDistributed ?? 0;
                  const pct = eligible > 0 ? Math.round((distributed / eligible) * 100) : 0;
                  return (
                    <div key={d.id} className="space-y-1.5">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">{d.name}</span>
                        <span className="text-muted-foreground">
                          {distributed} / {eligible} ({pct}%)
                        </span>
                      </div>
                      <div className="h-3 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-500"
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Payment Collection Trends */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Payment Collection Trends
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingDues ? (
              <div className="h-48 rounded-lg bg-muted animate-pulse" />
            ) : sortedPeriods.length === 0 ? (
              <p className="text-sm text-muted-foreground">No dues data</p>
            ) : (
              <div className="space-y-3">
                {sortedPeriods.map((period) => {
                  const { due, paid } = periodsByMonth[period];
                  const paidPct = maxPaid > 0 ? (paid / maxPaid) * 100 : 0;
                  return (
                    <div key={period} className="flex items-center gap-3">
                      <span className="w-20 text-sm text-muted-foreground shrink-0">
                        {formatPeriod(period)}
                      </span>
                      <div className="flex-1 h-8 rounded-md bg-muted overflow-hidden flex">
                        <div
                          className="h-full rounded-l-md bg-primary/80 transition-all duration-500 min-w-0"
                          style={{ width: `${paidPct}%` }}
                        />
                      </div>
                      <span className="w-24 text-right text-sm shrink-0">
                        {formatRs(paid)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
