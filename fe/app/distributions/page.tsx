"use client";

import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  api,
  type Distribution,
  type DistributionScanResult,
  type DistributionReport,
} from "@/lib/api";
import { Header } from "@/components/header";
import { AbstractBg } from "@/components/abstract-bg";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Package,
  Plus,
  QrCode,
  Check,
  X,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Edit,
  CheckCircle2,
  Filter,
} from "lucide-react";
import { Breadcrumb } from "@/components/breadcrumb";
import { dashboardFlowHref } from "@/lib/dashboard-flows";

type Freq = "Once" | "Daily" | "Monthly" | "Yearly";

interface DistributionDetail extends Distribution {
  totalEligible: number;
  totalDistributed: number;
  currentCycleDate: string;
}

interface DistributionRecord {
  id: string;
  personId: string;
  personName: string;
  distributedAt: string;
  distributionDate: string;
}

type FilterAttrType = "boolean" | "number" | "select";

interface FilterAttrDef {
  key: string;
  label: string;
  type: FilterAttrType;
  options?: { value: string; label: string }[];
}

const AVAILABLE_FILTERS: FilterAttrDef[] = [
  { key: "isDisabled", label: "Is Disabled", type: "boolean" },
  { key: "isMadarasaStudent", label: "Madarasa Student", type: "boolean" },
  { key: "minAge", label: "Minimum Age", type: "number" },
  { key: "maxAge", label: "Maximum Age", type: "number" },
  {
    key: "membershipType",
    label: "Membership Type",
    type: "select",
    options: [
      { value: "Resident", label: "Resident" },
      { value: "NonResident", label: "Non-Resident" },
      { value: "Widow", label: "Widow" },
      { value: "Widower", label: "Widower" },
    ],
  },
  { key: "gender", label: "Gender", type: "select", options: [{ value: "Male", label: "Male" }, { value: "Female", label: "Female" }] },
  {
    key: "maritalStatus",
    label: "Marital Status",
    type: "select",
    options: [
      { value: "Single", label: "Single" },
      { value: "Married", label: "Married" },
      { value: "Widowed", label: "Widowed" },
      { value: "Divorced", label: "Divorced" },
    ],
  },
  {
    key: "residentType",
    label: "Resident Type",
    type: "select",
    options: [
      { value: "Resident", label: "Resident" },
      { value: "NonResident", label: "Non-Resident" },
      { value: "Abroad", label: "Abroad" },
    ],
  },
];

interface ActiveFilter {
  key: string;
  value: string;
}

function filtersToJson(active: ActiveFilter[]): Record<string, unknown> | undefined {
  if (active.length === 0) return undefined;
  const obj: Record<string, unknown> = {};
  for (const f of active) {
    const def = AVAILABLE_FILTERS.find((d) => d.key === f.key);
    if (!def || !f.value.trim()) continue;
    if (def.type === "boolean") obj[f.key] = f.value === "true";
    else if (def.type === "number") obj[f.key] = Number(f.value);
    else obj[f.key] = f.value;
  }
  return Object.keys(obj).length > 0 ? obj : undefined;
}

function jsonToActiveFilters(j: Record<string, unknown> | null | undefined): ActiveFilter[] {
  if (!j) return [];
  const result: ActiveFilter[] = [];
  for (const [key, val] of Object.entries(j)) {
    if (AVAILABLE_FILTERS.some((d) => d.key === key)) {
      result.push({ key, value: String(val) });
    }
  }
  return result;
}

function extractPersonIdFromQr(decoded: string): string {
  const trimmed = decoded.trim();
  const m = trimmed.match(/\/(?:members|persons)\/([^/?]+)/);
  if (m) return m[1];
  try {
    const url = new URL(trimmed);
    const segs = url.pathname.split("/").filter(Boolean);
    if (segs.length > 0) return segs[segs.length - 1];
  } catch {}
  return trimmed;
}

export default function DistributionsPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const isAdmin = user?.role === "admin" || user?.role === "super_user";

  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DistributionDetail | null>(null);
  const [records, setRecords] = useState<DistributionRecord[]>([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordsPage, setRecordsPage] = useState(1);
  const recordsLimit = 20;

  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formFreq, setFormFreq] = useState<Freq>("Once");
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [scanOpen, setScanOpen] = useState(false);
  const [scanError, setScanError] = useState("");
  const [scanResult, setScanResult] = useState<DistributionScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const scannerRef = useRef<any>(null);
  const scannerContainerId = "dist-qr-reader";

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch {}
      try { scannerRef.current.clear?.(); } catch {}
      scannerRef.current = null;
    }
  }, []);

  const startScanner = useCallback(async (onScan: (id: string) => void) => {
    setScanError("");
    await stopScanner();
    await new Promise((r) => setTimeout(r, 300));
    const { Html5Qrcode } = await import("html5-qrcode");
    const scanner = new Html5Qrcode(scannerContainerId);
    scannerRef.current = scanner;
    try {
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (text: string) => { const pid = extractPersonIdFromQr(text); if (pid) { stopScanner(); onScan(pid); } },
        () => {}
      );
    } catch (err) {
      setScanError(err instanceof Error ? err.message : t("distributions.couldNotStartCamera"));
    }
  }, [stopScanner, t]);

  useEffect(() => { if (!authLoading && !user) router.replace("/login"); }, [user, authLoading, router]);
  useEffect(() => { if (!scanOpen) stopScanner(); }, [scanOpen, stopScanner]);

  const loadDistributions = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const list = await api<Distribution[]>("/distributions");
      const reports = await Promise.all(
        list.map((d) => api<DistributionReport>(`/distributions/${d.id}/report`).catch(() => null))
      );
      setDistributions(list.map((d, i) => {
        const r = reports[i];
        return r ? { ...d, totalEligible: r.totalEligible, totalDistributed: r.totalDistributed } : d;
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [user, t]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const d = await api<DistributionDetail>(`/distributions/${id}`);
      setDetail(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.loadFailed"));
    } finally {
      setDetailLoading(false);
    }
  }, [t]);

  const loadRecords = useCallback(async (id: string, page: number) => {
    setRecordsLoading(true);
    try {
      const r = await api<{ items: DistributionRecord[]; total: number; page: number }>(`/distributions/${id}/records`, {
        params: { page: String(page), limit: String(recordsLimit) },
      });
      setRecords(r.items);
      setRecordsTotal(r.total);
      setRecordsPage(r.page);
    } catch {}
    setRecordsLoading(false);
  }, []);

  useEffect(() => { loadDistributions(); }, [loadDistributions]);
  useEffect(() => {
    if (selectedId) { loadDetail(selectedId); setRecordsPage(1); }
    else { setDetail(null); setRecords([]); setRecordsTotal(0); }
  }, [selectedId, loadDetail]);
  useEffect(() => { if (selectedId) loadRecords(selectedId, recordsPage); }, [selectedId, recordsPage, loadRecords]);

  function openCreate() {
    setEditMode(false);
    setFormName("");
    setFormDesc("");
    setFormFreq("Once");
    setActiveFilters([]);
    setFiltersOpen(false);
    setFormError("");
    setDialogOpen(true);
  }

  function openEdit(d: Distribution) {
    setEditMode(true);
    setFormName(d.name);
    setFormDesc(d.description ?? "");
    setFormFreq(d.frequency as Freq);
    const parsed = jsonToActiveFilters(d.filterCriteria as Record<string, unknown> | null);
    setActiveFilters(parsed);
    setFiltersOpen(parsed.length > 0);
    setFormError("");
    setDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formName.trim()) { setFormError(t("distributions.nameRequired")); return; }
    setFormError("");
    setSubmitting(true);
    try {
      const body: any = {
        name: formName.trim(),
        frequency: formFreq,
        isActive: true,
      };
      if (formDesc.trim()) body.description = formDesc.trim();
      const fc = filtersToJson(activeFilters);
      if (fc) body.filterCriteria = fc;

      if (editMode && selectedId) {
        await api(`/distributions/${selectedId}`, { method: "PATCH", body: JSON.stringify(body) });
        loadDetail(selectedId);
      } else {
        await api("/distributions", { method: "POST", body: JSON.stringify(body) });
      }
      setDialogOpen(false);
      loadDistributions();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("common.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    try {
      await api(`/distributions/${id}`, { method: "DELETE" });
      setDeleteConfirm(null);
      if (selectedId === id) { setSelectedId(null); setDetail(null); }
      loadDistributions();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  }

  async function handleComplete(id: string) {
    try {
      await api(`/distributions/${id}/complete`, { method: "POST" });
      loadDetail(id);
      loadDistributions();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.completeFailed"));
    }
  }

  async function handleScan(personId: string) {
    if (!selectedId) return;
    setScanning(true);
    setScanResult(null);
    setScanError("");
    try {
      const res = await api<DistributionScanResult>(`/distributions/${selectedId}/scan`, {
        method: "POST",
        body: JSON.stringify({ personId }),
      });
      setScanResult(res);
      if (res.success) { loadDetail(selectedId); loadRecords(selectedId, recordsPage); }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : t("common.scanFailed"));
    } finally {
      setScanning(false);
    }
  }

  function handleScanNext() {
    setScanResult(null);
    setScanError("");
    startScanner((pid) => handleScan(pid));
  }

  const totalPages = Math.ceil(recordsTotal / recordsLimit) || 1;

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background relative">
      <AbstractBg />
      <Header />
      <main className="relative z-10 p-6 max-w-6xl mx-auto">
        <Breadcrumb
          items={[
            { label: t("dashboard.title"), href: dashboardFlowHref("distributions") },
            ...(selectedId
              ? [{ label: t("distributions.title"), href: "/distributions" }, { label: detail?.name ?? t("distributions.detail") }]
              : [{ label: t("distributions.title") }]),
          ]}
        />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            {t("distributions.title")}
          </h1>
          <div className="flex gap-2">
            {selectedId && (
              <Button size="sm" variant="outline" onClick={() => setSelectedId(null)} className="gap-1.5">
                <ChevronLeft className="h-4 w-4" /> {t("common.back")}
              </Button>
            )}
            {!selectedId && isAdmin && (
              <Button size="sm" onClick={openCreate} className="gap-1.5">
                <Plus className="h-4 w-4" /> {t("distributions.createDistribution")}
              </Button>
            )}
          </div>
        </div>

        {error && <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>}

        {!selectedId ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {loading ? (
              <p className="text-sm text-muted-foreground col-span-full">{t("common.loading")}</p>
            ) : distributions.length === 0 ? (
              <p className="text-sm text-muted-foreground col-span-full">{t("distributions.noDistributions")}</p>
            ) : (
              distributions.map((d) => {
                const pct = d.totalEligible && d.totalEligible > 0
                  ? Math.round(((d.totalDistributed ?? 0) / d.totalEligible) * 100) : 0;
                return (
                  <Card key={d.id} className="hover:border-primary/40 transition-colors relative group">
                    <div className="cursor-pointer" onClick={() => setSelectedId(d.id)}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base font-medium flex items-center justify-between gap-2">
                          <span className="truncate">{d.name}</span>
                          <span className={`shrink-0 text-xs px-2 py-0.5 rounded ${d.isActive ? "bg-green-500/20 text-green-700" : "bg-muted text-muted-foreground"}`}>
                            {d.isActive ? t("common.active") : t("distributions.completed")}
                          </span>
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">{t(`distributions.${d.frequency.toLowerCase()}` as const)}</p>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-center gap-2 text-sm">
                          <BarChart3 className="h-4 w-4 text-primary" />
                          <span className="text-muted-foreground">
                            {d.totalEligible ?? "—"} {t("distributions.eligible")} · {d.totalDistributed ?? "—"} {t("distributions.distributed")}
                          </span>
                        </div>
                        {d.totalEligible != null && d.totalEligible > 0 && (
                          <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
                            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%` }} />
                          </div>
                        )}
                      </CardContent>
                    </div>
                    {isAdmin && (
                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          className="p-1.5 rounded-md hover:bg-accent" title={t("common.edit")}
                          onClick={(e) => { e.stopPropagation(); openEdit(d); }}
                        ><Edit className="h-3.5 w-3.5 text-muted-foreground" /></button>
                        <button
                          className="p-1.5 rounded-md hover:bg-destructive/10" title={t("common.delete")}
                          onClick={(e) => { e.stopPropagation(); setDeleteConfirm(d.id); }}
                        ><Trash2 className="h-3.5 w-3.5 text-destructive" /></button>
                      </div>
                    )}
                  </Card>
                );
              })
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {detailLoading ? (
              <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
            ) : detail ? (
              <>
                <Card>
                  <CardHeader>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">{detail.name}</CardTitle>
                        {detail.description && <p className="text-sm text-muted-foreground mt-1">{detail.description}</p>}
                        <p className="text-xs text-muted-foreground mt-1">
                          {t(`distributions.${detail.frequency.toLowerCase()}` as const)} · {t("distributions.cycle")}: {detail.currentCycleDate}
                        </p>
                      </div>
                      {isAdmin && (
                        <div className="flex gap-2 shrink-0">
                          <Button size="sm" variant="outline" onClick={() => openEdit(detail)} className="gap-1.5">
                            <Edit className="h-3.5 w-3.5" /> {t("common.edit")}
                          </Button>
                          {detail.isActive && (
                            <Button size="sm" variant="outline" onClick={() => handleComplete(detail.id)} className="gap-1.5">
                              <CheckCircle2 className="h-3.5 w-3.5" /> {t("distributions.complete")}
                            </Button>
                          )}
                          <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive"
                            onClick={() => setDeleteConfirm(detail.id)}>
                            <Trash2 className="h-3.5 w-3.5" /> {t("common.delete")}
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div><p className="text-xs text-muted-foreground">{t("distributions.eligible")}</p><p className="text-lg font-semibold">{detail.totalEligible}</p></div>
                      <div><p className="text-xs text-muted-foreground">{t("distributions.distributed")}</p><p className="text-lg font-semibold text-green-600">{detail.totalDistributed}</p></div>
                      <div><p className="text-xs text-muted-foreground">{t("distributions.pending")}</p><p className="text-lg font-semibold">{Math.max(0, detail.totalEligible - detail.totalDistributed)}</p></div>
                      <div><p className="text-xs text-muted-foreground">{t("distributions.progress")}</p><p className="text-lg font-semibold">{detail.totalEligible > 0 ? Math.round((detail.totalDistributed / detail.totalEligible) * 100) : 0}%</p></div>
                    </div>
                    {detail.isActive && (
                      <div className="mt-4">
                        <Button onClick={() => { setScanOpen(true); setScanResult(null); setScanError(""); startScanner((pid) => handleScan(pid)); }} className="gap-2">
                          <QrCode className="h-4 w-4" /> {t("distributions.scanQR")}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <BarChart3 className="h-4 w-4 text-primary" /> {t("distributions.records")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {recordsLoading ? (
                      <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
                    ) : records.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t("distributions.noRecords")}</p>
                    ) : (
                      <>
                        <div className="rounded-md border overflow-x-auto">
                          <table className="w-full text-sm min-w-[400px]">
                            <thead className="bg-muted/50">
                              <tr>
                                <th className="text-left p-3 font-medium">{t("distributions.person")}</th>
                                <th className="text-left p-3 font-medium">{t("distributions.distributedAt")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {records.map((r) => (
                                <tr key={r.id} className="border-t">
                                  <td className="p-3">{r.personName}</td>
                                  <td className="p-3 text-muted-foreground">{new Date(r.distributedAt).toLocaleString()}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="flex items-center justify-between text-sm text-muted-foreground mt-3">
                          <span>{recordsTotal} {recordsTotal === 1 ? t("distributions.record") : t("distributions.records")}</span>
                          <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" disabled={recordsPage <= 1} onClick={() => setRecordsPage((p) => p - 1)}>
                              <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <span>{t("distributions.page")} {recordsPage} {t("distributions.of")} {totalPages}</span>
                            <Button variant="outline" size="sm" disabled={recordsPage >= totalPages} onClick={() => setRecordsPage((p) => p + 1)}>
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              </>
            ) : null}
          </div>
        )}
      </main>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editMode ? t("distributions.editDistribution") : t("distributions.createDistribution")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium block mb-1">{t("distributions.name")}</label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} required disabled={submitting} />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">{t("distributions.descriptionOptional")}</label>
              <Input value={formDesc} onChange={(e) => setFormDesc(e.target.value)} disabled={submitting} />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">{t("distributions.frequency")}</label>
              <Select value={formFreq} onValueChange={(v) => setFormFreq(v as Freq)} disabled={submitting}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Once">{t("distributions.once")}</SelectItem>
                  <SelectItem value="Daily">{t("distributions.daily")}</SelectItem>
                  <SelectItem value="Monthly">{t("distributions.monthly")}</SelectItem>
                  <SelectItem value="Yearly">{t("distributions.yearly")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <button
                type="button"
                className="w-full flex items-center justify-between p-3 text-sm font-medium hover:bg-accent/50 transition-colors"
                onClick={() => setFiltersOpen((v) => !v)}
              >
                <span className="flex items-center gap-2">
                  <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                  {t("distributions.filterCriteria")} {activeFilters.length > 0 && <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">{activeFilters.length}</span>}
                </span>
                <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${filtersOpen ? "rotate-90" : ""}`} />
              </button>
              {filtersOpen && (
                <div className="p-3 pt-0 space-y-3 border-t">
                  <p className="text-xs text-muted-foreground">{t("distributions.leaveEmptyForAll")}</p>

                  {activeFilters.map((af, idx) => {
                    const def = AVAILABLE_FILTERS.find((d) => d.key === af.key);
                    if (!def) return null;
                    return (
                      <div key={`${af.key}-${idx}`} className="flex items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground w-28 shrink-0 truncate">{def.label}</span>
                        {def.type === "boolean" && (
                          <Select
                            value={af.value || "true"}
                            onValueChange={(v) => setActiveFilters((prev) => prev.map((f, i) => i === idx ? { ...f, value: v } : f))}
                          >
                            <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="true">{t("common.yes")}</SelectItem>
                              <SelectItem value="false">{t("common.no")}</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                        {def.type === "number" && (
                          <Input
                            type="number"
                            className="h-8 text-xs flex-1"
                            value={af.value}
                            onChange={(e) => setActiveFilters((prev) => prev.map((f, i) => i === idx ? { ...f, value: e.target.value } : f))}
                          />
                        )}
                        {def.type === "select" && def.options && (
                          <Select
                            value={af.value || def.options[0]?.value || ""}
                            onValueChange={(v) => setActiveFilters((prev) => prev.map((f, i) => i === idx ? { ...f, value: v } : f))}
                          >
                            <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {def.options.map((o) => (
                                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        <button
                          type="button"
                          className="p-1 rounded hover:bg-destructive/10 shrink-0"
                          onClick={() => setActiveFilters((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          <X className="h-3.5 w-3.5 text-destructive" />
                        </button>
                      </div>
                    );
                  })}

                  {(() => {
                    const usedKeys = new Set(activeFilters.map((f) => f.key));
                    const available = AVAILABLE_FILTERS.filter((d) => !usedKeys.has(d.key));
                    if (available.length === 0) return null;
                    return (
                      <Select
                        value="__pick__"
                        onValueChange={(key) => {
                          if (key === "__pick__") return;
                          const def = AVAILABLE_FILTERS.find((d) => d.key === key);
                          if (!def) return;
                          const defaultVal = def.type === "boolean" ? "true" : def.type === "select" ? (def.options?.[0]?.value ?? "") : "";
                          setActiveFilters((prev) => [...prev, { key, value: defaultVal }]);
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder={`+ ${t("common.add")} filter`} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__pick__" className="text-muted-foreground">+ {t("common.add")} filter</SelectItem>
                          {available.map((d) => (
                            <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    );
                  })()}
                </div>
              )}
            </div>

            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting}>{submitting ? t("common.saving") : editMode ? t("common.saveChanges") : t("common.create")}</Button>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>{t("common.cancel")}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t("distributions.deleteConfirm")}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{t("distributions.deleteConfirmMessage")}</p>
          <div className="flex gap-2 mt-4">
            <Button variant="destructive" disabled={deleting} onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>
              {deleting ? t("common.deleting") : t("distributions.yesDelete")}
            </Button>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>{t("common.cancel")}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* QR Scan Dialog */}
      <Dialog open={scanOpen} onOpenChange={(o) => { if (!o) { stopScanner(); setScanOpen(false); setScanResult(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("distributions.scanQR")}</DialogTitle></DialogHeader>
          <div className="flex flex-col items-center gap-4">
            {scanResult ? (
              <>
                {scanResult.success ? (
                  <div className="w-full p-6 rounded-lg bg-green-500 text-white flex flex-col items-center gap-3">
                    <Check className="h-12 w-12" />
                    <p className="text-lg font-semibold">{t("distributions.distributionComplete")}</p>
                    <p className="text-xl font-medium">{scanResult.person.name}</p>
                  </div>
                ) : (
                  <div className="w-full p-6 rounded-lg bg-red-500 text-white flex flex-col items-center gap-3">
                    <X className="h-12 w-12" />
                    <p className="text-lg font-semibold">{t("distributions.alreadyDistributed")}</p>
                    <p className="text-xl font-medium">{scanResult.person.name}</p>
                  </div>
                )}
                <Button onClick={handleScanNext} className="w-full">{t("distributions.scanNext")}</Button>
              </>
            ) : (
              <>
                <div id={scannerContainerId} className="w-full rounded-lg overflow-hidden min-h-[250px]" />
                {scanError && (
                  <div className="space-y-2 w-full">
                    <p className="text-sm text-destructive text-center">{scanError}</p>
                    <Button variant="outline" size="sm" onClick={handleScanNext} className="w-full">{t("distributions.tryAgain")}</Button>
                  </div>
                )}
                {scanning && !scanError && <p className="text-sm text-muted-foreground">{t("distributions.processing")}</p>}
                <p className="text-xs text-muted-foreground text-center">{t("distributions.pointCamera")}</p>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
