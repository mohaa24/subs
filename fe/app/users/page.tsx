"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type User } from "@/lib/api";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserPlus } from "lucide-react";
import { Header } from "@/components/header";
import { Breadcrumb } from "@/components/breadcrumb";

export default function UsersPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [list, setList] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [organizationId, setOrganizationId] = useState("");
  const [orgs, setOrgs] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user) return;
    const isSuper = user.role === "super_user";
    if (isSuper) {
      api<{ id: string; name: string; slug: string }[]>("/organizations")
        .then(setOrgs)
        .catch(() => setOrgs([]));
    }
    api<User[]>("/users")
      .then(setList)
      .catch(() => setList([]))
      .finally(() => setLoading(false));
  }, [user]);

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await api("/users", {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          role,
          ...(user!.role === "super_user" && organizationId ? { organizationId } : {}),
        }),
      });
      setEmail("");
      setPassword("");
      setDialogOpen(false);
      const updated = await api<User[]>("/users");
      setList(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading || !user) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (user.role !== "admin" && user.role !== "super_user") {
    router.replace("/");
    return null;
  }

  const isSuper = user.role === "super_user";

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="p-6 max-w-3xl mx-auto">
        <Breadcrumb items={[{ label: "Dashboard", href: "/" }, { label: "Users" }]} />
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-xl font-semibold text-foreground">Users</h1>
          <Button size="sm" className="gap-1.5" onClick={() => setDialogOpen(true)}>
            <UserPlus className="h-4 w-4" />
            Add user
          </Button>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <ul className="divide-y">
                {list.map((u) => (
                  <li key={u.id} className="py-3 flex items-center justify-between">
                    <div>
                      <span className="font-medium">{u.email}</span>
                      <span className="text-muted-foreground text-sm ml-2">{u.role}</span>
                      {u.organization && (
                        <span className="text-muted-foreground text-sm ml-2">({u.organization.name})</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add User</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateUser} className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Password</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v: "admin" | "user") => setRole(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {isSuper && (
              <div className="space-y-2">
                <Label>Organization</Label>
                <Select value={organizationId} onValueChange={setOrganizationId}>
                  <SelectTrigger><SelectValue placeholder="Select Organization" /></SelectTrigger>
                  <SelectContent>
                    {orgs.map((o) => (
                      <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting}>{submitting ? "Creating…" : "Create"}</Button>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
