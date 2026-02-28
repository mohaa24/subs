"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type Organization } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { Header } from "@/components/header";
import { Breadcrumb } from "@/components/breadcrumb";

type OrgRow = {
  id: string;
  name: string;
  slug: string;
  defaultMembershipFee: number;
  defaultMembershipFeeInput: string;
  isActive: boolean;
  adminsCount: number;
  usersCount: number;
  personsCount: number;
  membershipsCount: number;
};

function normalizeOrg(org: Organization): OrgRow {
  const fee = Number(org.defaultMembershipFee ?? 0);
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    defaultMembershipFee: fee,
    defaultMembershipFeeInput: fee.toString(),
    isActive: org.isActive ?? true,
    adminsCount: org.adminsCount ?? 0,
    usersCount: org.usersCount ?? 0,
    personsCount: org.personsCount ?? 0,
    membershipsCount: org.membershipsCount ?? 0,
  };
}

export default function OrganizationsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [list, setList] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [defaultMembershipFee, setDefaultMembershipFee] = useState("0");
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [savingOrgId, setSavingOrgId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const isSuperUser = user?.role === "super_user";
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      try {
        if (user.role === "super_user") {
          const orgs = await api<Organization[]>("/organizations");
          setList(orgs.map(normalizeOrg));
        } else if (user.role === "admin") {
          const org = await api<Organization>("/organizations/current");
          setList([normalizeOrg(org)]);
        } else {
          setList([]);
        }
      } catch {
        setList([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const fee = Number(defaultMembershipFee);
    if (!Number.isFinite(fee) || fee < 0) {
      setError("Default membership fee must be 0 or greater.");
      return;
    }
    setSubmitting(true);
    try {
      await api("/organizations", {
        method: "POST",
        body: JSON.stringify({
          name,
          slug: slug || name.toLowerCase().replace(/\s+/g, "-"),
          defaultMembershipFee: fee,
          isActive,
        }),
      });
      setName("");
      setSlug("");
      setDefaultMembershipFee("0");
      setIsActive(true);
      setDialogOpen(false);
      const updated = await api<Organization[]>("/organizations");
      setList(updated.map(normalizeOrg));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create organization");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSave(orgId: string) {
    if (!user) return;
    const org = list.find((item) => item.id === orgId);
    if (!org) return;

    const fee = Number(org.defaultMembershipFeeInput);
    if (!Number.isFinite(fee) || fee < 0) {
      setRowErrors((prev) => ({ ...prev, [orgId]: "Membership fee must be 0 or greater." }));
      return;
    }

    setRowErrors((prev) => ({ ...prev, [orgId]: "" }));
    setSavingOrgId(orgId);
    try {
      const body: Record<string, unknown> = { defaultMembershipFee: fee };
      if (user.role === "super_user") body.isActive = org.isActive;
      const updated = await api<Organization>(`/organizations/${orgId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setList((prev) =>
        prev.map((item) =>
          item.id === orgId
            ? {
                ...item,
                defaultMembershipFee: Number(updated.defaultMembershipFee ?? fee),
                defaultMembershipFeeInput: String(Number(updated.defaultMembershipFee ?? fee)),
                isActive: updated.isActive ?? item.isActive,
              }
            : item
        )
      );
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [orgId]: err instanceof Error ? err.message : "Failed to save" }));
    } finally {
      setSavingOrgId(null);
    }
  }

  if (authLoading || !user) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!isSuperUser && !isAdmin) {
    router.replace("/");
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="p-6 max-w-7xl mx-auto">
        <Breadcrumb items={[{ label: "Dashboard", href: "/" }, { label: "Organizations" }]} />
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-xl font-semibold text-foreground">Organizations</h1>
          {isSuperUser && (
            <Button size="sm" className="gap-1.5" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              Add organization
            </Button>
          )}
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{isSuperUser ? "All Organizations" : "Organization Details"}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : list.length === 0 ? (
              <p className="text-sm text-muted-foreground">No organizations found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Organization</th>
                      <th className="py-2 pr-4 font-medium">Default membership fee</th>
                      <th className="py-2 pr-4 font-medium">Admins</th>
                      <th className="py-2 pr-4 font-medium">Users</th>
                      <th className="py-2 pr-4 font-medium">Persons count</th>
                      <th className="py-2 pr-4 font-medium">Membership count</th>
                      <th className="py-2 pr-4 font-medium">Status</th>
                      <th className="py-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((org) => (
                      <tr key={org.id} className="border-b align-top">
                        <td className="py-3 pr-4">
                          <p className="font-medium text-foreground">{org.name}</p>
                          <p className="text-xs text-muted-foreground">{org.slug}</p>
                        </td>
                        <td className="py-3 pr-4">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={org.defaultMembershipFeeInput}
                            onChange={(e) =>
                              setList((prev) =>
                                prev.map((item) =>
                                  item.id === org.id
                                    ? { ...item, defaultMembershipFeeInput: e.target.value }
                                    : item
                                )
                              )
                            }
                            className="w-36"
                          />
                        </td>
                        <td className="py-3 pr-4 tabular-nums">{org.adminsCount}</td>
                        <td className="py-3 pr-4 tabular-nums">{org.usersCount}</td>
                        <td className="py-3 pr-4 tabular-nums">{org.personsCount}</td>
                        <td className="py-3 pr-4 tabular-nums">{org.membershipsCount}</td>
                        <td className="py-3 pr-4">
                          {isSuperUser ? (
                            <label className="inline-flex items-center gap-2">
                              <Checkbox
                                checked={org.isActive}
                                onCheckedChange={(checked) =>
                                  setList((prev) =>
                                    prev.map((item) =>
                                      item.id === org.id ? { ...item, isActive: !!checked } : item
                                    )
                                  )
                                }
                              />
                              <span>{org.isActive ? "Active" : "Inactive"}</span>
                            </label>
                          ) : (
                            <span>{org.isActive ? "Active" : "Inactive"}</span>
                          )}
                        </td>
                        <td className="py-3">
                          <Button
                            size="sm"
                            onClick={() => handleSave(org.id)}
                            disabled={savingOrgId === org.id}
                          >
                            {savingOrgId === org.id ? "Saving…" : "Save"}
                          </Button>
                          {rowErrors[org.id] && (
                            <p className="text-xs text-destructive mt-2">{rowErrors[org.id]}</p>
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
      </main>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Organization</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Slug (lowercase, no spaces)</Label>
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
                placeholder="e.g. my-org"
              />
            </div>
            <div className="space-y-2">
              <Label>Default membership fee</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={defaultMembershipFee}
                onChange={(e) => setDefaultMembershipFee(e.target.value)}
              />
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <Checkbox checked={isActive} onCheckedChange={(checked) => setIsActive(!!checked)} />
              Active organization
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? "Creating…" : "Create"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
