"use client";

import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/lib/i18n";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type User, ALL_PERMISSIONS, type PermissionType } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserPlus, Shield, Users2, CreditCard, MessageSquare, Package, FileText, Eye, Pencil } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Header } from "@/components/header";
import { Breadcrumb } from "@/components/breadcrumb";

const PERMISSION_SECTIONS: {
  labelKey: string;
  icon: React.ElementType;
  permissions: { value: PermissionType; label: string }[];
}[] = [
  {
    labelKey: "persons.title",
    icon: Users2,
    permissions: [
      { value: "VIEW_PERSONS", label: "View Persons" },
      { value: "MANAGE_PERSONS", label: "Add / Edit Persons" },
    ],
  },
  {
    labelKey: "memberships.title",
    icon: Shield,
    permissions: [
      { value: "VIEW_MEMBERSHIPS", label: "View Memberships" },
      { value: "MANAGE_MEMBERSHIPS", label: "Add / Edit Memberships" },
    ],
  },
  {
    labelKey: "payments.title",
    icon: CreditCard,
    permissions: [
      { value: "VIEW_PAYMENTS", label: "View Payments" },
      { value: "COLLECT_PAYMENTS", label: "Collect Payments" },
    ],
  },
  {
    labelKey: "announcements.title",
    icon: MessageSquare,
    permissions: [
      { value: "MANAGE_ANNOUNCEMENTS", label: "Manage Announcements" },
    ],
  },
  {
    labelKey: "distributions.title",
    icon: Package,
    permissions: [
      { value: "MANAGE_DISTRIBUTIONS", label: "Manage Distributions" },
    ],
  },
  {
    labelKey: "reports.title",
    icon: FileText,
    permissions: [
      { value: "VIEW_REPORTS", label: "View Reports" },
    ],
  },
];

function getPermissions(u: User): string[] {
  const p = u.permissions;
  if (!p) return [];
  return p.map((x: unknown) => (typeof x === "string" ? x : (x as { permission: string }).permission));
}

function PermissionsGrid({
  selected,
  onChange,
  t,
}: {
  selected: string[];
  onChange: (perms: string[]) => void;
  t: (key: string) => string;
}) {
  return (
    <div className="space-y-4 max-h-[400px] overflow-y-auto">
      {PERMISSION_SECTIONS.map((section) => {
        const Icon = section.icon;
        return (
          <div key={section.labelKey} className="border rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <Icon className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">{t(section.labelKey)}</span>
            </div>
            <div className="space-y-1.5 ml-6">
              {section.permissions.map((p) => (
                <label key={p.value} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={selected.includes(p.value)}
                    onCheckedChange={(checked) =>
                      onChange(checked ? [...selected, p.value] : selected.filter((x) => x !== p.value))
                    }
                  />
                  {p.label}
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function UsersPage() {
  const { t } = useTranslation();
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
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [permsDialogOpen, setPermsDialogOpen] = useState(false);
  const [permsUser, setPermsUser] = useState<User | null>(null);
  const [permsEditing, setPermsEditing] = useState<string[]>([]);
  const [permsSaving, setPermsSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user) return;
    if (user.role === "super_user") {
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
      const created = await api<User>("/users", {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          role,
          ...(user!.role === "super_user" && organizationId ? { organizationId } : {}),
        }),
      });
      if (role === "user" && selectedPermissions.length > 0 && created.id) {
        await api(`/users/${created.id}/permissions`, {
          method: "PUT",
          body: JSON.stringify({ permissions: selectedPermissions }),
        });
      }
      setEmail("");
      setPassword("");
      setSelectedPermissions([]);
      setDialogOpen(false);
      const updated = await api<User[]>("/users");
      setList(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading || !user) return <div className="p-8 text-muted-foreground">{t("common.loading")}</div>;
  if (user.role !== "admin" && user.role !== "super_user") {
    router.replace("/");
    return null;
  }

  const isSuper = user.role === "super_user";

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="p-6 max-w-4xl mx-auto">
        <Breadcrumb items={[{ label: t("dashboard.title"), href: "/" }, { label: t("users.title") }]} />
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-xl font-semibold text-foreground">{t("users.title")}</h1>
          <Button size="sm" className="gap-1.5" onClick={() => setDialogOpen(true)}>
            <UserPlus className="h-4 w-4" />
            {t("users.addUser")}
          </Button>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{t("users.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">{t("auth.email")}</th>
                      <th className="py-2 pr-4 font-medium">{t("users.role")}</th>
                      <th className="py-2 pr-4 font-medium">{t("organizations.title")}</th>
                      <th className="py-2 pr-4 font-medium">{t("users.permissions")}</th>
                      <th className="py-2 font-medium text-right">{t("common.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((u) => {
                      const perms = getPermissions(u);
                      return (
                        <tr key={u.id} className="border-b">
                          <td className="py-3 pr-4 font-medium">{u.email}</td>
                          <td className="py-3 pr-4">
                            <span className={`text-xs px-2 py-0.5 rounded ${
                              u.role === "admin" ? "bg-primary/10 text-primary" :
                              u.role === "super_user" ? "bg-yellow-500/10 text-yellow-700" :
                              "bg-muted text-muted-foreground"
                            }`}>
                              {u.role === "super_user" ? t("users.superUser") : u.role === "admin" ? t("users.admin") : t("users.user")}
                            </span>
                          </td>
                          <td className="py-3 pr-4 text-muted-foreground">
                            {u.organization ? u.organization.name : "—"}
                          </td>
                          <td className="py-3 pr-4">
                            {u.role === "super_user" || u.role === "admin" ? (
                              <span className="text-xs text-muted-foreground">{t("users.permissions")}</span>
                            ) : perms.length > 0 ? (
                              <div className="flex flex-wrap gap-1 max-w-[200px]">
                                {perms.slice(0, 3).map((p) => (
                                  <span key={p} className="inline-flex items-center rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-medium">
                                    {p.replace(/_/g, " ").toLowerCase()}
                                  </span>
                                ))}
                                {perms.length > 3 && (
                                  <span className="text-xs text-muted-foreground">+{perms.length - 3} more</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">{t("common.none")}</span>
                            )}
                          </td>
                          <td className="py-3 text-right">
                            {u.role === "user" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1 h-7 text-xs"
                                onClick={() => {
                                  setPermsUser(u);
                                  setPermsEditing([...getPermissions(u)]);
                                  setPermsDialogOpen(true);
                                }}
                              >
                                <Shield className="h-3 w-3" />
                                {t("users.permissions")}
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Create User Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setSelectedPermissions([]); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("users.addUser")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateUser} className="space-y-4">
            <div className="space-y-2">
              <Label>{t("auth.email")}</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>{t("auth.password")}</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            </div>
            <div className="space-y-2">
              <Label>{t("users.role")}</Label>
              <Select value={role} onValueChange={(v: "admin" | "user") => setRole(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">{t("users.user")}</SelectItem>
                  <SelectItem value="admin">{t("users.admin")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {isSuper && (
              <div className="space-y-2">
                <Label>{t("organizations.title")}</Label>
                <Select value={organizationId} onValueChange={setOrganizationId}>
                  <SelectTrigger><SelectValue placeholder={t("organizations.selectOrganization")} /></SelectTrigger>
                  <SelectContent>
                    {orgs.map((o) => (
                      <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {role === "user" && (
              <div className="space-y-2">
                <Label>{t("users.permissions")}</Label>
                <PermissionsGrid selected={selectedPermissions} onChange={setSelectedPermissions} t={t} />
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting}>{submitting ? t("common.creating") : t("common.create")}</Button>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>{t("common.cancel")}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Manage Permissions Dialog */}
      <Dialog open={permsDialogOpen} onOpenChange={(open) => { setPermsDialogOpen(open); if (!open) setPermsUser(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("users.managePermissions")}</DialogTitle>
            {permsUser && <p className="text-sm text-muted-foreground mt-1">{permsUser.email}</p>}
          </DialogHeader>
          <PermissionsGrid selected={permsEditing} onChange={setPermsEditing} t={t} />
          <div className="flex gap-2 pt-2">
            <Button
              disabled={permsSaving || !permsUser}
              onClick={async () => {
                if (!permsUser) return;
                setPermsSaving(true);
                try {
                  await api(`/users/${permsUser.id}/permissions`, {
                    method: "PUT",
                    body: JSON.stringify({ permissions: permsEditing }),
                  });
                  const updated = await api<User[]>("/users");
                  setList(updated);
                  setPermsDialogOpen(false);
                  setPermsUser(null);
                } finally {
                  setPermsSaving(false);
                }
              }}
            >
              {permsSaving ? t("common.saving") : t("common.save")}
            </Button>
            <Button variant="outline" onClick={() => { setPermsDialogOpen(false); setPermsUser(null); }}>{t("common.cancel")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
