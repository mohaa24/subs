"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  FileCheck2,
  History,
  Landmark,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
} from "lucide-react";
import { AbstractBg } from "@/components/abstract-bg";
import { Breadcrumb } from "@/components/breadcrumb";
import { Header } from "@/components/header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { api, type AccountingAccountType, type AccountingAssetSubtype, type Organization } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type MigrationKind = "original" | "correction" | "replacement";
type MigrationStatus = "draft" | "posted" | "reversed";

type MigrationLine = {
  id?: string;
  accountId: string;
  accountName: string;
  accountType: AccountingAccountType;
  accountSubtype: AccountingAssetSubtype;
  systemKey?: string | null;
  currentBalance: number;
  verifiedBalance: number;
  adjustmentDebit: number;
  adjustmentCredit: number;
  isSystemCalculated: boolean;
  inputLocked: boolean;
  lockReason?: string | null;
};

type Migration = {
  id: string;
  organizationId: string;
  cutoffDate: string;
  firstLiveDate: string;
  description: string;
  kind: MigrationKind;
  status: MigrationStatus;
  parentMigrationId?: string | null;
  correctionReason?: string | null;
  reversalReason?: string | null;
  postedAt?: string | null;
  reversedAt?: string | null;
  organization: { id: string; name: string; slug: string };
  lines: MigrationLine[];
  totals: { debit: number; credit: number };
};

type SetupPayload = {
  organization: { id: string; name: string; slug: string };
  cutoffDate: string;
  firstLiveDate: string;
  lines: MigrationLine[];
  totals: { debit: number; credit: number };
  migrations: Migration[];
};

function yesterday() {
  const value = new Date();
  value.setDate(value.getDate() - 1);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDay(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function money(value: number) {
  const absolute = Math.abs(value);
  const formatted = new Intl.NumberFormat("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(absolute);
  return value < 0 ? `(Rs. ${formatted})` : `Rs. ${formatted}`;
}

function rounded(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function kindLabel(kind: MigrationKind) {
  if (kind === "correction") return "Correction";
  if (kind === "replacement") return "Replacement";
  return "Original migration";
}

function categoryLabel(line: MigrationLine) {
  if (line.accountSubtype === "cash" || line.accountSubtype === "bank") return "Cash and bank accounts";
  if (line.accountType === "asset") return "Receivables and other assets";
  if (line.accountType === "liability") return "Payables and other liabilities";
  return "General and project funds";
}

function calculatePreview(lines: MigrationLine[], inputs: Record<string, string>) {
  let debit = 0;
  let credit = 0;
  const calculated = lines.filter((line) => !line.isSystemCalculated).map((line) => {
    const parsed = Number(inputs[line.accountId]);
    const verifiedBalance = line.inputLocked || !Number.isFinite(parsed) ? line.currentBalance : rounded(parsed);
    const difference = rounded(verifiedBalance - line.currentBalance);
    const normalDebit = line.accountType === "asset";
    const adjustmentDebit = difference === 0 ? 0 : difference > 0 === normalDebit ? Math.abs(difference) : 0;
    const adjustmentCredit = difference === 0 ? 0 : difference > 0 !== normalDebit ? Math.abs(difference) : 0;
    debit += adjustmentDebit;
    credit += adjustmentCredit;
    return { ...line, verifiedBalance, adjustmentDebit: rounded(adjustmentDebit), adjustmentCredit: rounded(adjustmentCredit) };
  });
  const fund = lines.find((line) => line.isSystemCalculated);
  if (fund) {
    const adjustmentDebit = credit > debit ? rounded(credit - debit) : 0;
    const adjustmentCredit = debit > credit ? rounded(debit - credit) : 0;
    calculated.unshift({
      ...fund,
      verifiedBalance: rounded(fund.currentBalance + adjustmentCredit - adjustmentDebit),
      adjustmentDebit,
      adjustmentCredit,
    });
    debit += adjustmentDebit;
    credit += adjustmentCredit;
  }
  return { lines: calculated, totals: { debit: rounded(debit), credit: rounded(credit) } };
}

function StatusBadge({ status }: { status: MigrationStatus }) {
  const style = status === "posted"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : status === "reversed"
      ? "border-red-200 bg-red-50 text-red-700"
      : "border-slate-200 bg-slate-50 text-slate-700";
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${style}`}>{status}</span>;
}

export default function OpeningBalanceMigrationPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [cutoffDate, setCutoffDate] = useState(yesterday());
  const [description, setDescription] = useState("Verified historical closing balances before Civica live processing");
  const [setup, setSetup] = useState<SetupPayload | null>(null);
  const [activeMigration, setActiveMigration] = useState<Migration | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
    if (!authLoading && user && user.role !== "super_user") router.replace("/");
  }, [authLoading, router, user]);

  useEffect(() => {
    if (user?.role !== "super_user") return;
    api<Organization[]>("/organizations")
      .then((items) => {
        setOrganizations(items);
        setOrganizationId((current) => current || items[0]?.id || "");
      })
      .catch((error) => toast({ variant: "destructive", title: "Unable to load organisations", description: error instanceof Error ? error.message : "Please try again" }));
  }, [user]);

  const applyLines = useCallback((lines: MigrationLine[]) => {
    setInputs(Object.fromEntries(lines.map((line) => [line.accountId, line.verifiedBalance.toFixed(2)])));
  }, []);

  const loadSetup = useCallback(async (orgId: string, requestedCutoff = cutoffDate, preferMigrationId?: string) => {
    if (!orgId) return;
    setLoading(true);
    try {
      const payload = await api<SetupPayload>("/opening-balance-migrations/setup", {
        params: { organizationId: orgId, cutoffDate: requestedCutoff },
      });
      setSetup(payload);
      const preferred = preferMigrationId ? payload.migrations.find((item) => item.id === preferMigrationId) : null;
      const draft = payload.migrations.find((item) => item.status === "draft");
      const posted = payload.migrations.find((item) => item.status === "posted");
      const selected = preferred ?? draft ?? posted ?? null;
      setActiveMigration(selected);
      if (selected) {
        setCutoffDate(selected.cutoffDate);
        setDescription(selected.description);
        applyLines(selected.lines);
      } else {
        setCutoffDate(payload.cutoffDate);
        setDescription("Verified historical closing balances before Civica live processing");
        applyLines(payload.lines);
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Unable to load opening balances", description: error instanceof Error ? error.message : "Please try again" });
      setSetup(null);
    } finally {
      setLoading(false);
    }
  }, [applyLines, cutoffDate]);

  useEffect(() => {
    if (organizationId) void loadSetup(organizationId, cutoffDate);
    // The cut-off is edited locally and recalculated when the draft is saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const sourceLines = activeMigration?.lines ?? setup?.lines ?? [];
  const preview = useMemo(() => calculatePreview(sourceLines, inputs), [inputs, sourceLines]);
  const generalFund = preview.lines.find((line) => line.isSystemCalculated) ?? null;
  const accountLines = preview.lines.filter((line) => !line.isSystemCalculated);
  const groups = useMemo(() => {
    const grouped = new Map<string, MigrationLine[]>();
    for (const line of accountLines) {
      const category = categoryLabel(line);
      grouped.set(category, [...(grouped.get(category) ?? []), line]);
    }
    return Array.from(grouped.entries());
  }, [accountLines]);
  const isDraft = !activeMigration || activeMigration.status === "draft";
  const isBalanced = Math.abs(preview.totals.debit - preview.totals.credit) < 0.005;
  const nonZeroPreview = preview.lines.filter((line) => line.adjustmentDebit || line.adjustmentCredit);

  async function saveDraft() {
    if (!organizationId || !isDraft) return null;
    setSaving(true);
    try {
      const body = JSON.stringify({
        organizationId,
        cutoffDate,
        description,
        kind: activeMigration?.kind ?? "original",
        parentMigrationId: activeMigration?.parentMigrationId ?? null,
        correctionReason: activeMigration?.correctionReason ?? null,
        lines: preview.lines.filter((line) => !line.isSystemCalculated).map((line) => ({
          accountId: line.accountId,
          verifiedBalance: line.verifiedBalance,
        })),
      });
      const saved = activeMigration
        ? await api<Migration>(`/opening-balance-migrations/${activeMigration.id}`, { method: "PATCH", body })
        : await api<Migration>("/opening-balance-migrations", { method: "POST", body });
      setActiveMigration(saved);
      setCutoffDate(saved.cutoffDate);
      applyLines(saved.lines);
      setSetup((current) => current ? { ...current, migrations: [saved, ...current.migrations.filter((item) => item.id !== saved.id)] } : current);
      toast({ title: "Opening balance draft saved" });
      return saved;
    } catch (error) {
      toast({ variant: "destructive", title: "Unable to save draft", description: error instanceof Error ? error.message : "Please try again" });
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function postMigration() {
    if (!isBalanced || preview.totals.debit === 0) return;
    const saved = await saveDraft();
    if (!saved) return;
    const confirmed = window.confirm(`Post ${kindLabel(saved.kind).toLowerCase()} for ${saved.organization.name}?\n\nCut-off: ${saved.cutoffDate}\nDebits: ${money(saved.totals.debit)}\nCredits: ${money(saved.totals.credit)}\n\nPosted entries cannot be edited.`);
    if (!confirmed) return;
    setSaving(true);
    try {
      const posted = await api<Migration>(`/opening-balance-migrations/${saved.id}/post`, { method: "POST" });
      toast({ title: "Opening balances posted", description: "The balanced journal and audit record were created." });
      await loadSetup(organizationId, posted.cutoffDate, posted.id);
    } catch (error) {
      toast({ variant: "destructive", title: "Unable to post migration", description: error instanceof Error ? error.message : "Please refresh and try again" });
    } finally {
      setSaving(false);
    }
  }

  async function createCorrection() {
    const baseline = setup?.migrations.find((item) => item.status === "posted" && (item.kind === "original" || item.kind === "replacement"));
    if (!baseline) return;
    const reason = window.prompt("Why is an opening balance correction required?");
    if (!reason?.trim()) return;
    setSaving(true);
    try {
      const correction = await api<Migration>(`/opening-balance-migrations/${baseline.id}/corrections`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      await loadSetup(organizationId, correction.cutoffDate, correction.id);
      toast({ title: "Correction draft created" });
    } catch (error) {
      toast({ variant: "destructive", title: "Unable to create correction", description: error instanceof Error ? error.message : "Please try again" });
    } finally {
      setSaving(false);
    }
  }

  async function reverseMigration() {
    if (!activeMigration || activeMigration.status !== "posted") return;
    const reason = window.prompt("Enter the reason for reversing this posted migration:");
    if (!reason?.trim()) return;
    const replace = activeMigration.kind === "original" || activeMigration.kind === "replacement";
    if (!window.confirm(`${replace ? "Reverse this baseline and create a replacement draft" : "Reverse this correction"}? The original journal will remain in the audit trail.`)) return;
    setSaving(true);
    try {
      const result = await api<{ migration: Migration; replacement: Migration | null }>(`/opening-balance-migrations/${activeMigration.id}/reverse`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim(), createReplacement: replace }),
      });
      await loadSetup(organizationId, result.replacement?.cutoffDate ?? cutoffDate, result.replacement?.id ?? result.migration.id);
      toast({ title: result.replacement ? "Migration reversed; replacement draft created" : "Correction reversed" });
    } catch (error) {
      toast({ variant: "destructive", title: "Unable to reverse migration", description: error instanceof Error ? error.message : "Please try again" });
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || !user || user.role !== "super_user") return null;

  return (
    <div className="relative min-h-screen bg-background">
      <AbstractBg />
      <Header />
      <main className="relative z-10 mx-auto max-w-[1500px] space-y-5 p-4 md:p-6">
        <Breadcrumb items={[{ label: "Dashboard", href: "/" }, { label: "Financial Setup", href: "/settings/financial-setup" }, { label: "Opening Balance Migration" }]} />

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">Opening Balance Migration</h1>
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800"><ShieldCheck className="h-3.5 w-3.5" /> Super User Only</span>
              {activeMigration ? <StatusBadge status={activeMigration.status} /> : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Record verified balances that existed before the first live reporting period.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isDraft ? <Button variant="outline" onClick={() => void saveDraft()} disabled={saving || loading}><Save className="mr-2 h-4 w-4" />Save Draft</Button> : null}
            {isDraft ? <Button onClick={() => void postMigration()} disabled={saving || loading || !isBalanced || preview.totals.debit === 0}><FileCheck2 className="mr-2 h-4 w-4" />Review &amp; Post</Button> : null}
            {!isDraft && activeMigration?.status === "posted" ? <Button variant="outline" onClick={() => void createCorrection()} disabled={saving}><RefreshCw className="mr-2 h-4 w-4" />Create Correction</Button> : null}
            {!isDraft && activeMigration?.status === "posted" ? <Button variant="outline" className="border-red-200 text-red-700 hover:bg-red-50" onClick={() => void reverseMigration()} disabled={saving}><RotateCcw className="mr-2 h-4 w-4" />{activeMigration.kind === "correction" ? "Reverse Correction" : "Reverse & Replace"}</Button> : null}
          </div>
        </div>

        <Card>
          <CardHeader className="border-b pb-4"><CardTitle className="text-base">Migration details</CardTitle></CardHeader>
          <CardContent className="grid gap-4 pt-5 md:grid-cols-[minmax(220px,1fr)_220px_220px]">
            <div className="space-y-2"><Label>Organisation</Label><Select value={organizationId} onValueChange={setOrganizationId} disabled={saving}><SelectTrigger><SelectValue placeholder="Select organisation" /></SelectTrigger><SelectContent>{organizations.map((org) => <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Migration cut-off date</Label><Input type="date" value={cutoffDate} max={yesterday()} onChange={(event) => setCutoffDate(event.target.value)} disabled={!isDraft || saving} /></div>
            <div className="space-y-2"><Label>First live transaction date</Label><Input value={addDay(cutoffDate)} disabled /></div>
            <div className="space-y-2 md:col-span-3"><Label>Description</Label><Textarea value={description} onChange={(event) => setDescription(event.target.value)} disabled={!isDraft || saving} rows={2} /></div>
            {activeMigration?.correctionReason ? <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 md:col-span-3"><strong>{kindLabel(activeMigration.kind)} reason:</strong> {activeMigration.correctionReason}</div> : null}
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 md:col-span-3">Balances are posted to the Balance Sheet and General Ledger only. Opening entries are excluded from Income, Expenses, Money Received and Money Paid.</div>
          </CardContent>
        </Card>

        {loading ? <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">Loading account balances…</CardContent></Card> : null}

        {!loading && generalFund ? (
          <Card className="border-emerald-300 bg-emerald-50/60 shadow-sm">
            <CardContent className="grid gap-4 p-5 md:grid-cols-[1.4fr_repeat(3,minmax(140px,1fr))] md:items-center">
              <div><div className="flex items-center gap-2 font-semibold text-emerald-950"><Landmark className="h-5 w-5 text-emerald-700" />General Fund – System Calculated <LockKeyhole className="h-3.5 w-3.5 text-emerald-700" /></div><p className="mt-1 text-xs text-emerald-800">The automatic balancing entry. It updates live as verified balances change.</p></div>
              <div><div className="text-xs font-medium uppercase tracking-wide text-emerald-700">Current at cut-off</div><div className="mt-1 font-semibold tabular-nums">{money(generalFund.currentBalance)}</div></div>
              <div><div className="text-xs font-medium uppercase tracking-wide text-emerald-700">Calculated closing balance</div><div className="mt-1 text-lg font-bold tabular-nums text-emerald-900">{money(generalFund.verifiedBalance)}</div></div>
              <div><div className="text-xs font-medium uppercase tracking-wide text-emerald-700">Balancing adjustment</div><div className="mt-1 font-semibold tabular-nums">{generalFund.adjustmentDebit ? `DR ${money(generalFund.adjustmentDebit)}` : generalFund.adjustmentCredit ? `CR ${money(generalFund.adjustmentCredit)}` : "—"}</div></div>
            </CardContent>
          </Card>
        ) : null}

        {!loading && sourceLines.length ? (
          <Card>
            <CardHeader className="border-b pb-4"><CardTitle className="text-base">Opening balance entries</CardTitle><p className="text-sm text-muted-foreground">Enter each verified closing balance. Civica calculates the adjustment from the account balance at the cut-off date.</p></CardHeader>
            <CardContent className="p-0">
              {groups.map(([group, lines]) => (
                <div key={group}>
                  <div className="border-b bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700">{group}</div>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full min-w-[920px] text-sm"><thead className="border-b bg-muted/20 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Account</th><th className="px-4 py-3 font-medium">Type</th><th className="px-4 py-3 text-right font-medium">Current system balance</th><th className="px-4 py-3 text-right font-medium">Verified closing balance</th><th className="px-4 py-3 text-right font-medium">Adjustment debit</th><th className="px-4 py-3 text-right font-medium">Adjustment credit</th></tr></thead><tbody className="divide-y">{lines.map((line) => <tr key={line.accountId} className="hover:bg-muted/10"><td className="px-4 py-3"><div className="font-medium">{line.accountName}</div>{line.lockReason ? <div className="mt-1 max-w-md text-xs text-amber-700">{line.lockReason}</div> : null}</td><td className="px-4 py-3 capitalize text-muted-foreground">{line.accountSubtype.replace(/_/g, " ")}</td><td className={`px-4 py-3 text-right tabular-nums ${line.currentBalance < 0 ? "text-red-700" : ""}`}>{money(line.currentBalance)}</td><td className="px-4 py-2"><Input type="number" step="0.01" className="ml-auto w-44 text-right tabular-nums" value={inputs[line.accountId] ?? ""} onChange={(event) => setInputs((current) => ({ ...current, [line.accountId]: event.target.value }))} disabled={!isDraft || line.inputLocked || saving} /></td><td className="px-4 py-3 text-right font-medium tabular-nums text-emerald-700">{line.adjustmentDebit ? money(line.adjustmentDebit) : "—"}</td><td className="px-4 py-3 text-right font-medium tabular-nums text-sky-700">{line.adjustmentCredit ? money(line.adjustmentCredit) : "—"}</td></tr>)}</tbody></table>
                  </div>
                  <div className="divide-y md:hidden">{lines.map((line) => <div key={line.accountId} className="space-y-3 p-4"><div><div className="font-medium">{line.accountName}</div><div className="text-xs capitalize text-muted-foreground">{line.accountSubtype.replace(/_/g, " ")}</div>{line.lockReason ? <div className="mt-1 text-xs text-amber-700">{line.lockReason}</div> : null}</div><div className="grid grid-cols-2 gap-3 text-sm"><div><div className="text-xs text-muted-foreground">Current balance</div><div className="mt-1 tabular-nums">{money(line.currentBalance)}</div></div><div><Label className="text-xs">Verified balance</Label><Input type="number" step="0.01" className="mt-1 text-right tabular-nums" value={inputs[line.accountId] ?? ""} onChange={(event) => setInputs((current) => ({ ...current, [line.accountId]: event.target.value }))} disabled={!isDraft || line.inputLocked || saving} /></div></div><div className="flex justify-between rounded-md bg-muted/30 px-3 py-2 text-sm"><span className="text-muted-foreground">Calculated adjustment</span><strong className={line.adjustmentDebit ? "text-emerald-700" : "text-sky-700"}>{line.adjustmentDebit ? `DR ${money(line.adjustmentDebit)}` : line.adjustmentCredit ? `CR ${money(line.adjustmentCredit)}` : "—"}</strong></div></div>)}</div>
                </div>
              ))}
              <div className="grid gap-3 border-t bg-slate-50 p-4 text-sm md:grid-cols-[1fr_220px_220px] md:items-center"><div className="font-semibold md:text-right">Total adjustments</div><div className="flex justify-between rounded-md bg-white px-3 py-2 md:block md:text-right"><span className="md:hidden">Debit</span><strong className="tabular-nums text-emerald-700">{money(preview.totals.debit)}</strong></div><div className="flex justify-between rounded-md bg-white px-3 py-2 md:block md:text-right"><span className="md:hidden">Credit</span><strong className="tabular-nums text-sky-700">{money(preview.totals.credit)}</strong></div></div>
            </CardContent>
          </Card>
        ) : null}

        {!loading && sourceLines.length ? (
          <Card>
            <CardHeader className="border-b pb-4"><div className="flex items-center justify-between gap-3"><CardTitle className="text-base">Double-entry preview</CardTitle><span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${isBalanced ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>{isBalanced ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}{isBalanced ? "Balanced" : "Not balanced"}</span></div></CardHeader>
            <CardContent className="p-0"><div className="divide-y">{nonZeroPreview.length ? nonZeroPreview.map((line) => <div key={line.accountId} className="grid grid-cols-[32px_1fr_auto] items-center gap-2 px-4 py-3 text-sm"><span className={`flex h-7 w-7 items-center justify-center rounded-full ${line.adjustmentDebit ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"}`}>{line.adjustmentDebit ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}</span><div><span className="mr-2 font-semibold">{line.adjustmentDebit ? "DR" : "CR"}</span>{line.accountName}</div><strong className="tabular-nums">{money(line.adjustmentDebit || line.adjustmentCredit)}</strong></div>) : <div className="p-6 text-center text-sm text-muted-foreground">No adjustments entered yet.</div>}</div></CardContent>
          </Card>
        ) : null}

        {setup?.migrations.length ? (
          <Card>
            <CardHeader className="border-b pb-4"><CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4" />Migration history</CardTitle></CardHeader>
            <CardContent className="p-0"><div className="divide-y">{setup.migrations.map((migration) => <button type="button" key={migration.id} onClick={() => { setActiveMigration(migration); setCutoffDate(migration.cutoffDate); setDescription(migration.description); applyLines(migration.lines); }} className={`grid w-full gap-2 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/30 md:grid-cols-[1fr_160px_140px_140px] md:items-center ${activeMigration?.id === migration.id ? "bg-primary/5" : ""}`}><div><div className="font-medium">{kindLabel(migration.kind)}</div><div className="text-xs text-muted-foreground">{migration.description}</div></div><div><div className="text-xs text-muted-foreground">Cut-off</div><div>{migration.cutoffDate}</div></div><div><StatusBadge status={migration.status} /></div><div className="text-right font-medium tabular-nums">{money(migration.totals.debit)}</div></button>)}</div></CardContent>
          </Card>
        ) : null}
      </main>
    </div>
  );
}
