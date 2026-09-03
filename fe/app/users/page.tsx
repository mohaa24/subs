"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, ShieldCheck, UserPlus } from "lucide-react";
import { Header } from "@/components/header";
import { Breadcrumb } from "@/components/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { api, type OrganizationRole, type User } from "@/lib/api";

export default function UsersPage() {
  const router = useRouter();
  const { user, loading: authLoading, activeOrganization } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<OrganizationRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const organizationId = user?.role === "super_user" ? activeOrganization?.id ?? null : user?.organizationId ?? null;

  async function load() {
    if (!organizationId) return;
    setLoading(true);
    try {
      const params = { organizationId };
      const [userRows, roleRows] = await Promise.all([
        api<User[]>("/users", { params }),
        api<OrganizationRole[]>("/roles", { params }),
      ]);
      setUsers(userRows);
      setRoles(roleRows);
    } catch (error) {
      toast({ variant: "destructive", title: "Unable to load users", description: error instanceof Error ? error.message : "Please try again" });
    } finally { setLoading(false); }
  }

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
    if (user && user.role !== "admin" && user.role !== "super_user") router.replace("/");
    if (user && organizationId && (user.role === "admin" || user.role === "super_user")) void load();
  }, [user, organizationId, authLoading, router]);

  async function createUser(event: React.FormEvent) {
    event.preventDefault();
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      toast({ variant: "destructive", title: "Email address required", description: "Enter the new user's email address." });
      return;
    }
    if (password.length < 6) {
      toast({ variant: "destructive", title: "Temporary password is too short", description: "Use at least 6 characters." });
      return;
    }
    if (!roleId) {
      toast({ variant: "destructive", title: "Role required", description: "Select a role before creating the user." });
      return;
    }
    setSaving(true);
    try {
      await api("/users", { method: "POST", body: JSON.stringify({
        email: normalizedEmail, password, role: "user",
        organizationRoleId: roleId || null,
        organizationId,
      }) });
      toast({ title: "User created", description: `${email} can now sign in.` });
      setCreateOpen(false); setEmail(""); setPassword(""); setRoleId("");
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: "Unable to create user", description: error instanceof Error ? error.message : "Please try again" });
    } finally { setSaving(false); }
  }

  async function updateUser() {
    if (!editUser) return;
    setSaving(true);
    try {
      await api(`/users/${editUser.id}`, {
        method: "PATCH",
        params: organizationId ? { organizationId } : undefined,
        body: JSON.stringify({ organizationRoleId: roleId || null, isActive }),
      });
      toast({ title: "User updated", description: "Their access changes apply immediately." });
      setEditUser(null); await load();
    } catch (error) {
      toast({ variant: "destructive", title: "Unable to update user", description: error instanceof Error ? error.message : "Please try again" });
    } finally { setSaving(false); }
  }

  if (authLoading || !user || (user.role !== "admin" && user.role !== "super_user")) return null;

  return <div className="min-h-screen bg-background">
    <Header />
    <main className="mx-auto max-w-6xl p-6">
      <Breadcrumb items={[{ label: "Dashboard", href: "/" }, { label: "Settings" }, { label: "Users" }]} />
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-2xl font-semibold tracking-tight">Users</h1><p className="mt-1 text-sm text-muted-foreground">Create organisation users and assign their access through a role.</p></div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2"><UserPlus className="h-4 w-4" />Add user</Button>
      </div>
      <Card><CardContent className="p-0">
        {loading ? <p className="p-6 text-sm text-muted-foreground">Loading users…</p> : <div className="overflow-x-auto"><table className="min-w-full text-sm">
          <thead><tr className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="px-5 py-3 font-medium">User</th><th className="px-5 py-3 font-medium">Access</th><th className="px-5 py-3 font-medium">Status</th><th className="px-5 py-3 text-right font-medium">Actions</th></tr></thead>
          <tbody>{users.map((row) => <tr key={row.id} className="border-b last:border-0">
            <td className="px-5 py-4"><p className="font-medium">{row.email}</p><p className="mt-0.5 text-xs text-muted-foreground">{row.organization?.name ?? "Organisation user"}</p></td>
            <td className="px-5 py-4">{row.role === "super_user" ? <Badge tone="amber">Super User</Badge> : row.role === "admin" ? <Badge tone="blue">Administrator</Badge> : <div><p className="font-medium">{row.organizationRole?.name ?? "No role assigned"}</p><p className="text-xs text-muted-foreground">Organisation role</p></div>}</td>
            <td className="px-5 py-4"><Badge tone={row.isActive === false ? "slate" : "green"}>{row.isActive === false ? "Inactive" : "Active"}</Badge></td>
            <td className="px-5 py-4 text-right">{row.role === "user" && <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setEditUser(row); setRoleId(row.organizationRoleId ?? ""); setIsActive(row.isActive !== false); }}><Pencil className="h-3.5 w-3.5" />Edit access</Button>}</td>
          </tr>)}</tbody>
        </table></div>}
      </CardContent></Card>
    </main>

    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Add user</DialogTitle></DialogHeader>
      <form onSubmit={createUser} className="space-y-4">
        <div className="space-y-2"><Label>Email address</Label><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
        <div className="space-y-2"><Label>Temporary password</Label><Input type="password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} required /><p className="text-xs text-muted-foreground">Use at least 6 characters and share it securely with the new user.</p></div>
        <div className="space-y-2"><Label>Role</Label><Select value={roleId} onValueChange={setRoleId}><SelectTrigger><SelectValue placeholder="Select a role" /></SelectTrigger><SelectContent>{roles.map((role) => <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>)}</SelectContent></Select>{roles.length === 0 && <button type="button" onClick={() => router.push("/roles")} className="text-xs font-medium text-primary">Create a role first</button>}</div>
        <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button type="submit" disabled={saving || !roleId}>{saving ? "Creating…" : "Create user"}</Button></div>
      </form>
    </DialogContent></Dialog>

    <Dialog open={Boolean(editUser)} onOpenChange={(open) => !open && setEditUser(null)}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Edit user access</DialogTitle></DialogHeader>
      <div className="rounded-lg border bg-muted/30 p-3"><p className="font-medium">{editUser?.email}</p><p className="text-xs text-muted-foreground">Role changes apply immediately.</p></div>
      <div className="space-y-2"><Label>Role</Label><Select value={roleId} onValueChange={setRoleId}><SelectTrigger><SelectValue placeholder="Select a role" /></SelectTrigger><SelectContent>{roles.map((role) => <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>)}</SelectContent></Select></div>
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3"><Checkbox checked={isActive} onCheckedChange={(checked) => setIsActive(Boolean(checked))} /><span><span className="block text-sm font-medium">Active user</span><span className="block text-xs text-muted-foreground">Inactive users cannot sign in or use an existing session.</span></span></label>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button><Button disabled={saving || !roleId} onClick={updateUser}>{saving ? "Saving…" : "Save changes"}</Button></div>
    </DialogContent></Dialog>
  </div>;
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "amber" | "blue" | "green" | "slate" }) {
  const tones = { amber: "bg-amber-100 text-amber-800", blue: "bg-blue-100 text-blue-800", green: "bg-emerald-100 text-emerald-800", slate: "bg-slate-100 text-slate-600" };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}
