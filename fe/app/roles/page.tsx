"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Pencil, Plus, ShieldCheck, Trash2, Users } from "lucide-react";
import { Header } from "@/components/header";
import { Breadcrumb } from "@/components/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { api, type OrganizationRole, type PermissionDefinition } from "@/lib/api";

export default function RolesPage() {
  const router = useRouter();
  const { user, loading: authLoading, activeOrganization } = useAuth();
  const { toast } = useToast();
  const [roles, setRoles] = useState<OrganizationRole[]>([]);
  const [catalog, setCatalog] = useState<PermissionDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<OrganizationRole | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const organizationId = user?.role === "super_user" ? activeOrganization?.id ?? null : user?.organizationId ?? null;

  const categories = useMemo(() => {
    const grouped = new Map<string, PermissionDefinition[]>();
    for (const permission of catalog) grouped.set(permission.category, [...(grouped.get(permission.category) ?? []), permission]);
    return Array.from(grouped.entries());
  }, [catalog]);

  async function load() {
    if (!organizationId) return;
    setLoading(true);
    try {
      const [roleRows, definitions] = await Promise.all([
        api<OrganizationRole[]>("/roles", { params: { organizationId } }),
        api<PermissionDefinition[]>("/roles/catalog"),
      ]);
      setRoles(roleRows);
      setCatalog(definitions);
    } catch (error) {
      toast({ variant: "destructive", title: "Unable to load roles", description: error instanceof Error ? error.message : "Please try again" });
    } finally { setLoading(false); }
  }

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
    if (user && user.role !== "admin" && user.role !== "super_user") router.replace("/");
    if (user && organizationId && (user.role === "admin" || user.role === "super_user")) void load();
  }, [user, organizationId, authLoading, router]);

  function openEditor(role?: OrganizationRole) {
    setEditing(role ?? null);
    setName(role?.name ?? "");
    setDescription(role?.description ?? "");
    setSelected(role?.permissions ?? []);
    setEditorOpen(true);
  }

  function togglePermission(definition: PermissionDefinition, checked: boolean) {
    const next = new Set(selected);
    if (checked) {
      next.add(definition.key);
      definition.implies?.forEach((permission) => next.add(permission));
    } else next.delete(definition.key);
    setSelected(Array.from(next));
  }

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api(editing ? `/roles/${editing.id}` : "/roles", {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify({ name, description, permissions: selected, organizationId }),
      });
      toast({ title: editing ? "Role updated" : "Role created", description: `${name} is ready to assign.` });
      setEditorOpen(false);
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: "Unable to save role", description: error instanceof Error ? error.message : "Please try again" });
    } finally { setSaving(false); }
  }

  if (authLoading || !user || (user.role !== "admin" && user.role !== "super_user")) return null;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-6xl p-6">
        <Breadcrumb items={[{ label: "Dashboard", href: "/" }, { label: "Settings" }, { label: "Roles" }]} />
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Roles</h1>
            <p className="mt-1 text-sm text-muted-foreground">Create named roles and choose exactly what each role can access.</p>
          </div>
          <Button onClick={() => openEditor()} className="gap-2"><Plus className="h-4 w-4" />Add role</Button>
        </div>

        {loading ? <p className="text-sm text-muted-foreground">Loading roles…</p> : roles.length === 0 ? (
          <Card><CardContent className="flex flex-col items-center py-14 text-center">
            <ShieldCheck className="mb-3 h-10 w-10 text-primary" />
            <h2 className="font-semibold">Create your first role</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">For example: Secretary, Treasurer, Cashier or Data Entry Officer.</p>
            <Button onClick={() => openEditor()} className="mt-5 gap-2"><Plus className="h-4 w-4" />Add role</Button>
          </CardContent></Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {roles.map((role) => (
              <Card key={role.id} className="overflow-hidden">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10"><ShieldCheck className="h-5 w-5 text-primary" /></div>
                      <div className="min-w-0"><h2 className="truncate font-semibold">{role.name}</h2><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{role.description || "No description"}</p></div>
                    </div>
                  </div>
                  <div className="mt-5 flex items-center gap-4 border-y py-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />{role.userCount} user{role.userCount === 1 ? "" : "s"}</span>
                    <span>{role.permissions.length} permissions</span>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={() => openEditor(role)}><Pencil className="h-3.5 w-3.5" />Edit</Button>
                    <Button variant="outline" size="sm" title="Duplicate role" onClick={async () => { await api(`/roles/${role.id}/duplicate`, { method: "POST", body: JSON.stringify({ organizationId }) }); await load(); }}><Copy className="h-3.5 w-3.5" /></Button>
                    <Button variant="outline" size="sm" disabled={role.userCount > 0} title={role.userCount ? "Reassign users before deleting" : "Delete role"} onClick={async () => {
                      if (!window.confirm(`Delete the ${role.name} role?`)) return;
                      try { await api(`/roles/${role.id}`, { method: "DELETE", params: organizationId ? { organizationId } : undefined }); await load(); }
                      catch (error) { toast({ variant: "destructive", title: "Unable to delete role", description: error instanceof Error ? error.message : "Please try again" }); }
                    }}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit role" : "Add role"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label>Role name</Label><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Cashier" /></div>
            <div className="space-y-2"><Label>Description</Label><Textarea className="min-h-[40px]" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What is this role responsible for?" /></div>
          </div>
          <div className="mt-2 flex items-center justify-between"><div><h3 className="font-medium">Permissions</h3><p className="text-xs text-muted-foreground">Action permissions automatically include the related view access.</p></div><span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">{selected.length} selected</span></div>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {categories.map(([category, definitions]) => {
              const allSelected = definitions.every((definition) => selected.includes(definition.key));
              return <div key={category} className="rounded-lg border bg-card p-4">
                <div className="mb-3 flex items-center justify-between border-b pb-3"><h4 className="text-sm font-semibold">{category}</h4><label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"><Checkbox checked={allSelected} onCheckedChange={(checked) => {
                  const next = new Set(selected); definitions.forEach((definition) => checked ? next.add(definition.key) : next.delete(definition.key)); setSelected(Array.from(next));
                }} />Select all</label></div>
                <div className="space-y-3">{definitions.map((definition) => <label key={definition.key} className="flex cursor-pointer items-start gap-3">
                  <Checkbox className="mt-0.5" checked={selected.includes(definition.key)} onCheckedChange={(checked) => togglePermission(definition, Boolean(checked))} />
                  <span><span className="block text-sm font-medium">{definition.label}</span><span className="block text-xs leading-5 text-muted-foreground">{definition.description}</span></span>
                </label>)}</div>
              </div>;
            })}
          </div>
          <div className="sticky bottom-0 -mx-6 -mb-6 mt-5 flex justify-end gap-2 border-t bg-background px-6 py-4"><Button variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button><Button disabled={saving || !name.trim()} onClick={save}>{saving ? "Saving…" : "Save role"}</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
