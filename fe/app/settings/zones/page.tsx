"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { api, type Zone } from "@/lib/api";
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
import { MapPin, Plus, Pencil, Power, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { dashboardFlowHref } from "@/lib/dashboard-flows";

const MAX_ZONE_CODE = 9;

export default function ZonesPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<Zone | null>(null);
  const [formName, setFormName] = useState("");
  const [formCode, setFormCode] = useState("");
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
      .catch(() => { setOrgs([]); setLoading(false); });
  }, [user, isSuper]);

  const fetchZones = useCallback(async () => {
    if (!effectiveOrgId) return;
    setLoading(true);
    try {
      const params: Record<string, string> = { includeInactive: "true" };
      if (isSuper) params.organizationId = effectiveOrgId;
      const data = await api<Zone[]>("/zones", { params });
      setZones(data);
    } catch {
      setZones([]);
    } finally {
      setLoading(false);
    }
  }, [effectiveOrgId, isSuper]);

  useEffect(() => {
    if (user && effectiveOrgId) fetchZones();
  }, [user, effectiveOrgId, fetchZones]);

  function openCreateDialog() {
    const usedCodes = new Set(zones.map((zone) => zone.code));
    const nextAvailableCode = Array.from({ length: MAX_ZONE_CODE }, (_, index) => index + 1).find(
      (code) => !usedCodes.has(code)
    );
    if (!nextAvailableCode) {
      toast({
        variant: "destructive",
        title: "Zone limit reached",
        description: `Only ${MAX_ZONE_CODE} zones are allowed. Remove an unused zone before adding a new one.`,
      });
      return;
    }
    setEditingZone(null);
    setFormName("");
    setFormCode(String(nextAvailableCode));
    setFormError("");
    setDialogOpen(true);
  }

  function openEditDialog(zone: Zone) {
    setEditingZone(zone);
    setFormName(zone.name);
    setFormCode(String(zone.code));
    setFormError("");
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!formName.trim()) { setFormError("Name is required"); return; }
    const code = parseInt(formCode, 10);
    if (isNaN(code) || code < 1 || code > MAX_ZONE_CODE) {
      setFormError(`Code must be between 1 and ${MAX_ZONE_CODE}`);
      return;
    }

    setFormSaving(true);
    setFormError("");
    try {
      if (editingZone) {
        await api(`/zones/${editingZone.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: formName.trim() }),
        });
        toast({ title: "Zone updated" });
      } else {
        const body: any = { name: formName.trim(), code };
        if (isSuper && effectiveOrgId) body.organizationId = effectiveOrgId;
        await api("/zones", { method: "POST", body: JSON.stringify(body) });
        toast({ title: "Zone created" });
      }
      setDialogOpen(false);
      fetchZones();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setFormSaving(false);
    }
  }

  async function handleToggleActive(zone: Zone) {
    try {
      await api(`/zones/${zone.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !zone.isActive }),
      });
      toast({ title: zone.isActive ? "Zone deactivated" : "Zone activated" });
      fetchZones();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed",
        description: err instanceof Error ? err.message : "Failed to update zone",
      });
    }
  }

  async function handleDelete(zone: Zone) {
    if (!confirm(`Delete zone "${zone.name}" (Code ${zone.code})? This only works if no memberships use it.`)) return;
    try {
      await api(`/zones/${zone.id}`, { method: "DELETE" });
      toast({ title: "Zone deleted" });
      fetchZones();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Cannot delete",
        description: err instanceof Error ? err.message : "Failed to delete zone",
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
        <Breadcrumb items={[{ label: "Dashboard", href: dashboardFlowHref("admin") }, { label: "Settings" }, { label: "Zones" }]} />
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold text-foreground">Zone Management</h1>
          </div>
          <Button size="sm" className="gap-1.5" onClick={openCreateDialog}>
            <Plus className="h-4 w-4" />
            Add Zone
          </Button>
        </div>

        {isSuper && orgs.length > 0 && (
          <div className="mb-4 flex items-center gap-2">
            <label className="text-sm font-medium text-foreground">Organization:</label>
            <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
              <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                {orgs.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Zones</CardTitle>
            <p className="text-sm text-muted-foreground">
              Manage zones used in the membership form. Deactivated zones are hidden from new memberships but preserved on existing ones.
            </p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />
                ))}
              </div>
            ) : zones.length === 0 ? (
              <div className="text-center py-10">
                <MapPin className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  No zones configured. Click &ldquo;Add Zone&rdquo; to create one.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 border-b">
                      <th className="text-left p-3 font-medium text-muted-foreground">Code</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Name</th>
                      <th className="text-center p-3 font-medium text-muted-foreground">Status</th>
                      <th className="text-right p-3 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zones.map((zone) => (
                      <tr key={zone.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="p-3 font-mono font-semibold">{zone.code}</td>
                        <td className="p-3">
                          <span className={zone.isActive ? "" : "text-muted-foreground line-through"}>
                            {zone.name}
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-0.5 rounded-full border ${
                              zone.isActive
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-slate-100 text-slate-500 border-slate-200"
                            }`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${zone.isActive ? "bg-emerald-500" : "bg-slate-400"}`} />
                            {zone.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEditDialog(zone)} title="Edit">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => handleToggleActive(zone)}
                              title={zone.isActive ? "Deactivate" : "Activate"}
                            >
                              <Power className={`h-3.5 w-3.5 ${zone.isActive ? "text-amber-600" : "text-emerald-600"}`} />
                            </Button>
                            {!zone.isActive && (
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={() => handleDelete(zone)} title="Delete">
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
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
      </main>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingZone ? "Edit Zone" : "Add Zone"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Zone Code</Label>
              <Input
                type="number"
                min={1}
                max={MAX_ZONE_CODE}
                value={formCode}
                onChange={(e) => setFormCode(e.target.value)}
                disabled={!!editingZone}
                placeholder="e.g. 1"
              />
              {!editingZone && (
                <p className="text-xs text-muted-foreground">Allowed range: 1 to 9.</p>
              )}
              {editingZone && (
                <p className="text-xs text-muted-foreground">Code cannot be changed after creation.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Zone Name</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. North District"
              />
            </div>
            {formError && (
              <p className="text-sm text-destructive">{formError}</p>
            )}
            <div className="flex gap-2 pt-1">
              <Button onClick={handleSave} disabled={formSaving} className="flex-1">
                {formSaving ? "Saving…" : editingZone ? "Update" : "Create"}
              </Button>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
