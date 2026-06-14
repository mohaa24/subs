"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/header";
import { AbstractBg } from "@/components/abstract-bg";
import { Breadcrumb } from "@/components/breadcrumb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";
import { dashboardFlowHref } from "@/lib/dashboard-flows";
import { useAccountingPreviewUnlock } from "@/lib/accounting-preview";
import { Landmark, Lock, ReceiptText, WalletCards } from "lucide-react";

export default function AccountingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const previewUnlocked = useAccountingPreviewUnlock();
  const canPreview =
    previewUnlocked && (user?.role === "admin" || user?.role === "super_user");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, router, user]);

  if (loading || !user) {
    return <div className="p-8 text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-background relative">
      <AbstractBg />
      <Header />
      <main className="relative mx-auto max-w-5xl p-6">
        <Breadcrumb
          items={[
            { label: "Dashboard", href: dashboardFlowHref("accounting") },
            { label: "Accounting" },
          ]}
        />

        <div className="mb-6 flex items-center gap-2">
          <Landmark className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold text-foreground">Accounting</h1>
        </div>

        {!canPreview ? (
          <Card className="border-dashed">
            <CardContent className="flex min-h-[260px] flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
                <Lock className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium text-foreground">Coming soon</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Accounting is not available yet.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center gap-3 space-y-0">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <WalletCards className="h-4 w-4 text-primary" />
                </div>
                <CardTitle className="text-base">Accounts</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">Beta preview</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center gap-3 space-y-0">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <ReceiptText className="h-4 w-4 text-primary" />
                </div>
                <CardTitle className="text-base">Entries</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">Beta preview</p>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
