"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ArrowRight, Landmark, ShieldCheck } from "lucide-react";
import { AbstractBg } from "@/components/abstract-bg";
import { Breadcrumb } from "@/components/breadcrumb";
import { Header } from "@/components/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";

export default function FinancialSetupPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
    if (!loading && user && user.role !== "super_user") router.replace("/");
  }, [loading, router, user]);

  if (loading || !user || user.role !== "super_user") return null;

  return (
    <div className="relative min-h-screen bg-background">
      <AbstractBg />
      <Header />
      <main className="relative z-10 mx-auto max-w-6xl p-4 md:p-6">
        <Breadcrumb items={[{ label: "Dashboard", href: "/" }, { label: "Settings" }, { label: "Financial Setup" }]} />
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">Financial Setup</h1>
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
              <ShieldCheck className="h-3.5 w-3.5" /> Super User Only
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Controlled tools for preparing an organisation before live financial processing.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Link href="/settings/financial-setup/opening-balances" className="group">
            <Card className="h-full transition-colors group-hover:border-primary/50">
              <CardHeader>
                <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                  <Landmark className="h-5 w-5" />
                </div>
                <CardTitle className="flex items-center justify-between text-lg">
                  Opening Balance Migration
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Bring verified historical asset, liability and fund balances into Civica using a balanced, audited journal.
              </CardContent>
            </Card>
          </Link>
        </div>
      </main>
    </div>
  );
}
