"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Receipt } from "lucide-react";
import { Header } from "@/components/header";
import { AbstractBg } from "@/components/abstract-bg";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import type { ActivityPage as ActivityPageData } from "@/lib/api";

function formatRs(value: number) {
  return new Intl.NumberFormat("en-LK", {
    style: "currency", currency: "LKR", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value).replace("LKR", "Rs.");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function ActivityPage() {
  const { user, loading } = useAuth();
  const [activity, setActivity] = useState<ActivityPageData | null>(null);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  const loadActivity = useCallback(async () => {
    try {
      setIsLoading(true);
      setActivity(await api<ActivityPageData>("/dashboard/activity", { params: { page: String(page), pageSize: "25" } }));
    } finally {
      setIsLoading(false);
    }
  }, [page]);

  useEffect(() => {
    if (user) void loadActivity();
  }, [user, loadActivity]);

  if (loading || !user) return null;
  const items = activity?.items ?? [];

  return (
    <div className="relative min-h-screen bg-background">
      <AbstractBg />
      <Header />
      <main className="relative z-10 mx-auto max-w-7xl space-y-5 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground md:text-3xl">Recent Activity</h1>
          <p className="mt-1 text-sm text-muted-foreground">A complete record of the latest financial and account activity.</p>
        </div>
        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-base">Activity History</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-left text-xs text-muted-foreground">
                  <tr><th className="px-5 py-3 font-medium">Date</th><th className="px-5 py-3 font-medium">Activity</th><th className="px-5 py-3 font-medium">Details</th><th className="px-5 py-3 text-right font-medium">Amount</th></tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((item) => <tr key={item.id} className="hover:bg-muted/20"><td className="whitespace-nowrap px-5 py-3 text-muted-foreground">{formatDate(item.occurredAt)}</td><td className="px-5 py-3 font-medium capitalize text-foreground">{item.title}</td><td className="px-5 py-3 text-muted-foreground">{item.description}</td><td className="whitespace-nowrap px-5 py-3 text-right font-medium">{typeof item.amount === "number" ? formatRs(item.amount) : "-"}</td></tr>)}
                </tbody>
              </table>
            </div>
            <div className="divide-y md:hidden">
              {items.map((item) => <div key={item.id} className="flex gap-3 p-4"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Receipt className="h-4 w-4" /></div><div className="min-w-0 flex-1"><div className="font-medium text-foreground">{item.title}</div><div className="truncate text-sm text-muted-foreground">{item.description}</div><div className="mt-1 text-xs text-muted-foreground">{formatDate(item.occurredAt)}</div></div>{typeof item.amount === "number" ? <div className="shrink-0 font-medium">{formatRs(item.amount)}</div> : null}</div>)}
            </div>
            {!isLoading && items.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">No activity has been recorded yet.</div> : null}
            {isLoading ? <div className="p-6 text-center text-sm text-muted-foreground">Loading activity...</div> : null}
            <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
              <span>{activity ? `${activity.total} activity items` : ""}</span>
              <div className="flex items-center gap-2"><Button variant="outline" size="icon" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={!activity || activity.page <= 1}><ChevronLeft className="h-4 w-4" /></Button><span>Page {activity?.page ?? 1} of {activity?.pageCount ?? 1}</span><Button variant="outline" size="icon" onClick={() => setPage((current) => current + 1)} disabled={!activity || activity.page >= activity.pageCount}><ChevronRight className="h-4 w-4" /></Button></div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
