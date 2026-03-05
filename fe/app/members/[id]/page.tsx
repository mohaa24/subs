"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import {
  api,
  type Membership,
  type MembershipBalance,
  type MembershipCreditEntry,
  type Payment,
  type PaymentDue,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Header } from "@/components/header";
import { Breadcrumb } from "@/components/breadcrumb";
import {
  ChevronLeft,
  ChevronRight,
  QrCode,
  Download,
  Edit,
  DollarSign,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  CreditCard,
  Shield,
  Users,
  User,
  Gem,
  Baby,
  UserPlus,
  Home,
  Landmark,
  Car,
  Droplets,
  Zap,
  Building2,
  Bath,
  MapPin,
  Clock,
  Receipt,
  ArrowUpRight,
  TrendingUp,
  Printer,
} from "lucide-react";
import QRCode from "qrcode";
import { toast } from "@/hooks/use-toast";

const statusColors: Record<string, string> = {
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  partial: "bg-amber-50 text-amber-700 border-amber-200",
  pending: "bg-slate-50 text-slate-600 border-slate-200",
  overdue: "bg-red-50 text-red-700 border-red-200",
};

const statusIcons: Record<string, typeof CheckCircle2> = {
  paid: CheckCircle2,
  partial: Clock,
  pending: Clock,
  overdue: AlertTriangle,
};

function PersonAvatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  const sizeClasses = {
    sm: "h-8 w-8 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-14 w-14 text-lg",
  };
  return (
    <div
      className={`${sizeClasses[size]} rounded-full bg-primary/10 text-primary font-semibold flex items-center justify-center flex-shrink-0`}
    >
      {initials}
    </div>
  );
}

function AssetBadge({
  icon: Icon,
  label,
  active,
}: {
  icon: typeof Home;
  label: string;
  active: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-primary/5 text-foreground border border-primary/20"
          : "bg-muted/50 text-muted-foreground border border-transparent"
      }`}
    >
      <Icon className={`h-4 w-4 flex-shrink-0 ${active ? "text-primary" : ""}`} />
      <span className="font-medium">{label}</span>
      {active ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-primary ml-auto" />
      ) : (
        <span className="text-xs ml-auto opacity-50">No</span>
      )}
    </div>
  );
}

export default function MembershipDetailPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const [membership, setMembership] = useState<Membership | null>(null);
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState<MembershipBalance | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentsTotal, setPaymentsTotal] = useState(0);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const paymentsLimit = 20;
  const [creditEntries, setCreditEntries] = useState<MembershipCreditEntry[]>([]);
  const [creditTotal, setCreditTotal] = useState(0);
  const [creditBalance, setCreditBalance] = useState(0);
  const [creditPage, setCreditPage] = useState(1);
  const creditLimit = 20;

  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");

  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payDue, setPayDue] = useState<PaymentDue | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");
  const [paySubmitting, setPaySubmitting] = useState(false);
  const [payError, setPayError] = useState("");
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user || !id) return;
    api<Membership>(`/memberships/${id}`)
      .then(setMembership)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user, id]);

  const loadBalance = useCallback(() => {
    if (!user || !id) return;
    api<MembershipBalance>(`/payments/balance/${id}`)
      .then(setBalance)
      .catch(() => {});
  }, [user, id]);

  const loadPayments = useCallback(() => {
    if (!user || !id) return;
    api<{ items: Payment[]; total: number }>(`/payments/history/${id}`, {
      params: { page: String(paymentsPage), limit: String(paymentsLimit) },
    })
      .then((r) => {
        setPayments(r.items);
        setPaymentsTotal(r.total);
      })
      .catch(() => {});
  }, [user, id, paymentsPage]);

  const loadCreditLedger = useCallback(() => {
    if (!user || !id) return;
    api<{ entries: MembershipCreditEntry[]; total: number; balance: number }>(`/payments/credit/${id}`, {
      params: { page: String(creditPage), limit: String(creditLimit) },
    })
      .then((r) => {
        setCreditEntries(r.entries);
        setCreditTotal(r.total);
        setCreditBalance(Number(r.balance));
      })
      .catch(() => {
        setCreditEntries([]);
        setCreditTotal(0);
        setCreditBalance(0);
      });
  }, [user, id, creditPage]);

  useEffect(() => {
    loadBalance();
  }, [loadBalance]);

  useEffect(() => {
    loadPayments();
  }, [loadPayments]);

  useEffect(() => {
    loadCreditLedger();
  }, [loadCreditLedger]);

  async function generateQr() {
    const url = `${window.location.origin}/members/${id}`;
    const dataUrl = await QRCode.toDataURL(url, {
      width: 400,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    });
    setQrDataUrl(dataUrl);
    setQrOpen(true);
  }

  function downloadQr() {
    if (!qrDataUrl || !membership) return;
    const link = document.createElement("a");
    link.download = `${membership.membershipNo}-qr.png`;
    link.href = qrDataUrl;
    link.click();
  }

  function handlePrint() {
    window.print();
  }

  function openPayDialog(due: PaymentDue) {
    const remaining = Number(due.amountDue) - Number(due.amountPaid);
    setPayDue(due);
    setPayAmount(String(remaining > 0 ? remaining.toFixed(2) : "0"));
    setPayNote("");
    setPayError("");
    setPayDialogOpen(true);
  }

  async function handleRecordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payDue) return;
    setPayError("");
    const amt = parseFloat(payAmount);
    if (isNaN(amt) || amt <= 0) {
      const msg = "Enter a valid amount.";
      setPayError(msg);
      toast({
        variant: "destructive",
        title: "Invalid payment amount",
        description: msg,
      });
      return;
    }
    setPaySubmitting(true);
    try {
      await api("/payments", {
        method: "POST",
        body: JSON.stringify({
          paymentDueId: payDue.id,
          amount: amt,
          note: payNote || undefined,
        }),
      });
      setPayDialogOpen(false);
      toast({
        title: "Payment recorded",
        description: "Payment has been saved successfully.",
      });
      loadBalance();
      loadPayments();
      loadCreditLedger();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to record payment";
      setPayError(msg);
      toast({
        variant: "destructive",
        title: "Failed to record payment",
        description: msg,
      });
    } finally {
      setPaySubmitting(false);
    }
  }

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="p-6 max-w-5xl mx-auto">
          <div className="animate-pulse space-y-6">
            <div className="h-4 w-48 bg-muted rounded" />
            <div className="h-24 bg-muted rounded-xl" />
            <div className="grid grid-cols-3 gap-4">
              <div className="h-24 bg-muted rounded-xl" />
              <div className="h-24 bg-muted rounded-xl" />
              <div className="h-24 bg-muted rounded-xl" />
            </div>
            <div className="h-64 bg-muted rounded-xl" />
          </div>
        </main>
      </div>
    );
  }
  if (!membership) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="p-6 max-w-5xl mx-auto flex flex-col items-center justify-center py-20">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Users className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold mb-1">Membership not found</h2>
          <p className="text-sm text-muted-foreground mb-4">
            The membership you are looking for does not exist or has been removed.
          </p>
          <Link href="/members">
            <Button variant="outline">Back to Members</Button>
          </Link>
        </main>
      </div>
    );
  }

  const yesNo = (v: boolean) => (v ? "Yes" : "No");
  const totalPaymentPages = Math.ceil(paymentsTotal / paymentsLimit) || 1;
  const totalCreditPages = Math.ceil(creditTotal / creditLimit) || 1;
  const paymentProgress = balance
    ? balance.totalDue > 0
      ? Math.min(100, (balance.totalPaid / balance.totalDue) * 100)
      : 0
    : 0;

  function creditEntryLabel(type: MembershipCreditEntry["entryType"]) {
    if (type === "credit_overpayment") return "Overpayment";
    if (type === "debit_auto_apply") return "Auto-applied";
    if (type === "credit_adjustment") return "Adjustment (credit)";
    if (type === "debit_adjustment") return "Adjustment (debit)";
    return type;
  }

  function getAge(dob: string | null | undefined): number | null {
    if (!dob) return null;
    const birth = new Date(dob);
    if (isNaN(birth.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
  }

  const allMembers = [
    ...(membership.hod ? [membership.hod] : []),
    ...(membership.spouse ? [membership.spouse] : []),
    ...(membership.dependents?.map((d) => d.person) ?? []),
  ];
  const totalHousehold = allMembers.length;
  const adults = allMembers.filter((p) => {
    const age = getAge(p.dateOfBirth);
    return age === null || age >= 18;
  }).length;
  const children = allMembers.filter((p) => {
    const age = getAge(p.dateOfBirth);
    return age !== null && age < 18;
  }).length;

  const childDependents = membership.dependents?.filter((d) => (d.group ?? "other") === "children") ?? [];
  const otherDependents = membership.dependents?.filter((d) => (d.group ?? "other") === "other") ?? [];

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="p-6 max-w-5xl mx-auto print:p-0 print:max-w-none" ref={printRef}>
        {/* Print-only document title */}
        <div className="hidden print:block mb-4 pb-3 border-b-2 border-foreground/20">
          <h2 className="text-lg font-bold">Membership Details</h2>
          <p className="text-xs text-muted-foreground">
            Membership #{membership.membershipNo} · Printed on{" "}
            {new Date().toLocaleDateString()}
          </p>
        </div>

        <div className="print:hidden">
          <Breadcrumb
            items={[
              { label: "Dashboard", href: "/" },
              { label: "Members", href: "/members" },
              { label: membership.membershipNo },
            ]}
          />
        </div>

        {/* ── Hero Section ────────────────────────────── */}
        <div className="mt-2 mb-8 rounded-xl border bg-card overflow-hidden print:mt-0 print:mb-4">
          <div className="h-2 bg-gradient-to-r from-primary via-primary/70 to-primary/40" />
          <div className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <PersonAvatar name={membership.hod?.fullName || "?"} size="lg" />
                <div>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h1 className="text-xl font-bold text-foreground">
                      {membership.hod?.fullName}
                    </h1>
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full border ${
                        membership.membershipStatus === "Active"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-slate-100 text-slate-600 border-slate-200"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          membership.membershipStatus === "Active"
                            ? "bg-emerald-500"
                            : "bg-slate-400"
                        }`}
                      />
                      {membership.membershipStatus}
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <div className="text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1 font-mono text-xs bg-muted px-2 py-0.5 rounded">
                        <Shield className="h-3 w-3" />
                        {membership.membershipNo}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-sm text-muted-foreground flex-wrap">
                      <span className="inline-flex items-center gap-1">
                        <CreditCard className="h-3.5 w-3.5" />
                        {membership.membershipType}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {new Date(membership.dateOfRegistration).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0 print:hidden">
                <Button variant="outline" size="sm" onClick={generateQr} className="gap-1.5">
                  <QrCode className="h-4 w-4" />
                  <span className="hidden sm:inline">QR Code</span>
                </Button>
                <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1.5">
                  <Printer className="h-4 w-4" />
                  <span className="hidden sm:inline">Print</span>
                </Button>
                <Link href={`/members/${id}/edit`}>
                  <Button size="sm" className="gap-1.5">
                    <Edit className="h-4 w-4" />
                    <span className="hidden sm:inline">Edit</span>
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>

        <Tabs defaultValue="details">
          <TabsList className="mb-4 print:hidden">
            <TabsTrigger value="details" className="gap-1.5">
              <Receipt className="h-4 w-4" />
              Details
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5">
              <Clock className="h-4 w-4" />
              Payment History
            </TabsTrigger>
            <TabsTrigger value="credit-ledger" className="gap-1.5">
              <Landmark className="h-4 w-4" />
              Credit Ledger
            </TabsTrigger>
          </TabsList>

          {/* ── Tab 1: Details ──────────────────────────────── */}
          <TabsContent value="details" forceMount className="data-[state=inactive]:hidden print:!block">
            <div className="space-y-6">

              {/* ── Household Stat Widgets ────────────────────── */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="pt-4 pb-4 px-4">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-blue-100 flex items-center justify-center">
                        <Users className="h-4.5 w-4.5 text-blue-600" />
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Total Household</p>
                        <p className="text-2xl font-bold tabular-nums">{totalHousehold}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-4 px-4">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-purple-100 flex items-center justify-center">
                        <User className="h-4.5 w-4.5 text-purple-600" />
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Adults (18+)</p>
                        <p className="text-2xl font-bold tabular-nums">{adults}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-4 px-4">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-amber-100 flex items-center justify-center">
                        <Baby className="h-4.5 w-4.5 text-amber-600" />
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Children (&lt;18)</p>
                        <p className="text-2xl font-bold tabular-nums">{children}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Payment summary cards */}
              {balance && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <Card className="border-blue-100 bg-gradient-to-br from-blue-50/50 to-card">
                      <CardContent className="pt-5 pb-5 px-5">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                            <DollarSign className="h-5 w-5 text-blue-600" />
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground">
                              Total Due
                            </p>
                            <p className="text-2xl font-bold tabular-nums">
                              {balance.totalDue.toFixed(2)}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="border-emerald-100 bg-gradient-to-br from-emerald-50/50 to-card">
                      <CardContent className="pt-5 pb-5 px-5">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground">
                              Total Paid
                            </p>
                            <p className="text-2xl font-bold tabular-nums text-emerald-600">
                              {balance.totalPaid.toFixed(2)}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card
                      className={`${
                        balance.netOutstanding > 0
                          ? "border-red-100 bg-gradient-to-br from-red-50/50 to-card"
                          : "border-emerald-100 bg-gradient-to-br from-emerald-50/50 to-card"
                      }`}
                    >
                      <CardContent className="pt-5 pb-5 px-5">
                        <div className="flex items-center gap-3">
                          <div
                            className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                              balance.netOutstanding > 0
                                ? "bg-red-100"
                                : "bg-emerald-100"
                            }`}
                          >
                            {balance.netOutstanding > 0 ? (
                              <AlertTriangle className="h-5 w-5 text-red-600" />
                            ) : (
                              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                            )}
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground">
                              Net Outstanding
                            </p>
                            <p
                              className={`text-2xl font-bold tabular-nums ${
                                balance.netOutstanding > 0 ? "text-red-600" : "text-emerald-600"
                              }`}
                            >
                              {balance.netOutstanding.toFixed(2)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Gross: {balance.outstanding.toFixed(2)}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="border-indigo-100 bg-gradient-to-br from-indigo-50/50 to-card">
                      <CardContent className="pt-5 pb-5 px-5">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg bg-indigo-100 flex items-center justify-center">
                            <Landmark className="h-5 w-5 text-indigo-600" />
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground">
                              Available Credit
                            </p>
                            <p className="text-2xl font-bold tabular-nums text-indigo-700">
                              {balance.creditBalance.toFixed(2)}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Payment progress bar */}
                  {balance.totalDue > 0 && (
                    <div className="rounded-lg border bg-card p-4">
                      <div className="flex items-center justify-between text-sm mb-2">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <TrendingUp className="h-4 w-4" />
                          Payment Progress
                        </span>
                        <span className="font-semibold tabular-nums">
                          {paymentProgress.toFixed(0)}%
                        </span>
                      </div>
                      <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            paymentProgress >= 100
                              ? "bg-emerald-500"
                              : paymentProgress >= 50
                              ? "bg-primary"
                              : "bg-amber-500"
                          }`}
                          style={{ width: `${paymentProgress}%` }}
                        />
                      </div>
                      {balance.overdueCount > 0 && (
                        <p className="text-xs text-red-600 mt-2 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          {balance.overdueCount} overdue payment{balance.overdueCount > 1 ? "s" : ""}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Household Members */}
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="h-5 w-5 text-primary" />
                    Household Members
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  {/* Spouse */}
                  {membership.spouse && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Gem className="h-4 w-4 text-pink-500" />
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Spouse
                        </span>
                      </div>
                      <div className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/30 transition-colors">
                        <PersonAvatar name={membership.spouse.fullName} />
                        <div className="flex-1 min-w-0">
                          <Link
                            href={`/persons/${membership.spouse.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-sm hover:text-primary transition-colors flex items-center gap-1"
                          >
                            {membership.spouse.fullName}
                            <ArrowUpRight className="h-3 w-3" />
                          </Link>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {membership.spouse.nameWithInitials}
                            {membership.spouse.dateOfBirth && (() => {
                              const age = getAge(membership.spouse!.dateOfBirth);
                              return age !== null ? ` · ${age} years` : "";
                            })()}
                          </p>
                        </div>
                        {membership.spouse.relationToHOH && (
                          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                            {membership.spouse.relationToHOH}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Children */}
                  {childDependents.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Baby className="h-4 w-4 text-amber-500" />
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Children
                        </span>
                        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                          {childDependents.length}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {childDependents.map((d) => {
                          const age = getAge(d.person.dateOfBirth);
                          return (
                            <div
                              key={d.person.id}
                              className="flex items-center gap-3 p-2.5 rounded-lg border hover:bg-muted/30 transition-colors"
                            >
                              <PersonAvatar name={d.person.fullName} size="sm" />
                              <div className="flex-1 min-w-0">
                                <Link
                                  href={`/persons/${d.person.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-medium text-sm hover:text-primary transition-colors flex items-center gap-1"
                                >
                                  {d.person.fullName}
                                  <ArrowUpRight className="h-3 w-3" />
                                </Link>
                                {age !== null && (
                                  <p className="text-xs text-muted-foreground">{age} years</p>
                                )}
                              </div>
                              {d.person.relationToHOH && (
                                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                                  {d.person.relationToHOH}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Other Dependents */}
                  {otherDependents.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <UserPlus className="h-4 w-4 text-slate-500" />
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Other Dependents
                        </span>
                        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                          {otherDependents.length}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {otherDependents.map((d) => {
                          const age = getAge(d.person.dateOfBirth);
                          return (
                            <div
                              key={d.person.id}
                              className="flex items-center gap-3 p-2.5 rounded-lg border hover:bg-muted/30 transition-colors"
                            >
                              <PersonAvatar name={d.person.fullName} size="sm" />
                              <div className="flex-1 min-w-0">
                                <Link
                                  href={`/persons/${d.person.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-medium text-sm hover:text-primary transition-colors flex items-center gap-1"
                                >
                                  {d.person.fullName}
                                  <ArrowUpRight className="h-3 w-3" />
                                </Link>
                                {age !== null && (
                                  <p className="text-xs text-muted-foreground">{age} years</p>
                                )}
                              </div>
                              {d.person.relationToHOH && (
                                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                                  {d.person.relationToHOH}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {!membership.spouse && childDependents.length === 0 && otherDependents.length === 0 && (
                    <div className="text-center py-8">
                      <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">
                        No other household members recorded.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Membership info */}
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="h-5 w-5 text-primary" />
                    Membership Info
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-0 text-sm">
                    {[
                      { label: "Type", value: membership.membershipType },
                      { label: "Status", value: membership.membershipStatus },
                      {
                        label: "Registered",
                        value: new Date(membership.dateOfRegistration).toLocaleDateString(),
                      },
                      { label: "Payment Period", value: membership.paymentPeriod },
                      {
                        label: "Membership Fee",
                        value: Number(membership.membershipFee).toFixed(2),
                        mono: true,
                      },
                      {
                        label: "Discount",
                        value: Number(membership.membershipFeeDiscount).toFixed(2),
                        mono: true,
                      },
                      {
                        label: "Voluntary Contributions",
                        value: Number(membership.additionalVoluntaryContributions).toFixed(2),
                        mono: true,
                      },
                      {
                        label: "Total Contribution",
                        value: Number(membership.totalContribution).toFixed(2),
                        mono: true,
                      },
                      { label: "Disability", value: yesNo(membership.disability) },
                      {
                        label: "Zakath Eligible",
                        value:
                          membership.isZakathEligible === null ||
                          membership.isZakathEligible === undefined
                            ? "Not Set"
                            : yesNo(membership.isZakathEligible),
                      },
                      {
                        label: "Area Code",
                        value: membership.areaCode ?? "Not Set",
                      },
                      ...(membership.createdBy
                        ? [{ label: "Created by", value: membership.createdBy.email }]
                        : []),
                    ].map((item, i) => (
                      <div
                        key={i}
                        className="flex justify-between items-center py-2.5 border-b border-border/40 last:border-0"
                      >
                        <span className="text-muted-foreground">{item.label}</span>
                        <span
                          className={`font-medium ${
                            "mono" in item && item.mono ? "tabular-nums" : ""
                          }`}
                        >
                          {item.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Assets & Facilities */}
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Home className="h-5 w-5 text-primary" />
                    Assets & Facilities
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    <AssetBadge icon={MapPin} label="Land" active={membership.land} />
                    <AssetBadge icon={Home} label="House" active={membership.houseOwnership} />
                    <AssetBadge
                      icon={Building2}
                      label="Commercial"
                      active={membership.commercialProperties}
                    />
                    <AssetBadge icon={Bath} label="Toilet" active={membership.toiletFacility} />
                    <AssetBadge icon={Car} label="Vehicle" active={membership.vehicleOwnership} />
                    <AssetBadge icon={Droplets} label="Water" active={membership.waterAccessibility} />
                    <AssetBadge icon={Zap} label="Electricity" active={membership.electricity} />
                  </div>
                </CardContent>
              </Card>

              {/* Dues & record payment */}
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Receipt className="h-5 w-5 text-primary" />
                    Dues & Payments
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {balance && balance.dues.length > 0 ? (
                    <div className="rounded-lg border overflow-x-auto">
                      <table className="w-full text-sm min-w-[480px]">
                        <thead>
                          <tr className="bg-muted/50 border-b">
                            <th className="text-left p-3 font-medium text-muted-foreground">
                              Period
                            </th>
                            <th className="text-right p-3 font-medium text-muted-foreground">
                              Due
                            </th>
                            <th className="text-right p-3 font-medium text-muted-foreground">
                              Paid
                            </th>
                            <th className="text-center p-3 font-medium text-muted-foreground">
                              Status
                            </th>
                            <th className="p-3 w-20 print:hidden"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {balance.dues.map((d, i) => {
                            const remaining = Number(d.amountDue) - Number(d.amountPaid);
                            const StatusIcon = statusIcons[d.status] ?? Clock;
                            return (
                              <tr
                                key={d.id}
                                className={`border-b last:border-0 transition-colors hover:bg-muted/30 ${
                                  i % 2 === 0 ? "" : "bg-muted/10"
                                }`}
                              >
                                <td className="p-3 font-medium">{d.period}</td>
                                <td className="p-3 text-right tabular-nums">
                                  {Number(d.amountDue).toFixed(2)}
                                </td>
                                <td className="p-3 text-right tabular-nums">
                                  {Number(d.amountPaid).toFixed(2)}
                                </td>
                                <td className="p-3 text-center">
                                  <span
                                    className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border ${
                                      statusColors[d.status] ?? ""
                                    }`}
                                  >
                                    <StatusIcon className="h-3 w-3" />
                                    {d.status}
                                  </span>
                                </td>
                                <td className="p-3 text-right print:hidden">
                                  {d.status !== "paid" && remaining > 0 && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs gap-1"
                                      onClick={() => openPayDialog(d)}
                                    >
                                      <DollarSign className="h-3 w-3" />
                                      Pay
                                    </Button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-10">
                      <Receipt className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">
                        No dues generated yet.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── Tab 2: Payment History ──────────────────────── */}
          <TabsContent value="history" forceMount className="data-[state=inactive]:hidden print:!block print:break-before-page">
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-5 w-5 text-primary" />
                  Transaction History
                </CardTitle>
              </CardHeader>
              <CardContent>
                {payments.length === 0 ? (
                  <div className="text-center py-10">
                    <CreditCard className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">
                      No payments recorded yet.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="rounded-lg border overflow-x-auto">
                      <table className="w-full text-sm min-w-[540px]">
                        <thead>
                          <tr className="bg-muted/50 border-b">
                            <th className="text-left p-3 font-medium text-muted-foreground">
                              Date
                            </th>
                            <th className="text-left p-3 font-medium text-muted-foreground">
                              Period
                            </th>
                            <th className="text-right p-3 font-medium text-muted-foreground">
                              Amount
                            </th>
                            <th className="text-left p-3 font-medium text-muted-foreground">
                              Collected by
                            </th>
                            <th className="text-left p-3 font-medium text-muted-foreground">
                              Note
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {payments.map((p, i) => (
                            <tr
                              key={p.id}
                              className={`border-b last:border-0 transition-colors hover:bg-muted/30 ${
                                i % 2 === 0 ? "" : "bg-muted/10"
                              }`}
                            >
                              <td className="p-3">
                                {new Date(p.paymentDate).toLocaleDateString()}
                              </td>
                              <td className="p-3 font-medium">
                                {p.paymentDue?.period ?? "—"}
                              </td>
                              <td className="p-3 text-right tabular-nums font-semibold text-emerald-600">
                                +{Number(p.amount).toFixed(2)}
                              </td>
                              <td className="p-3 text-muted-foreground">
                                {p.collectedBy?.email ?? "—"}
                              </td>
                              <td className="p-3 text-muted-foreground max-w-[200px] truncate">
                                {p.note || "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex items-center justify-between text-sm text-muted-foreground mt-4 pt-4 border-t print:hidden">
                      <span className="font-medium">
                        {paymentsTotal} transaction{paymentsTotal !== 1 ? "s" : ""}
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0"
                          disabled={paymentsPage <= 1}
                          onClick={() => setPaymentsPage((p) => Math.max(1, p - 1))}
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="tabular-nums min-w-[100px] text-center">
                          Page {paymentsPage} of {totalPaymentPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0"
                          disabled={paymentsPage >= totalPaymentPages}
                          onClick={() =>
                            setPaymentsPage((p) => Math.min(totalPaymentPages, p + 1))
                          }
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Tab 3: Credit Ledger ───────────────────────────── */}
          <TabsContent value="credit-ledger" forceMount className="data-[state=inactive]:hidden print:hidden">
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <Landmark className="h-5 w-5 text-primary" />
                  Credit Ledger
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm text-muted-foreground">
                    Member-owned balance from overpayments and auto-applications.
                  </p>
                  <div className="text-sm rounded-md bg-muted px-3 py-1.5">
                    Current Balance:{" "}
                    <span className="font-semibold tabular-nums text-indigo-700">
                      {creditBalance.toFixed(2)}
                    </span>
                  </div>
                </div>

                {creditEntries.length === 0 ? (
                  <div className="text-center py-10">
                    <Landmark className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">
                      No credit ledger entries yet.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="rounded-lg border overflow-x-auto">
                      <table className="w-full text-sm min-w-[720px]">
                        <thead>
                          <tr className="bg-muted/50 border-b">
                            <th className="text-left p-3 font-medium text-muted-foreground">
                              Date
                            </th>
                            <th className="text-left p-3 font-medium text-muted-foreground">
                              Entry
                            </th>
                            <th className="text-left p-3 font-medium text-muted-foreground">
                              Due Period
                            </th>
                            <th className="text-left p-3 font-medium text-muted-foreground">
                              Note
                            </th>
                            <th className="text-right p-3 font-medium text-muted-foreground">
                              Delta
                            </th>
                            <th className="text-left p-3 font-medium text-muted-foreground">
                              By
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {creditEntries.map((entry, i) => {
                            const delta = Number(entry.amountDelta);
                            const isCredit = delta >= 0;
                            return (
                              <tr
                                key={entry.id}
                                className={`border-b last:border-0 transition-colors hover:bg-muted/30 ${
                                  i % 2 === 0 ? "" : "bg-muted/10"
                                }`}
                              >
                                <td className="p-3">
                                  {new Date(entry.createdAt).toLocaleDateString()}
                                </td>
                                <td className="p-3 font-medium">
                                  {creditEntryLabel(entry.entryType)}
                                </td>
                                <td className="p-3">
                                  {entry.paymentDue?.period ?? "—"}
                                </td>
                                <td className="p-3 text-muted-foreground max-w-[260px] truncate">
                                  {entry.note || "—"}
                                </td>
                                <td
                                  className={`p-3 text-right tabular-nums font-semibold ${
                                    isCredit ? "text-emerald-600" : "text-amber-700"
                                  }`}
                                >
                                  {isCredit ? "+" : ""}
                                  {delta.toFixed(2)}
                                </td>
                                <td className="p-3 text-muted-foreground">
                                  {entry.createdBy?.email ?? "System"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex items-center justify-between text-sm text-muted-foreground mt-4 pt-4 border-t">
                      <span className="font-medium">
                        {creditTotal} entr{creditTotal === 1 ? "y" : "ies"}
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0"
                          disabled={creditPage <= 1}
                          onClick={() => setCreditPage((p) => Math.max(1, p - 1))}
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="tabular-nums min-w-[100px] text-center">
                          Page {creditPage} of {totalCreditPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0"
                          disabled={creditPage >= totalCreditPages}
                          onClick={() => setCreditPage((p) => Math.min(totalCreditPages, p + 1))}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Record payment dialog */}
      <Dialog open={payDialogOpen} onOpenChange={setPayDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" />
              Record Payment
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRecordPayment} className="space-y-5">
            {payDue && (
              <div className="rounded-lg bg-muted/50 border p-4 space-y-2">
                <p className="text-sm font-medium">{payDue.period}</p>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Due</p>
                    <p className="font-semibold tabular-nums">
                      {Number(payDue.amountDue).toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Paid</p>
                    <p className="font-semibold tabular-nums text-emerald-600">
                      {Number(payDue.amountPaid).toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Remaining</p>
                    <p className="font-semibold tabular-nums text-red-600">
                      {(Number(payDue.amountDue) - Number(payDue.amountPaid)).toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Note (optional)</Label>
              <Input
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                placeholder="e.g. Cash, bank transfer…"
              />
            </div>
            {payError && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                {payError}
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <Button type="submit" disabled={paySubmitting} className="flex-1 gap-1.5">
                <CheckCircle2 className="h-4 w-4" />
                {paySubmitting ? "Recording…" : "Record Payment"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPayDialogOpen(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* QR Code dialog */}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-center">
              {membership?.membershipNo}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4">
            {qrDataUrl && (
              <div className="p-4 bg-white rounded-xl shadow-sm border">
                <img
                  src={qrDataUrl}
                  alt={`QR code for ${membership?.membershipNo}`}
                  className="w-56 h-56 rounded-lg"
                />
              </div>
            )}
            <p className="text-xs text-muted-foreground text-center">
              Scan to view membership details
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={downloadQr}
              className="gap-1.5"
            >
              <Download className="h-4 w-4" />
              Download PNG
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
