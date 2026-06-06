"use client";

import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  api,
  type Organization,
  type OrganizationBilling,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Header } from "@/components/header";
import { AbstractBg } from "@/components/abstract-bg";
import { Breadcrumb } from "@/components/breadcrumb";
import { dashboardFlowHref } from "@/lib/dashboard-flows";
import {
  Building2,
  Phone,
  MapPin,
  Calendar,
  DollarSign,
  Check,
  X,
  Edit,
} from "lucide-react";

export default function OrganizationDetailPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const [org, setOrg] = useState<Organization | null>(null);
  const [billing, setBilling] = useState<OrganizationBilling[]>([]);
  const [loading, setLoading] = useState(true);
  const [billingLoading, setBillingLoading] = useState(false);
  const [error, setError] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Organization>>({});
  const [saving, setSaving] = useState(false);
  const [toggleActiveLoading, setToggleActiveLoading] = useState(false);
  const [togglingBillingId, setTogglingBillingId] = useState<string | null>(null);

  const isSuperUser = user?.role === "super_user";
  const canView =
    isSuperUser || (user?.role === "admin" && user?.organizationId === id);
  const canEdit = canView;
  const canEditAll = isSuperUser;
  const canToggleActive = isSuperUser;
  const canToggleBilling = isSuperUser;

  const loadOrg = useCallback(async () => {
    if (!user || !id) return;
    try {
      setLoading(true);
      setError("");
      const data = await api<Organization>(`/organizations/${id}`);
      setOrg(data);
      setEditForm({
        name: data.name,
        slug: data.slug,
        logoUrl: data.logoUrl ?? "",
        contactPersonName: data.contactPersonName ?? "",
        contactPersonPhone: data.contactPersonPhone ?? "",
        whatsAppSenderNumber: data.whatsAppSenderNumber ?? "",
        address: data.address ?? "",
        joinDate: data.joinDate ?? "",
        defaultMembershipFee: data.defaultMembershipFee ?? 0,
        proRataMonthly: data.proRataMonthly ?? false,
        proRataQuarterly: data.proRataQuarterly ?? false,
        proRataYearly: data.proRataYearly ?? false,
        lateFeePercentage: data.lateFeePercentage ?? 5,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load organization");
      setOrg(null);
    } finally {
      setLoading(false);
    }
  }, [user, id]);

  const loadBilling = useCallback(async () => {
    if (!user || !id || !isSuperUser) return;
    try {
      setBillingLoading(true);
      const data = await api<OrganizationBilling[]>(`/organizations/${id}/billing`);
      setBilling(data);
    } catch {
      setBilling([]);
    } finally {
      setBillingLoading(false);
    }
  }, [user, id, isSuperUser]);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user && canView) loadOrg();
  }, [user, canView, loadOrg]);

  useEffect(() => {
    if (user && isSuperUser && id) loadBilling();
  }, [user, isSuperUser, id, loadBilling]);

  useEffect(() => {
    if (searchParams.get("edit") === "true" && org && !editMode) {
      setEditMode(true);
    }
  }, [searchParams, org, editMode]);

  useEffect(() => {
    if (org && !editMode) {
      setEditForm({
        name: org.name,
        slug: org.slug,
        logoUrl: org.logoUrl ?? "",
        contactPersonName: org.contactPersonName ?? "",
        contactPersonPhone: org.contactPersonPhone ?? "",
        whatsAppSenderNumber: org.whatsAppSenderNumber ?? "",
        address: org.address ?? "",
        joinDate: org.joinDate ?? "",
        defaultMembershipFee: org.defaultMembershipFee ?? 0,
        proRataMonthly: org.proRataMonthly ?? false,
        proRataQuarterly: org.proRataQuarterly ?? false,
        proRataYearly: org.proRataYearly ?? false,
        lateFeePercentage: org.lateFeePercentage ?? 5,
      });
    }
  }, [org, editMode]);

  async function handleLogoUpload(file: File) {
    setUploading(true);
    try {
      const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
      const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
      if (!cloudName || !uploadPreset) {
        setError("Cloudinary not configured. Set NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME and NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET.");
        return;
      }
      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", uploadPreset);
      formData.append("folder", `org-logos/${id}`);
      const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      setEditForm((f) => ({ ...f, logoUrl: data.secure_url }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload logo");
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (!org) return;
    setSaving(true);
    setError("");
    try {
      const body: Record<string, unknown> = {};
      if (canEditAll) {
        if (editForm.name !== undefined) body.name = editForm.name;
        if (editForm.slug !== undefined) body.slug = editForm.slug;
        if (editForm.logoUrl !== undefined)
          body.logoUrl = editForm.logoUrl || null;
        if (editForm.joinDate !== undefined)
          body.joinDate = editForm.joinDate || null;
      }
      if (editForm.defaultMembershipFee !== undefined)
        body.defaultMembershipFee = Number(editForm.defaultMembershipFee);
      if (editForm.contactPersonName !== undefined)
        body.contactPersonName = editForm.contactPersonName || null;
      if (editForm.contactPersonPhone !== undefined)
        body.contactPersonPhone = editForm.contactPersonPhone || null;
      if (editForm.whatsAppSenderNumber !== undefined)
        body.whatsAppSenderNumber = editForm.whatsAppSenderNumber || null;
      if (editForm.address !== undefined)
        body.address = editForm.address || null;
      if (editForm.proRataMonthly !== undefined)
        body.proRataMonthly = editForm.proRataMonthly;
      if (editForm.proRataQuarterly !== undefined)
        body.proRataQuarterly = editForm.proRataQuarterly;
      if (editForm.proRataYearly !== undefined)
        body.proRataYearly = editForm.proRataYearly;
      if (editForm.lateFeePercentage !== undefined)
        body.lateFeePercentage = Number(editForm.lateFeePercentage);

      const updated = await api<Organization>(`/organizations/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setOrg(updated);
      setEditMode(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive() {
    if (!org || !canToggleActive) return;
    setToggleActiveLoading(true);
    setError("");
    try {
      const updated = await api<Organization>(`/organizations/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !org.isActive }),
      });
      setOrg(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle status");
    } finally {
      setToggleActiveLoading(false);
    }
  }

  async function handleToggleBilling(billingId: string) {
    if (!canToggleBilling) return;
    setTogglingBillingId(billingId);
    try {
      const updated = await api<OrganizationBilling>(
        `/organizations/${id}/billing/${billingId}`,
        { method: "PATCH" }
      );
      setBilling((prev) =>
        prev.map((b) => (b.id === billingId ? updated : b))
      );
    } catch {
      // Silently fail or could set error
    } finally {
      setTogglingBillingId(null);
    }
  }

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  if (!canView) {
    router.replace("/");
    return null;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background relative">
        <AbstractBg />
        <Header />
        <main className="relative z-10 p-6 max-w-5xl mx-auto">
          <Breadcrumb
            items={[
              { label: t("dashboard.title"), href: dashboardFlowHref("admin") },
              { label: t("organizations.title"), href: "/organizations" },
              { label: "…" },
            ]}
          />
          <div className="animate-pulse space-y-6 mt-4">
            <div className="h-8 w-64 bg-muted rounded" />
            <div className="h-48 bg-muted rounded-xl" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="h-24 bg-muted rounded-xl" />
              <div className="h-24 bg-muted rounded-xl" />
              <div className="h-24 bg-muted rounded-xl" />
              <div className="h-24 bg-muted rounded-xl" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!org) {
    return (
      <div className="min-h-screen bg-background relative">
        <AbstractBg />
        <Header />
        <main className="relative z-10 p-6 max-w-5xl mx-auto">
          <Breadcrumb
            items={[
              { label: t("dashboard.title"), href: dashboardFlowHref("admin") },
              { label: t("organizations.title"), href: "/organizations" },
            ]}
          />
          <div className="flex flex-col items-center justify-center py-20">
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <Building2 className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-semibold mb-1">{t("organizations.notFound")}</h2>
            <p className="text-sm text-muted-foreground mb-4">
              {error || t("organizations.notFoundHint")}
            </p>
            <Link href="/organizations">
              <Button variant="outline">{t("organizations.backToList")}</Button>
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background relative">
      <AbstractBg />
      <Header />
      <main className="relative z-10 p-6 max-w-5xl mx-auto">
        <Breadcrumb
          items={[
            { label: t("dashboard.title"), href: dashboardFlowHref("admin") },
            { label: t("organizations.title"), href: "/organizations" },
            { label: org.name },
          ]}
        />

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mt-4">
          <h1 className="text-xl font-semibold text-foreground">{org.name}</h1>
          <div className="flex flex-wrap gap-2">
            {canToggleActive && (
              <Button
                variant={org.isActive ? "destructive" : "default"}
                size="sm"
                onClick={handleToggleActive}
                disabled={toggleActiveLoading}
                className="gap-1.5"
              >
                {org.isActive ? (
                  <>
                    <X className="h-4 w-4" />
                    {t("organizations.setInactive")}
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    {t("organizations.setActive")}
                  </>
                )}
              </Button>
            )}
            {canEdit && (
              <Button
                variant={editMode ? "outline" : "default"}
                size="sm"
                onClick={() => (editMode ? handleSave() : setEditMode(true))}
                disabled={saving}
                className="gap-1.5"
              >
                <Edit className="h-4 w-4" />
                {editMode ? (saving ? t("common.saving") : t("common.save")) : t("common.edit")}
              </Button>
            )}
            {editMode && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditMode(false);
                  setError("");
                }}
              >
                {t("common.cancel")}
              </Button>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}

        {/* Stats Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
          <Card>
            <CardContent className="pt-4 pb-4 px-4">
              <p className="text-xs font-medium text-muted-foreground">{t("reports.persons")}</p>
              <p className="text-2xl font-bold tabular-nums">
                {org.personsCount ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 px-4">
              <p className="text-xs font-medium text-muted-foreground">{t("reports.memberships")}</p>
              <p className="text-2xl font-bold tabular-nums">
                {org.membershipsCount ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 px-4">
              <p className="text-xs font-medium text-muted-foreground">{t("organizations.admins")}</p>
              <p className="text-2xl font-bold tabular-nums">
                {org.adminsCount ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 px-4">
              <p className="text-xs font-medium text-muted-foreground">{t("organizations.users")}</p>
              <p className="text-2xl font-bold tabular-nums">
                {org.usersCount ?? 0}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Organization Profile Card */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              {t("organizations.profile")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {editMode ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {canEditAll && (
                  <>
                    <div className="space-y-2 sm:col-span-2">
                      <Label>{t("organizations.name")}</Label>
                      <Input
                        value={editForm.name ?? ""}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, name: e.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t("organizations.slug")}</Label>
                      <Input
                        value={editForm.slug ?? ""}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            slug: e.target.value.toLowerCase().replace(/\s+/g, "-"),
                          }))
                        }
                        placeholder="my-org"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t("organizations.logo")}</Label>
                      <div className="flex items-center gap-4">
                        {editForm.logoUrl && (
                          <img
                            src={editForm.logoUrl as string}
                            alt="Logo"
                            className="h-16 w-16 rounded-lg object-cover border"
                          />
                        )}
                        <div className="flex flex-col gap-1">
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handleLogoUpload(f);
                            }}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={uploading}
                            onClick={() => fileInputRef.current?.click()}
                          >
                            {uploading ? t("organizations.uploading") : editForm.logoUrl ? t("organizations.changeLogo") : t("organizations.uploadLogo")}
                          </Button>
                          {editForm.logoUrl && (
                            <button
                              type="button"
                              className="text-xs text-destructive hover:underline"
                              onClick={() => setEditForm((f) => ({ ...f, logoUrl: "" }))}
                            >
                              {t("common.remove")}
                            </button>
                          )}
                        </div>
                      </div>
                      <Input
                        value={editForm.logoUrl ?? ""}
                        onChange={(e) => setEditForm((f) => ({ ...f, logoUrl: e.target.value }))}
                        placeholder={t("organizations.orPasteUrl")}
                        className="text-xs"
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label>{t("organizations.joinDate")}</Label>
                      <Input
                        type="date"
                        value={
                          editForm.joinDate
                            ? String(editForm.joinDate).slice(0, 10)
                            : ""
                        }
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, joinDate: e.target.value || null }))
                        }
                      />
                    </div>
                  </>
                )}
                <div className="space-y-2">
                  <Label>{t("organizations.contactPerson")}</Label>
                  <Input
                    value={editForm.contactPersonName ?? ""}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        contactPersonName: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("organizations.contactPhone")}</Label>
                  <Input
                    value={editForm.contactPersonPhone ?? ""}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        contactPersonPhone: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("organizations.whatsAppSender")}</Label>
                  <Input
                    value={editForm.whatsAppSenderNumber ?? ""}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        whatsAppSenderNumber: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>{t("organizations.address")}</Label>
                  <Input
                    value={editForm.address ?? ""}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, address: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("organizations.defaultMembershipFee")}</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={editForm.defaultMembershipFee ?? 0}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        defaultMembershipFee: parseFloat(e.target.value) || 0,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("organizations.lateFee")}</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={editForm.lateFeePercentage ?? 5}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        lateFeePercentage: parseFloat(e.target.value) || 0,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <div className="flex flex-wrap gap-4 pt-2">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={editForm.proRataMonthly ?? false}
                        onCheckedChange={(v) =>
                          setEditForm((f) => ({
                            ...f,
                            proRataMonthly: !!v,
                          }))
                        }
                      />
                      {t("organizations.proRataMonthly")}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={editForm.proRataQuarterly ?? false}
                        onCheckedChange={(v) =>
                          setEditForm((f) => ({
                            ...f,
                            proRataQuarterly: !!v,
                          }))
                        }
                      />
                      {t("organizations.proRataQuarterly")}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={editForm.proRataYearly ?? false}
                        onCheckedChange={(v) =>
                          setEditForm((f) => ({
                            ...f,
                            proRataYearly: !!v,
                          }))
                        }
                      />
                      {t("organizations.proRataYearly")}
                    </label>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex items-start gap-3">
                  <Building2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">{t("organizations.name")}</p>
                    <p className="font-medium">{org.name}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-xs text-muted-foreground mt-0.5 shrink-0">{t("organizations.slug")}</span>
                  <div>
                    <p className="text-xs text-muted-foreground">{t("organizations.slug")}</p>
                    <p className="font-mono text-sm">{org.slug}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 sm:col-span-2">
                  <Building2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">{t("organizations.logo")}</p>
                    {org.logoUrl ? (
                      <img src={org.logoUrl} alt="Logo" className="h-20 w-20 rounded-lg object-cover border mt-1" />
                    ) : (
                      <div className="h-20 w-20 rounded-lg bg-muted flex items-center justify-center mt-1">
                        <Building2 className="h-8 w-8 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Phone className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">{t("organizations.contactPerson")}</p>
                    <p className="font-medium">
                      {org.contactPersonName || "—"}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Phone className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">{t("organizations.contactPhone")}</p>
                    <p className="font-medium">
                      {org.contactPersonPhone || "—"}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Phone className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">{t("organizations.whatsAppSender")}</p>
                    <p className="font-medium">
                      {org.whatsAppSenderNumber || "—"}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 sm:col-span-2">
                  <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">{t("organizations.address")}</p>
                    <p className="font-medium">{org.address || "—"}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Calendar className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">{t("organizations.joinDate")}</p>
                    <p className="font-medium">
                      {org.joinDate
                        ? new Date(org.joinDate).toLocaleDateString()
                        : "—"}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-xs text-muted-foreground mt-0.5 shrink-0 w-4" />
                  <div>
                    <p className="text-xs text-muted-foreground">{t("common.status")}</p>
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full border ${
                        org.isActive
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-red-50 text-red-700 border-red-200"
                      }`}
                    >
                      {org.isActive ? (
                        <>
                          <Check className="h-3 w-3" />
                          {t("common.active")}
                        </>
                      ) : (
                        <>
                          <X className="h-3 w-3" />
                          {t("common.inactive")}
                        </>
                      )}
                    </span>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <DollarSign className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {t("organizations.proRataLabel")}
                    </p>
                    <p className="font-medium">
                      {org.proRataMonthly ? "Yes" : "No"} /{" "}
                      {org.proRataQuarterly ? "Yes" : "No"} /{" "}
                      {org.proRataYearly ? "Yes" : "No"}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <DollarSign className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">{t("organizations.lateFee")}</p>
                    <p className="font-medium tabular-nums">
                      {org.lateFeePercentage ?? 5}%
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <DollarSign className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">{t("organizations.defaultMembershipFee")}</p>
                    <p className="font-medium tabular-nums">
                      {Number(org.defaultMembershipFee ?? 0).toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Billing History (super_user only) */}
        {isSuperUser && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-primary" />
                {t("organizations.billingHistory")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {billingLoading ? (
                <p className="text-sm text-muted-foreground">{t("organizations.loadingBilling")}</p>
              ) : billing.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("organizations.noBillingRecords")}</p>
              ) : (
                <div className="overflow-x-auto -mx-1">
                  <table className="w-full text-sm min-w-[400px]">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">{t("organizations.year")}</th>
                        <th className="py-2 pr-4 font-medium">{t("common.status")}</th>
                        <th className="py-2 pr-4 font-medium">{t("organizations.paidAt")}</th>
                        <th className="py-2 pr-4 font-medium">{t("organizations.markedBy")}</th>
                        <th className="py-2 font-medium">{t("common.actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {billing.map((b) => (
                        <tr key={b.id} className="border-b last:border-0">
                          <td className="py-3 pr-4 font-medium tabular-nums">
                            {b.year}
                          </td>
                          <td className="py-3 pr-4">
                            <span
                              className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full border ${
                                b.isPaid
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-red-50 text-red-700 border-red-200"
                              }`}
                            >
                              {b.isPaid ? (
                                <>
                                  <Check className="h-3 w-3" />
                                  {t("payments.paid")}
                                </>
                              ) : (
                                <>
                                  <X className="h-3 w-3" />
                                  {t("organizations.due")}
                                </>
                              )}
                            </span>
                          </td>
                          <td className="py-3 pr-4 text-muted-foreground">
                            {b.paidAt
                              ? new Date(b.paidAt).toLocaleDateString()
                              : "—"}
                          </td>
                          <td className="py-3 pr-4 text-muted-foreground">
                            {b.markedBy?.email ?? "—"}
                          </td>
                          <td className="py-3">
                            {canToggleBilling && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleToggleBilling(b.id)}
                                disabled={togglingBillingId === b.id}
                                className="gap-1"
                              >
                                {togglingBillingId === b.id
                                  ? "…"
                                  : b.isPaid
                                  ? t("organizations.markUnpaid")
                                  : t("organizations.markPaid")}
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
