"use client";

import Link from "next/link";
import { useTranslation } from "@/lib/i18n";
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
import { Plus, Eye, Pencil } from "lucide-react";
import { Header } from "@/components/header";
import { Breadcrumb } from "@/components/breadcrumb";
import { dashboardFlowHref } from "@/lib/dashboard-flows";

type OrgRow = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  adminsCount: number;
  usersCount: number;
};

function normalizeOrg(org: Organization): OrgRow {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    isActive: org.isActive ?? true,
    adminsCount: org.adminsCount ?? 0,
    usersCount: org.usersCount ?? 0,
  };
}

export default function OrganizationsPage() {
  const { t } = useTranslation();
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

  if (authLoading || !user) return <div className="p-8 text-muted-foreground">{t("common.loading")}</div>;
  if (!isSuperUser && !isAdmin) {
    router.replace("/");
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="p-6 max-w-7xl mx-auto">
        <Breadcrumb items={[{ label: t("dashboard.title"), href: dashboardFlowHref("admin") }, { label: t("organizations.title") }]} />
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-xl font-semibold text-foreground">{t("organizations.title")}</h1>
          {isSuperUser && (
            <Button size="sm" className="gap-1.5" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              {t("organizations.addOrganization")}
            </Button>
          )}
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{isSuperUser ? t("organizations.allOrganizations") : t("organizations.organizationDetails")}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
            ) : list.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("organizations.noOrganizationsFound")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">{t("organizations.organization")}</th>
                      <th className="py-2 pr-4 font-medium">{t("organizations.admins")}</th>
                      <th className="py-2 pr-4 font-medium">{t("organizations.users")}</th>
                      <th className="py-2 pr-4 font-medium">{t("common.status")}</th>
                      <th className="py-2 font-medium text-right">{t("common.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((org) => (
                      <tr key={org.id} className="border-b">
                        <td className="py-3 pr-4">
                          <p className="font-medium text-foreground">{org.name}</p>
                          <p className="text-xs text-muted-foreground">{org.slug}</p>
                        </td>
                        <td className="py-3 pr-4 tabular-nums">{org.adminsCount}</td>
                        <td className="py-3 pr-4 tabular-nums">{org.usersCount}</td>
                        <td className="py-3 pr-4">
                          <span className={`text-xs px-2 py-0.5 rounded ${org.isActive ? "bg-green-500/20 text-green-700" : "bg-red-500/20 text-red-700"}`}>
                            {org.isActive ? t("common.active") : t("common.inactive")}
                          </span>
                        </td>
                        <td className="py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Link
                              href={`/organizations/${org.id}`}
                              className="p-2 rounded-md hover:bg-accent transition-colors"
                              title={t("common.view")}
                            >
                              <Eye className="h-4 w-4 text-muted-foreground" />
                            </Link>
                            <Link
                              href={`/organizations/${org.id}?edit=true`}
                              className="p-2 rounded-md hover:bg-accent transition-colors"
                              title={t("common.edit")}
                            >
                              <Pencil className="h-4 w-4 text-muted-foreground" />
                            </Link>
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("organizations.addOrganization")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label>{t("organizations.name")}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>{t("organizations.slugHint")}</Label>
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
                placeholder="e.g. my-org"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("organizations.defaultMembershipFee")}</Label>
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
              {t("organizations.activeOrganization")}
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? t("common.creating") : t("common.create")}
              </Button>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
