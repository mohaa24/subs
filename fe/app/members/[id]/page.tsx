"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import {
  api,
  type Membership,
  type Person,
  type MembershipBalance,
    type MembershipCreditEntry,
    type Payment,
    type PaymentReceipt,
    type PaymentDue,
    type PaymentStatementItem,
    type Zone,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { ActivityFeedPanel } from "@/components/activity-feed-panel";
import {
  RecordPaymentDialog,
  type PaymentMethod,
  getPaymentMethodLabel,
} from "@/components/record-payment-dialog";
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
    Printer,
    Archive,
    ArchiveRestore,
  RotateCcw,
    Pencil,
    MessageSquareText,
    Plus,
} from "lucide-react";
import QRCode from "qrcode";
import { toast } from "@/hooks/use-toast";
import { getPaymentDueSubtitle, getPaymentDueTitle } from "@/lib/payment-due";
import {
  PaymentReceiptDialog,
  type PaymentReceiptData,
} from "@/components/payment-receipt-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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

const hiddenStatementEntryTypes: PaymentStatementItem["entryType"][] = [
  "credit_overpayment",
  "debit_auto_apply",
  "credit_adjustment",
  "debit_adjustment",
];

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
  const [statementItems, setStatementItems] = useState<PaymentStatementItem[]>([]);
  const [statementLoading, setStatementLoading] = useState(true);
  const [creditEntries, setCreditEntries] = useState<MembershipCreditEntry[]>([]);
  const [creditTotal, setCreditTotal] = useState(0);
  const [creditBalance, setCreditBalance] = useState(0);
  const [creditPage, setCreditPage] = useState(1);
  const creditLimit = 20;

  const [zones, setZones] = useState<Zone[]>([]);

  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");

  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payDue, setPayDue] = useState<PaymentDue | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [payNote, setPayNote] = useState("");
  const [paySubmitting, setPaySubmitting] = useState(false);
  const [payError, setPayError] = useState("");
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptData, setReceiptData] = useState<PaymentReceiptData | null>(null);
  const [loadingReceiptPaymentId, setLoadingReceiptPaymentId] = useState<string | null>(null);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [reverseTarget, setReverseTarget] = useState<Payment | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reverseSubmitting, setReverseSubmitting] = useState(false);
  const [editDueTarget, setEditDueTarget] = useState<PaymentDue | null>(null);
  const [editDueAmount, setEditDueAmount] = useState("");
  const [editDueReason, setEditDueReason] = useState("");
  const [editDueSubmitting, setEditDueSubmitting] = useState(false);
  const [manualDueOpen, setManualDueOpen] = useState(false);
  const [manualDueAmount, setManualDueAmount] = useState("");
  const [manualDueReason, setManualDueReason] = useState("");
  const [manualDueFrom, setManualDueFrom] = useState("");
  const [manualDueTo, setManualDueTo] = useState("");
  const [manualDueSubmitting, setManualDueSubmitting] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  let visibleRunningBalance = 0;
  const visibleStatementItems = statementItems
    .filter((entry) => !hiddenStatementEntryTypes.includes(entry.entryType))
    .map((entry) => {
      visibleRunningBalance += entry.debit - entry.credit;
      return { ...entry, balance: visibleRunningBalance };
    });

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

  const loadStatement = useCallback(() => {
    if (!user || !id) return;
    setStatementLoading(true);
    api<{ items: PaymentStatementItem[] }>(`/payments/statement/${id}`)
      .then((r) => {
        setStatementItems(r.items);
      })
      .catch(() => setStatementItems([]))
      .finally(() => setStatementLoading(false));
  }, [user, id]);

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
    loadStatement();
  }, [loadStatement]);

  useEffect(() => {
    loadCreditLedger();
  }, [loadCreditLedger]);

  useEffect(() => {
    if (!membership) return;
    const orgId = membership.organizationId;
    const params: Record<string, string> = { includeInactive: "true" };
    if (user?.role === "super_user") params.organizationId = orgId;
    api<Zone[]>("/zones", { params })
      .then(setZones)
      .catch(() => setZones([]));
  }, [membership, user?.role]);

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
    const opened = window.open(`/members/${id}/export?print=1`, "_blank");
    if (!opened) {
      toast({
        variant: "destructive",
        title: "Unable to open export",
        description: "Please allow popups for this site and try again.",
      });
    }
  }

  function handleToggleArchive() {
    if (!membership) return;
    const isCurrentlyArchived = (membership as any).isArchived;
    if (!isCurrentlyArchived) {
      setArchiveConfirmOpen(true);
      return;
    }
    doArchive(false);
  }

  async function doArchive(isArchived: boolean) {
    try {
      await api(`/memberships/${id}/archive`, {
        method: "PATCH",
        body: JSON.stringify({ isArchived }),
      });
      setMembership((prev) => prev ? { ...prev, isArchived } as any : prev);
      toast({ title: isArchived ? "Membership archived" : "Membership restored" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed",
        description: err instanceof Error ? err.message : "Failed to update",
      });
    }
  }

  const canManage = user?.role === "admin" || user?.role === "super_user";

  async function handleReversePayment() {
    if (!reverseTarget || !reverseReason.trim()) return;
    setReverseSubmitting(true);
    try {
      await api(`/payments/${reverseTarget.id}/reverse`, {
        method: "POST",
        body: JSON.stringify({ reason: reverseReason.trim() }),
      });
      toast({ title: "Payment reversed" });
      setReverseTarget(null);
      setReverseReason("");
      loadBalance();
      loadStatement();
      loadCreditLedger();
    } catch (err) {
      toast({ variant: "destructive", title: "Failed", description: err instanceof Error ? err.message : "Failed" });
    } finally {
      setReverseSubmitting(false);
    }
  }

  async function handleEditDue() {
    if (!editDueTarget || !editDueReason.trim()) return;
    const amt = parseFloat(editDueAmount);
    if (isNaN(amt) || amt < 0) return;
    setEditDueSubmitting(true);
    try {
      await api(`/payments/dues/${editDueTarget.id}`, {
        method: "PATCH",
        body: JSON.stringify({ amountDue: amt, reason: editDueReason.trim() }),
      });
      toast({ title: "Due updated" });
      setEditDueTarget(null);
      loadBalance();
      loadStatement();
    } catch (err) {
      toast({ variant: "destructive", title: "Failed", description: err instanceof Error ? err.message : "Failed" });
    } finally {
      setEditDueSubmitting(false);
    }
  }

  function resetManualDueForm() {
    setManualDueAmount("");
    setManualDueReason("");
    setManualDueFrom("");
    setManualDueTo("");
    setManualDueSubmitting(false);
  }

  function openManualDueDialog() {
    resetManualDueForm();
    setManualDueOpen(true);
  }

  async function handleCreateManualDue() {
    if (!membership) return;
    const amt = parseFloat(manualDueAmount);
    if (isNaN(amt) || amt <= 0) {
      toast({
        variant: "destructive",
        title: "Invalid due amount",
        description: "Enter an amount greater than zero.",
      });
      return;
    }
    if (manualDueFrom && manualDueTo && manualDueTo < manualDueFrom) {
      toast({
        variant: "destructive",
        title: "Invalid period",
        description: "Period end must be on or after period start.",
      });
      return;
    }

    setManualDueSubmitting(true);
    try {
      const created = await api<PaymentDue & { autoAppliedCredit?: number }>("/payments/dues", {
        method: "POST",
        body: JSON.stringify({
          membershipId: membership.id,
          amountDue: amt,
          reason: manualDueReason.trim() || undefined,
          periodFrom: manualDueFrom || undefined,
          periodTo: manualDueTo || undefined,
        }),
      });
      toast({
        title: "Manual due created",
        description:
          created.autoAppliedCredit && created.autoAppliedCredit > 0
            ? `Due created and Rs. ${created.autoAppliedCredit.toFixed(2)} credit was auto-applied.`
            : "The due entry has been created.",
      });
      setManualDueOpen(false);
      resetManualDueForm();
      loadBalance();
      loadStatement();
      loadCreditLedger();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed to create due",
        description: err instanceof Error ? err.message : "Failed",
      });
    } finally {
      setManualDueSubmitting(false);
    }
  }

  function openPayDialog(due: PaymentDue) {
    const remaining = Number(due.amountDue) - Number(due.amountPaid);
    setPayDue(due);
    setPayAmount(String(remaining > 0 ? remaining.toFixed(2) : "0"));
    setPayMethod("cash");
    setPayNote("");
    setPayError("");
    setPayDialogOpen(true);
  }

  async function handleRecordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payDue || !membership) return;
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
      const methodLabel = getPaymentMethodLabel(payMethod);
      const combinedNote = [methodLabel, payNote].filter(Boolean).join(" — ");
      const payment = await api<{ id: string; paymentDate: string }>("/payments", {
        method: "POST",
        body: JSON.stringify({
          paymentDueId: payDue.id,
          amount: amt,
          note: combinedNote || undefined,
        }),
      });
      const amountDue = Number(payDue.amountDue);
      const amountPaidBefore = Number(payDue.amountPaid);
      const remainingBefore = Math.max(0, amountDue - amountPaidBefore);
      const appliedToDue = Math.min(amt, remainingBefore);
      const overpaymentToCredit = Math.max(0, amt - appliedToDue);
      const remainingAfter = Math.max(0, remainingBefore - appliedToDue);
      setReceiptData({
        organizationName:
          user?.organization?.name || membership.organization?.name || "Organization",
        membershipNo: membership.membershipNo,
        membershipId: membership.id,
        memberName:
          membership.hod?.fullName || membership.hod?.nameWithInitials || "",
        period: payDue.period,
        paymentId: payment.id,
        paymentDate: payment.paymentDate,
        paidAmount: amt,
        appliedToDue,
        overpaymentToCredit,
        remainingAfter,
        note: combinedNote || null,
        collectedBy: user?.email || "",
        memberQrValue: `${window.location.origin}/members/${membership.id}`,
      });
      setReceiptOpen(true);
      setPayDialogOpen(false);
      toast({
        title: "Payment recorded",
        description: "Payment has been saved successfully.",
      });
      loadBalance();
      loadStatement();
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

  async function openReceiptForPayment(paymentId: string) {
    setLoadingReceiptPaymentId(paymentId);
    try {
      const receipt = await api<PaymentReceipt>(`/payments/receipt/${paymentId}`);
      setReceiptData({
        organizationName: receipt.organizationName,
        membershipNo: receipt.membershipNo,
        membershipId: receipt.membershipId,
        memberName: receipt.memberName,
        period: receipt.period,
        paymentId: receipt.paymentId,
        paymentDate: receipt.paymentDate,
        paidAmount: receipt.paidAmount,
        appliedToDue: receipt.appliedToDue,
        overpaymentToCredit: receipt.overpaymentToCredit,
        remainingAfter: receipt.remainingAfter,
        note: receipt.note || null,
        collectedBy: receipt.collectedBy,
        memberQrValue: `${window.location.origin}/members/${receipt.membershipId}`,
      });
      setReceiptOpen(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load receipt";
      toast({
        variant: "destructive",
        title: "Failed to load receipt",
        description: msg,
      });
    } finally {
      setLoadingReceiptPaymentId(null);
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
  const totalCreditPages = Math.ceil(creditTotal / creditLimit) || 1;

  function creditEntryLabel(entry: MembershipCreditEntry) {
    if (
      entry.entryType === "credit_adjustment" &&
      entry.note?.toLowerCase().includes("moved to due")
    ) {
      return "Moved to Due";
    }
    if (entry.entryType === "credit_overpayment") return "Overpayment";
    if (entry.entryType === "debit_auto_apply") return "Auto-applied";
    if (entry.entryType === "credit_adjustment") return "Adjustment (credit)";
    if (entry.entryType === "debit_adjustment") return "Adjustment (debit)";
    return entry.entryType;
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

  function isCountableMember(person: Person | undefined | null) {
    if (!person) return false;
    if (person.isArchived) return false;
    return !person.livingStatus || person.livingStatus === "Active";
  }

  const allMembers = [
    ...(membership.hod ? [membership.hod] : []),
    ...(membership.spouse ? [membership.spouse] : []),
    ...(membership.dependents?.map((d) => d.person) ?? []),
  ];
  const countableMembers = allMembers.filter(isCountableMember);
  const totalHeadcount = countableMembers.length;
  const adults = countableMembers.filter((p) => {
    const age = getAge(p.dateOfBirth);
    return age === null || age >= 18;
  }).length;
  const youth = countableMembers.filter((p) => {
    const age = getAge(p.dateOfBirth);
    return age !== null && age >= 13 && age <= 17;
  }).length;
  const children = countableMembers.filter((p) => {
    const age = getAge(p.dateOfBirth);
    return age !== null && age >= 0 && age <= 12;
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
                    {(membership as any).isArchived && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">
                        <Archive className="h-3 w-3" />
                        Archived
                      </span>
                    )}
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
                  <span className="hidden sm:inline">Export Record</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleToggleArchive}
                  className="gap-1.5"
                >
                  {(membership as any).isArchived
                    ? <><ArchiveRestore className="h-4 w-4 text-emerald-600" /><span className="hidden sm:inline">Restore</span></>
                    : <><Archive className="h-4 w-4 text-amber-600" /><span className="hidden sm:inline">Archive</span></>
                  }
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
              <Users className="h-4 w-4" />
              Details
            </TabsTrigger>
            <TabsTrigger value="payments" className="gap-1.5">
              <CreditCard className="h-4 w-4" />
              Payments
            </TabsTrigger>
            <TabsTrigger value="activity" className="gap-1.5">
              <MessageSquareText className="h-4 w-4" />
              Activity
            </TabsTrigger>
            <TabsTrigger value="credit-ledger" className="gap-1.5">
              <Landmark className="h-4 w-4" />
              Credit Ledger
            </TabsTrigger>
          </TabsList>

          {/* ── Tab 1: Details ──────────────────────────────── */}
          <TabsContent value="details" forceMount className="data-[state=inactive]:hidden print:!block">
            <div className="space-y-6">

              {/* ── Headcount Stat Widgets ────────────────────── */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-4 pb-4 px-4">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-blue-100 flex items-center justify-center">
                        <Users className="h-4.5 w-4.5 text-blue-600" />
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Total Headcount</p>
                        <p className="text-2xl font-bold tabular-nums">{totalHeadcount}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-4 px-4">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-sky-100 flex items-center justify-center">
                        <User className="h-4.5 w-4.5 text-sky-600" />
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
                      <div className="h-9 w-9 rounded-lg bg-purple-100 flex items-center justify-center">
                        <UserPlus className="h-4.5 w-4.5 text-purple-600" />
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Youth (13–17)</p>
                        <p className="text-2xl font-bold tabular-nums">{youth}</p>
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
                        <p className="text-xs font-medium text-muted-foreground">Children (0–12)</p>
                        <p className="text-2xl font-bold tabular-nums">{children}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

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
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {membership.spouse.relationToHOH && (
                            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                              {membership.spouse.relationToHOH}
                            </span>
                          )}
                          {membership.spouse.livingStatus && membership.spouse.livingStatus !== "Active" && (
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                              membership.spouse.livingStatus === "Deceased"
                                ? "bg-red-50 text-red-700 border-red-200"
                                : "bg-slate-100 text-slate-600 border-slate-200"
                            }`}>
                              {membership.spouse.livingStatus === "PermanentlyRelocated" ? "Relocated" : membership.spouse.livingStatus}
                            </span>
                          )}
                          {(!membership.spouse.livingStatus || membership.spouse.livingStatus === "Active") && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
                              Active
                            </span>
                          )}
                        </div>
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
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                {d.person.relationToHOH && (
                                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                                    {d.person.relationToHOH}
                                  </span>
                                )}
                                {d.person.livingStatus && d.person.livingStatus !== "Active" && (
                                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                                    d.person.livingStatus === "Deceased"
                                      ? "bg-red-50 text-red-700 border-red-200"
                                      : "bg-slate-100 text-slate-600 border-slate-200"
                                  }`}>
                                    {d.person.livingStatus === "PermanentlyRelocated" ? "Relocated" : d.person.livingStatus}
                                  </span>
                                )}
                                {(!d.person.livingStatus || d.person.livingStatus === "Active") && (
                                  <span className="text-xs font-medium px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
                                    Active
                                  </span>
                                )}
                              </div>
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
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                {d.person.relationToHOH && (
                                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                                    {d.person.relationToHOH}
                                  </span>
                                )}
                                {d.person.livingStatus && d.person.livingStatus !== "Active" && (
                                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                                    d.person.livingStatus === "Deceased"
                                      ? "bg-red-50 text-red-700 border-red-200"
                                      : "bg-slate-100 text-slate-600 border-slate-200"
                                  }`}>
                                    {d.person.livingStatus === "PermanentlyRelocated" ? "Relocated" : d.person.livingStatus}
                                  </span>
                                )}
                                {(!d.person.livingStatus || d.person.livingStatus === "Active") && (
                                  <span className="text-xs font-medium px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
                                    Active
                                  </span>
                                )}
                              </div>
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
                        label: "Zone",
                        value: membership.areaCode
                          ? (() => {
                              const zone = zones.find((z) => z.code === membership.areaCode);
                              return zone ? `${zone.code} — ${zone.name}` : String(membership.areaCode);
                            })()
                          : "Not Set",
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

            </div>
          </TabsContent>

          {/* ── Tab 2: Payments ──────────────────────────────── */}
          <TabsContent value="payments" forceMount className="data-[state=inactive]:hidden print:!block print:break-before-page">
            <div className="space-y-6">

              {/* Payment Statistics */}
              {balance && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <Card className="border-blue-100 bg-gradient-to-br from-blue-50/50 to-card">
                    <CardContent className="pt-4 pb-4 px-4">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-lg bg-blue-100 flex items-center justify-center">
                          <DollarSign className="h-4.5 w-4.5 text-blue-600" />
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Total Due</p>
                          <p className="text-2xl font-bold tabular-nums">{balance.totalDue.toFixed(2)}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border-emerald-100 bg-gradient-to-br from-emerald-50/50 to-card">
                    <CardContent className="pt-4 pb-4 px-4">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-lg bg-emerald-100 flex items-center justify-center">
                          <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600" />
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Total Received</p>
                          <p className="text-2xl font-bold tabular-nums text-emerald-600">{balance.totalPaid.toFixed(2)}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className={balance.outstanding > 0 ? "border-red-100 bg-gradient-to-br from-red-50/50 to-card" : "border-emerald-100 bg-gradient-to-br from-emerald-50/50 to-card"}>
                    <CardContent className="pt-4 pb-4 px-4">
                      <div className="flex items-center gap-3">
                        <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${balance.outstanding > 0 ? "bg-red-100" : "bg-emerald-100"}`}>
                          {balance.outstanding > 0 ? <AlertTriangle className="h-4.5 w-4.5 text-red-600" /> : <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600" />}
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Outstanding Dues</p>
                          <p className={`text-2xl font-bold tabular-nums ${balance.outstanding > 0 ? "text-red-600" : "text-emerald-600"}`}>{balance.outstanding.toFixed(2)}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border-indigo-100 bg-gradient-to-br from-indigo-50/50 to-card">
                    <CardContent className="pt-4 pb-4 px-4">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-lg bg-indigo-100 flex items-center justify-center">
                          <Landmark className="h-4.5 w-4.5 text-indigo-600" />
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Available Credit</p>
                          <p className="text-2xl font-bold tabular-nums text-indigo-700">{balance.creditBalance.toFixed(2)}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Membership Fee Details */}
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Receipt className="h-5 w-5 text-primary" />
                    Membership Fee Details
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-0 text-sm">
                    {[
                      { label: "Membership Fee", value: Number(membership.membershipFee).toFixed(2), mono: true },
                      { label: "Voluntary Contribution", value: Number(membership.additionalVoluntaryContributions).toFixed(2), mono: true },
                      { label: "Discount", value: Number(membership.membershipFeeDiscount).toFixed(2), mono: true },
                      { label: "Total Contribution", value: Number(membership.totalContribution).toFixed(2), mono: true },
                      { label: "Payment Period", value: membership.paymentPeriod },
                    ].map((item, i) => (
                      <div
                        key={i}
                        className="flex justify-between items-center py-2.5 border-b border-border/40 last:border-0"
                      >
                        <span className="text-muted-foreground">{item.label}</span>
                        <span className={`font-medium ${"mono" in item && item.mono ? "tabular-nums" : ""}`}>{item.value}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Dues & Payments */}
              <Card>
                <CardHeader className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <DollarSign className="h-5 w-5 text-primary" />
                    Dues & Payments
                  </CardTitle>
                  {canManage && (
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={openManualDueDialog}>
                      <Plus className="h-4 w-4" />
                      Add Manual Due
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  {balance && balance.dues.length > 0 ? (
                    <>
                      <div className="space-y-3 md:hidden print:hidden">
                        {balance.dues.map((d) => {
                          const remaining = Number(d.amountDue) - Number(d.amountPaid);
                          const StatusIcon = statusIcons[d.status] ?? Clock;
                          return (
                            <div key={d.id} className="rounded-md border p-3 bg-card">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="font-medium">{getPaymentDueTitle(d)}</p>
                                  {getPaymentDueSubtitle(d) && (
                                    <p className="mt-0.5 text-xs text-muted-foreground">{getPaymentDueSubtitle(d)}</p>
                                  )}
                                </div>
                                <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${statusColors[d.status] ?? ""}`}>
                                  <StatusIcon className="h-3 w-3" />
                                  {d.status}
                                </span>
                              </div>
                              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                                <div>
                                  <p className="text-muted-foreground">Due</p>
                                  <p className="font-medium tabular-nums">{Number(d.amountDue).toFixed(2)}</p>
                                </div>
                                <div>
                                  <p className="text-muted-foreground">Paid</p>
                                  <p className="font-medium tabular-nums">{Number(d.amountPaid).toFixed(2)}</p>
                                </div>
                                <div>
                                  <p className="text-muted-foreground">Remaining</p>
                                  <p className="font-medium tabular-nums">{remaining.toFixed(2)}</p>
                                </div>
                              </div>
                              <div className="mt-3 flex gap-2">
                                {d.status !== "paid" && remaining > 0 && (
                                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => openPayDialog(d)}>
                                    <DollarSign className="h-3 w-3" />
                                    Pay
                                  </Button>
                                )}
                                {canManage && d.status !== "paid" && (
                                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => { setEditDueTarget(d); setEditDueAmount(String(Number(d.amountDue))); setEditDueReason(""); }}>
                                    <Pencil className="h-3 w-3" />
                                    Edit
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="hidden md:block print:block rounded-lg border overflow-x-auto">
                        <table className="w-full text-sm min-w-[480px]">
                          <thead>
                            <tr className="bg-muted/50 border-b">
                              <th className="text-left p-3 font-medium text-muted-foreground">Period</th>
                              <th className="text-right p-3 font-medium text-muted-foreground">Due</th>
                              <th className="text-right p-3 font-medium text-muted-foreground">Paid</th>
                              <th className="text-center p-3 font-medium text-muted-foreground">Status</th>
                              <th className="p-3 w-20 print:hidden"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {balance.dues.map((d, i) => {
                              const remaining = Number(d.amountDue) - Number(d.amountPaid);
                              const StatusIcon = statusIcons[d.status] ?? Clock;
                              return (
                                <tr key={d.id} className={`border-b last:border-0 transition-colors hover:bg-muted/30 ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                                  <td className="p-3">
                                    <p className="font-medium">{getPaymentDueTitle(d)}</p>
                                    {getPaymentDueSubtitle(d) && (
                                      <p className="mt-0.5 text-xs text-muted-foreground">{getPaymentDueSubtitle(d)}</p>
                                    )}
                                  </td>
                                  <td className="p-3 text-right tabular-nums">{Number(d.amountDue).toFixed(2)}</td>
                                  <td className="p-3 text-right tabular-nums">{Number(d.amountPaid).toFixed(2)}</td>
                                  <td className="p-3 text-center">
                                    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border ${statusColors[d.status] ?? ""}`}>
                                      <StatusIcon className="h-3 w-3" />
                                      {d.status}
                                    </span>
                                  </td>
                                  <td className="p-3 text-right print:hidden">
                                    <div className="flex items-center justify-end gap-1">
                                      {d.status !== "paid" && remaining > 0 && (
                                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => openPayDialog(d)}>
                                          <DollarSign className="h-3 w-3" />
                                          Pay
                                        </Button>
                                      )}
                                      {canManage && d.status !== "paid" && (
                                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditDueTarget(d); setEditDueAmount(String(Number(d.amountDue))); setEditDueReason(""); }} title="Edit Due">
                                          <Pencil className="h-3 w-3" />
                                        </Button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-10">
                      <Receipt className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No dues generated yet.</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Transaction History */}
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-5 w-5 text-primary" />
                  Transaction History
                </CardTitle>
              </CardHeader>
              <CardContent>
                {statementLoading ? (
                  <p className="text-sm text-muted-foreground">Loading statement…</p>
                ) : visibleStatementItems.length === 0 ? (
                  <div className="text-center py-10">
                    <CreditCard className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">
                      No transactions recorded yet.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-3 md:hidden print:hidden">
                      {visibleStatementItems.map((entry) => {
                        const signedAmount = entry.debit - entry.credit;
                        const amountTone =
                          signedAmount > 0
                            ? "text-red-600"
                            : signedAmount < 0
                              ? "text-emerald-600"
                              : "text-muted-foreground";
                        return (
                        <div
                          key={entry.id}
                          className="rounded-md border bg-card p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-medium">{entry.description}</p>
                              {entry.reference && (
                                <p className="mt-0.5 text-xs text-muted-foreground">{entry.reference}</p>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {new Date(entry.occurredAt).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                            <div>
                              <p className="text-muted-foreground">Amount</p>
                              <p className={`font-medium tabular-nums ${amountTone}`}>
                                {signedAmount > 0 ? "+" : signedAmount < 0 ? "" : ""}
                                {signedAmount !== 0 ? signedAmount.toFixed(2) : "0.00"}
                              </p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Balance</p>
                              <p className="font-medium tabular-nums">{entry.balance.toFixed(2)}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">By</p>
                              <p className="font-medium">{entry.actor || "System"}</p>
                            </div>
                            <div className="col-span-2">
                              <p className="text-muted-foreground">Note</p>
                              <p className="font-medium">{entry.note || "—"}</p>
                            </div>
                          </div>
                          <div className="mt-3 flex gap-2">
                            {entry.receiptAvailable && entry.paymentId && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={loadingReceiptPaymentId === entry.paymentId}
                                onClick={() => openReceiptForPayment(entry.paymentId!)}
                              >
                                {loadingReceiptPaymentId === entry.paymentId ? "Loading…" : "View Receipt"}
                              </Button>
                            )}
                            {canManage && entry.reversible && entry.paymentId && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-red-600"
                                onClick={() => {
                                  setReverseTarget({
                                    id: entry.paymentId!,
                                    amount: entry.credit,
                                    paymentDue: entry.reference ? { period: entry.reference } : undefined,
                                  } as Payment);
                                  setReverseReason("");
                                }}
                              >
                                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                                Reverse
                              </Button>
                            )}
                          </div>
                        </div>
                      )})}
                    </div>

                    <div className="hidden md:block print:block rounded-lg border overflow-x-auto">
                      <table className="w-full text-sm min-w-[860px]">
                        <thead>
                          <tr className="bg-muted/50 border-b">
                            <th className="text-left p-3 font-medium text-muted-foreground">
                              Date
                            </th>
                            <th className="text-left p-3 font-medium text-muted-foreground">
                              Description
                            </th>
                            <th className="text-left p-3 font-medium text-muted-foreground">
                              Note
                            </th>
                            <th className="text-right p-3 font-medium text-muted-foreground">
                              Amount
                            </th>
                            <th className="text-right p-3 font-medium text-muted-foreground">Balance</th>
                            <th className="text-left p-3 font-medium text-muted-foreground">By</th>
                            <th className="text-right p-3 font-medium text-muted-foreground"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleStatementItems.map((entry, i) => (
                            <tr
                              key={entry.id}
                              className={`border-b last:border-0 transition-colors hover:bg-muted/30 ${
                                i % 2 === 0 ? "" : "bg-muted/10"
                              }`}
                            >
                              <td className="p-3">
                                {new Date(entry.occurredAt).toLocaleDateString()}
                              </td>
                              <td className="p-3">
                                <div className="font-medium">{entry.description}</div>
                                {entry.reference ? (
                                  <div className="mt-0.5 text-xs text-muted-foreground">{entry.reference}</div>
                                ) : null}
                              </td>
                              <td className="p-3 text-muted-foreground max-w-[260px] truncate">
                                {entry.note || "—"}
                              </td>
                              <td
                                className={`p-3 text-right tabular-nums font-semibold ${
                                  entry.debit - entry.credit > 0
                                    ? "text-red-600"
                                    : entry.debit - entry.credit < 0
                                      ? "text-emerald-600"
                                      : "text-muted-foreground"
                                }`}
                              >
                                {entry.debit - entry.credit > 0 ? "+" : entry.debit - entry.credit < 0 ? "" : ""}
                                {(entry.debit - entry.credit).toFixed(2)}
                              </td>
                              <td className="p-3 text-right tabular-nums font-semibold">{entry.balance.toFixed(2)}</td>
                              <td className="p-3 text-muted-foreground">{entry.actor || "System"}</td>
                              <td className="p-3 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  {entry.receiptAvailable && entry.paymentId && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={loadingReceiptPaymentId === entry.paymentId}
                                      onClick={() => openReceiptForPayment(entry.paymentId!)}
                                    >
                                      {loadingReceiptPaymentId === entry.paymentId ? "Loading…" : "Receipt"}
                                    </Button>
                                  )}
                                  {canManage && entry.reversible && entry.paymentId && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-red-600 h-8 w-8 p-0"
                                      onClick={() => {
                                        setReverseTarget({
                                          id: entry.paymentId!,
                                          amount: entry.credit,
                                          paymentDue: entry.reference ? { period: entry.reference } : undefined,
                                        } as Payment);
                                        setReverseReason("");
                                      }}
                                      title="Reverse Payment"
                                    >
                                      <RotateCcw className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex items-center justify-between text-sm text-muted-foreground mt-4 pt-4 border-t print:hidden">
                      <span className="font-medium">
                        {visibleStatementItems.length} transaction{visibleStatementItems.length !== 1 ? "s" : ""}
                      </span>
                      <span>Oldest to newest</span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            </div>
          </TabsContent>

          <TabsContent value="activity" forceMount className="data-[state=inactive]:hidden print:hidden">
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <MessageSquareText className="h-5 w-5 text-primary" />
                  Activity Feed
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ActivityFeedPanel
                  resourcePath={`/memberships/${id}/feed`}
                  placeholder="Write a remark for this membership..."
                  emptyMessage="No remarks or activity recorded yet."
                />
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
                                  {creditEntryLabel(entry)}
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

      <RecordPaymentDialog
        open={payDialogOpen}
        onOpenChange={setPayDialogOpen}
        due={payDue}
        amount={payAmount}
        onAmountChange={setPayAmount}
        paymentMethod={payMethod}
        onPaymentMethodChange={setPayMethod}
        note={payNote}
        onNoteChange={setPayNote}
        error={payError}
        submitting={paySubmitting}
        onSubmit={handleRecordPayment}
        memberName={membership?.hod?.fullName || membership?.hod?.nameWithInitials || ""}
        membershipNo={membership?.membershipNo || ""}
        title="Record Payment"
        submitLabel="Record Payment"
        submittingLabel="Recording…"
        cancelLabel="Cancel"
      />

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

      <PaymentReceiptDialog
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
        receipt={receiptData}
      />

      <AlertDialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Archive Membership
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to archive this membership? It will be hidden from all lists until restored.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700"
              onClick={() => {
                doArchive(true);
                setArchiveConfirmOpen(false);
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reverse Payment Dialog */}
      <Dialog open={!!reverseTarget} onOpenChange={(open) => !open && setReverseTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Reverse Payment
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-muted/50 border p-4 space-y-1">
              <p className="text-sm">
                Period: <strong>{reverseTarget?.paymentDue?.period ?? "—"}</strong> ·
                Amount: <strong>{reverseTarget ? Number(reverseTarget.amount).toFixed(2) : ""}</strong>
              </p>
            </div>
            <div className="space-y-2">
              <Label>Reason for reversal *</Label>
              <Input
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                placeholder="e.g. Wrong member, duplicate entry..."
              />
            </div>
            <p className="text-xs text-muted-foreground">This action is recorded in the audit trail and cannot be undone.</p>
            <div className="flex gap-2">
              <Button variant="destructive" onClick={handleReversePayment} disabled={reverseSubmitting || !reverseReason.trim()} className="flex-1">
                {reverseSubmitting ? "Reversing…" : "Confirm Reversal"}
              </Button>
              <Button variant="outline" onClick={() => setReverseTarget(null)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Due Dialog */}
      <Dialog open={!!editDueTarget} onOpenChange={(open) => !open && setEditDueTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-primary" />
              Edit Due Amount
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-muted/50 border p-4 space-y-1">
              <p className="text-sm">
                Period: <strong>{editDueTarget?.period}</strong> ·
                Current Due: <strong>{editDueTarget ? Number(editDueTarget.amountDue).toFixed(2) : ""}</strong> ·
                Paid: <strong>{editDueTarget ? Number(editDueTarget.amountPaid).toFixed(2) : ""}</strong>
              </p>
            </div>
            <div className="space-y-2">
              <Label>New Due Amount *</Label>
              <Input type="number" min={0} step="0.01" value={editDueAmount} onChange={(e) => setEditDueAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Reason for change *</Label>
              <Input value={editDueReason} onChange={(e) => setEditDueReason(e.target.value)} placeholder="e.g. Fee adjustment..." />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleEditDue} disabled={editDueSubmitting || !editDueReason.trim() || !editDueAmount} className="flex-1">
                {editDueSubmitting ? "Saving…" : "Update Due"}
              </Button>
              <Button variant="outline" onClick={() => setEditDueTarget(null)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={manualDueOpen}
        onOpenChange={(open) => {
          setManualDueOpen(open);
          if (!open) resetManualDueForm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              Create Manual Due
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/50 p-4 space-y-1">
              <p className="text-sm font-semibold">
                {membership?.hod?.fullName ?? membership?.membershipNo ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {membership?.membershipNo ?? ""}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Due Amount *</Label>
              <Input
                type="number"
                min={0.01}
                step="0.01"
                value={manualDueAmount}
                onChange={(e) => setManualDueAmount(e.target.value)}
                placeholder="e.g. 500.00"
              />
            </div>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Textarea
                value={manualDueReason}
                onChange={(e) => setManualDueReason(e.target.value)}
                placeholder="e.g. Registration fee, Reference letter fee..."
                rows={3}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Period From</Label>
                <Input type="date" value={manualDueFrom} onChange={(e) => setManualDueFrom(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Period To</Label>
                <Input type="date" value={manualDueTo} onChange={(e) => setManualDueTo(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCreateManualDue} disabled={manualDueSubmitting} className="flex-1">
                {manualDueSubmitting ? "Creating…" : "Create Due"}
              </Button>
              <Button variant="outline" onClick={() => setManualDueOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
