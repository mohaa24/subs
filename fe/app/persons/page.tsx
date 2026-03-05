"use client";

import { Suspense } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type Person } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Search, Plus, ChevronLeft, ChevronRight, Pencil, Eye } from "lucide-react";
import { Header } from "@/components/header";
import { Breadcrumb } from "@/components/breadcrumb";
import { PersonForm, type PersonFormData } from "@/components/person-form";
import { RESIDENT_TYPES } from "@/lib/constants";
import { toast } from "@/hooks/use-toast";

function formatResidentType(value: string | null | undefined): string {
  if (!value) return "—";
  const found = RESIDENT_TYPES.find((r) => r.value === value);
  return found?.label ?? value;
}

function getAge(value: string | null | undefined): string {
  if (!value) return "—";
  const dob = new Date(value);
  if (Number.isNaN(dob.getTime())) return "—";
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age >= 0 ? String(age) : "—";
}

function PersonsPageContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<Person[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(searchParams.get("q") || "");
  const [page, setPage] = useState(parseInt(searchParams.get("page") || "1", 10));
  const limit = 10;

  const [orgs, setOrgs] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const effectiveOrgId =
    user?.role === "super_user" ? selectedOrgId : (user?.organizationId ?? null);

  const [addOpen, setAddOpen] = useState(false);
  const [editPerson, setEditPerson] = useState<{
    id: string;
    initial?: Partial<PersonFormData>;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user || user.role !== "super_user") return;
    api<{ id: string; name: string; slug: string }[]>("/organizations")
      .then(setOrgs)
      .catch(() => setOrgs([]));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (user.role !== "super_user" && !user.organizationId) return;
    if (user.role === "super_user" && !effectiveOrgId) {
      setItems([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    const params: Record<string, string> = {
      page: String(page),
      limit: String(limit),
      organizationId: effectiveOrgId!,
    };
    if (q) params.q = q;
    setLoading(true);
    api<{ items: Person[]; total: number }>("/persons", { params })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [user, page, q, effectiveOrgId]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    const u = new URLSearchParams(searchParams);
    u.set("page", "1");
    if (q) u.set("q", q);
    else u.delete("q");
    router.push(`/persons?${u.toString()}`);
  }

  function personToFormData(p: Person): Partial<PersonFormData> {
    return {
      title: p.title ?? "",
      nameWithInitials: p.nameWithInitials ?? "",
      fullName: p.fullName ?? "",
      preferredName: p.preferredName ?? "",
      residentType: p.residentType ?? "",
      gender: p.gender ?? "",
      identityType: p.identityType ?? "",
      nicNumber: p.nicNumber ?? "",
      idNumber: p.idNumber ?? "",
      dateOfBirth: p.dateOfBirth ? String(p.dateOfBirth).slice(0, 10) : "",
      bloodGroup: p.bloodGroup ?? "",
      maritalStatus: p.maritalStatus ?? "",
      address: p.address ?? "",
      mobileNumber: p.mobileNumber ?? "",
      whatsAppNumber: p.whatsAppNumber ?? "",
      email: p.email ?? "",
      occupation: p.occupation ?? "",
      placeOfWork: p.placeOfWork ?? "",
      highestQualificationType: p.highestQualificationType ?? "",
      highestQualificationTitle: p.highestQualificationTitle ?? "",
      permanentDisability: p.permanentDisability ?? "",
      livingStatus: p.livingStatus ?? "Active",
      isMadarasaStudent: p.isMadarasaStudent ?? false,
    };
  }

  async function handleCreatePerson(data: PersonFormData) {
    if (!effectiveOrgId) {
      const msg = "Please select an organization.";
      setError(msg);
      toast({
        variant: "destructive",
        title: "Cannot add person",
        description: msg,
      });
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        organizationId: effectiveOrgId,
        title: data.title || undefined,
        nameWithInitials: data.nameWithInitials,
        fullName: data.fullName,
        preferredName: data.preferredName || undefined,
        residentType: data.residentType || undefined,
        gender: data.gender || undefined,
        identityType: data.identityType || undefined,
        nicNumber: data.identityType === "NIC" ? data.nicNumber || undefined : null,
        idNumber: data.identityType && data.identityType !== "NIC" ? data.idNumber || undefined : null,
        dateOfBirth: data.dateOfBirth || undefined,
        bloodGroup: data.bloodGroup || undefined,
        maritalStatus: data.maritalStatus || undefined,
        address: data.address || undefined,
        mobileNumber: data.mobileNumber || undefined,
        whatsAppNumber: data.whatsAppNumber || undefined,
        email: data.email || undefined,
        occupation: data.occupation || undefined,
        placeOfWork: data.placeOfWork || undefined,
        highestQualificationType: data.highestQualificationType || undefined,
        highestQualificationTitle: data.highestQualificationTitle || undefined,
        permanentDisability: data.permanentDisability || undefined,
        livingStatus: data.livingStatus || undefined,
        isMadarasaStudent: data.isMadarasaStudent,
      };
      await api<Person>("/persons", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setAddOpen(false);
      setPage(1);
      const params: Record<string, string> = {
        page: "1",
        limit: String(limit),
        organizationId: effectiveOrgId,
      };
      if (q) params.q = q;
      const res = await api<{ items: Person[]; total: number }>("/persons", {
        params,
      });
      setItems(res.items);
      setTotal(res.total);
      toast({
        title: "Person added",
        description: "Person created successfully.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to add person";
      setError(msg);
      toast({
        variant: "destructive",
        title: "Failed to add person",
        description: msg,
      });
    } finally {
      setSaving(false);
    }
  }

  async function openEdit(p: Person) {
    setEditPerson({ id: p.id, initial: personToFormData(p) });
  }

  async function handleEditPerson(data: PersonFormData) {
    if (!editPerson) return;
    setSaving(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        title: data.title || undefined,
        nameWithInitials: data.nameWithInitials,
        fullName: data.fullName,
        preferredName: data.preferredName || undefined,
        residentType: data.residentType || undefined,
        gender: data.gender || undefined,
        identityType: data.identityType || undefined,
        nicNumber: data.identityType === "NIC" ? data.nicNumber || undefined : null,
        idNumber: data.identityType && data.identityType !== "NIC" ? data.idNumber || undefined : null,
        dateOfBirth: data.dateOfBirth || undefined,
        bloodGroup: data.bloodGroup || undefined,
        maritalStatus: data.maritalStatus || undefined,
        address: data.address || undefined,
        mobileNumber: data.mobileNumber || undefined,
        whatsAppNumber: data.whatsAppNumber || undefined,
        email: data.email || undefined,
        occupation: data.occupation || undefined,
        placeOfWork: data.placeOfWork || undefined,
        highestQualificationType: data.highestQualificationType || undefined,
        highestQualificationTitle: data.highestQualificationTitle || undefined,
        permanentDisability: data.permanentDisability || undefined,
        livingStatus: data.livingStatus || undefined,
        isMadarasaStudent: data.isMadarasaStudent,
      };
      const updated = await api<Person>(`/persons/${editPerson.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setItems((prev) =>
        prev.map((i) => (i.id === updated.id ? updated : i))
      );
      setEditPerson(null);
      toast({
        title: "Person updated",
        description: "Person details updated successfully.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update person";
      setError(msg);
      toast({
        variant: "destructive",
        title: "Failed to update person",
        description: msg,
      });
    } finally {
      setSaving(false);
    }
  }

  const totalPages = Math.ceil(total / limit) || 1;
  const isSuperUser = user?.role === "super_user";

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="p-6 max-w-5xl mx-auto">
        <Breadcrumb
          items={[{ label: "Dashboard", href: "/" }, { label: "Manage People" }]}
        />

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-5">
          <h1 className="text-xl font-semibold text-foreground">Manage People</h1>
          <div className="flex items-center gap-2">
            {isSuperUser && (
              <Select
                value={selectedOrgId}
                onValueChange={(v) => {
                  setSelectedOrgId(v);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select Organization" />
                </SelectTrigger>
                <SelectContent>
                  {orgs.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => setAddOpen(true)}
              disabled={!effectiveOrgId}
            >
              <Plus className="h-4 w-4" />
              Add Person
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Search People
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleSearch} className="flex gap-2">
              <Input
                placeholder="Search by name, NIC, email, mobile..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="max-w-sm"
              />
              <Button type="submit" variant="secondary">
                <Search className="h-4 w-4 mr-1" />
                Search
              </Button>
            </form>
            {!effectiveOrgId ? (
              <p className="text-sm text-muted-foreground">
                {isSuperUser
                  ? "Select an organization to view people."
                  : "No organization assigned."}
              </p>
            ) : loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <>
                <div className="space-y-3 md:hidden">
                  {items.map((p) => (
                    <div key={p.id} className="rounded-md border p-3 bg-card">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            href={`/persons/${p.id}`}
                            className="font-medium text-primary hover:underline break-words"
                          >
                            {p.fullName}
                          </Link>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {p.nameWithInitials}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Link href={`/persons/${p.id}`}>
                            <Button variant="ghost" size="sm" aria-label="View Person">
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(p)}
                            aria-label="Edit Person"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                        <div>
                          <p className="text-muted-foreground">Preferred Name</p>
                          <p className="font-medium">{p.preferredName ?? "—"}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Age</p>
                          <p className="font-medium">{getAge(p.dateOfBirth)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Resident Type</p>
                          <p className="font-medium">{formatResidentType(p.residentType)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Mobile</p>
                          <p className="font-medium">{p.mobileNumber ?? "—"}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Status</p>
                          <p className="font-medium">{p.livingStatus ?? "Active"}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="hidden md:block rounded-md border overflow-x-auto">
                  <table className="w-full text-sm min-w-[640px]">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-3 font-medium">Name</th>
                        <th className="text-left p-3 font-medium">Preferred Name</th>
                        <th className="text-left p-3 font-medium">Age</th>
                        <th className="text-left p-3 font-medium">Resident Type</th>
                        <th className="text-left p-3 font-medium">Mobile</th>
                        <th className="text-left p-3 font-medium">Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((p) => (
                        <tr key={p.id} className="border-t">
                          <td className="p-3">
                            <Link
                              href={`/persons/${p.id}`}
                              className="font-medium text-primary hover:underline"
                            >
                              {p.fullName}
                            </Link>
                            <span className="text-muted-foreground text-xs ml-1">
                              ({p.nameWithInitials})
                            </span>
                          </td>
                          <td className="p-3">{p.preferredName ?? "—"}</td>
                          <td className="p-3">{getAge(p.dateOfBirth)}</td>
                          <td className="p-3">
                            {formatResidentType(p.residentType)}
                          </td>
                          <td className="p-3">{p.mobileNumber ?? "—"}</td>
                          <td className="p-3">{p.livingStatus ?? "Active"}</td>
                          <td className="p-3">
                            <div className="flex items-center gap-1">
                              <Link href={`/persons/${p.id}`}>
                                <Button variant="ghost" size="sm" aria-label="View Person">
                                  <Eye className="h-3.5 w-3.5" />
                                </Button>
                              </Link>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openEdit(p)}
                                aria-label="Edit Person"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>
                    {total} result{total !== 1 ? "s" : ""}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span>
                      Page {page} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {error && (
          <p className="mt-3 text-sm text-destructive">{error}</p>
        )}
      </main>

      {/* Add person dialog */}
      <Dialog open={addOpen} onOpenChange={(o) => !o && setAddOpen(false)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Person</DialogTitle>
          </DialogHeader>
          <PersonForm
            onSubmit={handleCreatePerson}
            onCancel={() => setAddOpen(false)}
            submitLabel={saving ? "Adding…" : "Add Person"}
            disabled={saving}
          />
        </DialogContent>
      </Dialog>

      {/* Edit person dialog */}
      <Dialog
        open={!!editPerson}
        onOpenChange={(o) => !o && setEditPerson(null)}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Person</DialogTitle>
          </DialogHeader>
          {editPerson?.initial && (
            <PersonForm
              initial={editPerson.initial}
              onSubmit={handleEditPerson}
              onCancel={() => setEditPerson(null)}
              submitLabel={saving ? "Saving…" : "Save"}
              disabled={saving}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function PersonsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    }>
      <PersonsPageContent />
    </Suspense>
  );
}
