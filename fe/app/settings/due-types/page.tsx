"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { api, type DueType } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Header } from "@/components/header";
import { AbstractBg } from "@/components/abstract-bg";
import { Breadcrumb } from "@/components/breadcrumb";
import { CreditCard, Plus, Pencil, Power } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { dashboardFlowHref } from "@/lib/dashboard-flows";

export default function DueTypesPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [dueTypes, setDueTypes] = useState<DueType[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDueType, setEditingDueType] = useState<DueType | null>(null);
  const [formName, setFormName] = useState("");
  const [formAutoAllocate, setFormAutoAllocate] = useState("no");
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const isSuper = user?.role === "super_user";
  const effectiveOrgId = isSuper ? selectedOrgId : user?.organizationId;

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user || !isSuper) return;
    api<{ id: string; name: string }[]>("/organizations")
      .then((list) => {
        setOrgs(list);
        if (list.length > 0) setSelectedOrgId((prev) => prev || list[0].id);
        else setLoading(false);
      })
      .catch(() => {
        setOrgs([]);
        setLoading(false);
      });
  }, [user, isSuper]);

  const fetchDueTypes = useCallback(async () => {
    if (!effectiveOrgId) return;
    setLoading(true);
    try {
      const params: Record<string, string> = { includeInactive: "true" };
      if (isSuper) params.organizationId = effectiveOrgId;
      const data = await api<DueType[]>("/due-types", { params });
      setDueTypes(data);
    } catch {
      setDueTypes([]);
    } finally {
      setLoading(false);
    }
  }, [effectiveOrgId, isSuper]);

  useEffect(() => {
    if (user && effectiveOrgId) fetchDueTypes();
  }, [user, effectiveOrgId, fetchDueTypes]);

  function openCreateDialog() {
    setEditingDueType(null);
    setFormName("");
    setFormAutoAllocate("no");
    setFormError("");
    setDialogOpen(true);
  }

  function openEditDialog(dueType: DueType) {
    if (dueType.systemKey === "subscription") return;
    setEditingDueType(dueType);
    setFormName(dueType.name);
    setFormAutoAllocate(dueType.autoAllocate ? "yes" : "no");
    setFormError("");
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!formName.trim()) {
      setFormError("Name is required");
      return;
    }

    setFormSaving(true);
    setFormError("");
    try {
      if (editingDueType) {
        await api(`/due-types/${editingDueType.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: formName.trim(),
            autoAllocate: formAutoAllocate === "yes",
          }),
        });
        toast({ title: "Due type updated" });
      } else {
        const body: Record<string, unknown> = {
          name: formName.trim(),
          autoAllocate: formAutoAllocate === "yes",
        };
        if (isSuper && effectiveOrgId) body.organizationId = effectiveOrgId;
        await api("/due-types", {
          method: "POST",
          body: JSON.stringify(body),
        });
        toast({ title: "Due type created" });
      }
      setDialogOpen(false);
      fetchDueTypes();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setFormSaving(false);
    }
  }

  async function handleToggleActive(dueType: DueType) {
    try {
      await api(`/due-types/${dueType.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !dueType.isActive }),
      });
      toast({ title: dueType.isActive ? "Due type archived" : "Due type restored" });
      fetchDueTypes();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed",
        description: err instanceof Error ? err.message : "Failed to update due type",
      });
    }
  }

  if (authLoading || !user) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (user.role !== "admin" && user.role !== "super_user") {
    router.replace("/");
    return null;
  }

  return (
    <div className="min-h-screen bg-background relative">
      <AbstractBg />
      <Header />
      <main className="relative p-6 max-w-4xl mx-auto">
        <Breadcrumb
          items={[
            { label: "Dashboard", href: dashboardFlowHref("admin") },
            { label: "Settings" },
            { label: "Due Types" },
          ]}
        />
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold text-foreground">Due Types</h1>
          </div>
          <Button size="sm" className="gap-1.5" onClick={openCreateDialog}>
            <Plus className="h-4 w-4" />
            Add Due Type
          </Button>
        </div>

        {isSuper && orgs.length > 0 && (
          <div className="mb-4 flex items-center gap-2">
            <label className="text-sm font-medium text-foreground">Organization:</label>
            <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {orgs.map((org) => (
                  <SelectItem key={org.id} value={org.id}>
                    {org.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Due type settings</CardTitle>
            <p className="text-sm text-muted-foreground">
              Configure which due categories are available for manual dues and whether member
              credit should auto-allocate to them. Archived due types are hidden from new dues
              but preserved on existing records.
            </p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />
                ))}
              </div>
            ) : dueTypes.length === 0 ? (
              <div className="py-10 text-center">
                <CreditCard className="mx-auto mb-2 h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                  No due types found. Add one to get started.
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="p-3 text-left font-medium text-muted-foreground">Name</th>
                      <th className="p-3 text-center font-medium text-muted-foreground">
                        Auto Allocate
                      </th>
                      <th className="p-3 text-center font-medium text-muted-foreground">Status</th>
                      <th className="p-3 text-right font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dueTypes.map((dueType) => (
                      <tr
                        key={dueType.id}
                        className="border-b last:border-0 transition-colors hover:bg-muted/30"
                      >
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <span className={dueType.isActive ? "" : "text-muted-foreground line-through"}>
                              {dueType.name}
                            </span>
                            {dueType.systemKey === "subscription" ? (
                              <span className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                                System
                              </span>
                            ) : null}
                            {dueType.systemKey === "subscription" ? (
                              <span className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                                Locked
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="p-3 text-center">
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                              dueType.autoAllocate
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-slate-200 bg-slate-100 text-slate-600"
                            }`}
                          >
                            {dueType.autoAllocate ? "Yes" : "No"}
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                              dueType.isActive
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-slate-200 bg-slate-100 text-slate-500"
                            }`}
                          >
                            {dueType.isActive ? "Active" : "Archived"}
                          </span>
                        </td>
                        <td className="p-3">
                          <div className="flex justify-end gap-2">
                            {dueType.systemKey === "subscription" ? (
                              <span className="text-xs text-muted-foreground">
                                Subscription is system managed
                              </span>
                            ) : (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1.5"
                                  onClick={() => openEditDialog(dueType)}
                                >
                                  <Pencil className="h-4 w-4" />
                                  Edit
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1.5"
                                  onClick={() => handleToggleActive(dueType)}
                                >
                                  <Power className="h-4 w-4" />
                                  {dueType.isActive ? "Archive" : "Restore"}
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-primary" />
                {editingDueType ? "Edit Due Type" : "Create Due Type"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={formName} onChange={(e) => setFormName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Auto Allocation</Label>
                <Select value={formAutoAllocate} onValueChange={setFormAutoAllocate}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
              <div className="flex gap-2">
                <Button onClick={handleSave} disabled={formSaving} className="flex-1">
                  {formSaving ? "Saving…" : editingDueType ? "Update Due Type" : "Create Due Type"}
                </Button>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
