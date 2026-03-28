"use client";

import { Suspense } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, type Person, type Zone } from "@/lib/api";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Search, Plus, ChevronLeft, ChevronRight, Eye, Pencil, Archive, ArchiveRestore, AlertTriangle, MoreHorizontal, Filter, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Header } from "@/components/header";
import { Breadcrumb } from "@/components/breadcrumb";
import { PersonForm, type PersonFormData } from "@/components/person-form";
import { RESIDENT_TYPES } from "@/lib/constants";
import { toast } from "@/hooks/use-toast";

const LIVING_STATUS_OPTIONS = ["Active", "Deceased", "PermanentlyRelocated"] as const;

type PersonFilters = {
  residentType: string;
  livingStatus: string;
  areaCode: string;
  isMadarasaStudent: string;
  hasMembership: string;
};

function emptyPersonFilters(): PersonFilters {
  return {
    residentType: "",
    livingStatus: "",
    areaCode: "",
    isMadarasaStudent: "",
    hasMembership: "",
  };
}

function personFiltersFromSearchParams(searchParams: URLSearchParams): PersonFilters {
  return {
    residentType: searchParams.get("residentType") || "",
    livingStatus: searchParams.get("livingStatus") || "",
    areaCode: searchParams.get("areaCode") || "",
    isMadarasaStudent: searchParams.get("isMadarasaStudent") || "",
    hasMembership: searchParams.get("hasMembership") || "",
  };
}

type AppliedPersonPill = {
  key: "q" | keyof PersonFilters | "includeArchived";
  label: string;
};

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
  const [qInput, setQInput] = useState(searchParams.get("q") || "");
  const [appliedQ, setAppliedQ] = useState(searchParams.get("q") || "");
  const [page, setPage] = useState(parseInt(searchParams.get("page") || "1", 10));
  const limit = 10;

  const [orgs, setOrgs] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const effectiveOrgId =
    user?.role === "super_user" ? selectedOrgId : (user?.organizationId ?? null);

  const [showArchived, setShowArchived] = useState(searchParams.get("includeArchived") === "true");
  const [filters, setFilters] = useState<PersonFilters>(() => personFiltersFromSearchParams(searchParams));
  const [appliedFilters, setAppliedFilters] = useState<PersonFilters>(() => personFiltersFromSearchParams(searchParams));
  const [filterOpen, setFilterOpen] = useState(false);
  const [draftShowArchived, setDraftShowArchived] = useState(searchParams.get("includeArchived") === "true");
  const [zones, setZones] = useState<Zone[]>([]);

  const [addOpen, setAddOpen] = useState(false);
  const [editPerson, setEditPerson] = useState<{
    id: string;
    initial?: Partial<PersonFormData>;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<Person | null>(null);
  const filterRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  function buildQueryString(
    nextPage: number,
    nextQ = appliedQ,
    nextFilters = appliedFilters,
    nextShowArchived = showArchived
  ) {
    const params = new URLSearchParams();
    params.set("page", String(nextPage));
    if (nextQ) params.set("q", nextQ);
    if (nextShowArchived) params.set("includeArchived", "true");
    if (nextFilters.residentType) params.set("residentType", nextFilters.residentType);
    if (nextFilters.livingStatus) params.set("livingStatus", nextFilters.livingStatus);
    if (nextFilters.areaCode) params.set("areaCode", nextFilters.areaCode);
    if (nextFilters.isMadarasaStudent) params.set("isMadarasaStudent", nextFilters.isMadarasaStudent);
    if (nextFilters.hasMembership) params.set("hasMembership", nextFilters.hasMembership);
    return params.toString();
  }

  useEffect(() => {
    if (!filterOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (!filterRef.current?.contains(event.target as Node)) {
        setFilterOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setFilterOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [filterOpen]);

  useEffect(() => {
    if (!filterOpen) return;
    setFilters(appliedFilters);
    setDraftShowArchived(showArchived);
  }, [filterOpen, appliedFilters, showArchived]);

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
    if (appliedQ) params.q = appliedQ;
    if (showArchived) params.includeArchived = "true";
    if (appliedFilters.residentType) params.residentType = appliedFilters.residentType;
    if (appliedFilters.livingStatus) params.livingStatus = appliedFilters.livingStatus;
    if (appliedFilters.areaCode) params.areaCode = appliedFilters.areaCode;
    if (appliedFilters.isMadarasaStudent) params.isMadarasaStudent = appliedFilters.isMadarasaStudent;
    if (appliedFilters.hasMembership) params.hasMembership = appliedFilters.hasMembership;
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
  }, [
    user,
    page,
    appliedQ,
    effectiveOrgId,
    showArchived,
    appliedFilters.residentType,
    appliedFilters.livingStatus,
    appliedFilters.areaCode,
    appliedFilters.isMadarasaStudent,
    appliedFilters.hasMembership,
  ]);

  useEffect(() => {
    if (!effectiveOrgId) {
      setZones([]);
      return;
    }
    const params: Record<string, string> = { includeInactive: "true" };
    if (user?.role === "super_user") params.organizationId = effectiveOrgId;
    api<Zone[]>("/zones", { params })
      .then(setZones)
      .catch(() => setZones([]));
  }, [effectiveOrgId, user?.role]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setAppliedQ(qInput);
    setPage(1);
    router.push(`/persons?${buildQueryString(1, qInput, appliedFilters, showArchived)}`);
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
      areaCode: p.areaCode ? String(p.areaCode) : "",
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
        areaCode: data.areaCode ? Number(data.areaCode) : null,
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
      if (appliedQ) params.q = appliedQ;
      if (appliedFilters.residentType) params.residentType = appliedFilters.residentType;
      if (appliedFilters.livingStatus) params.livingStatus = appliedFilters.livingStatus;
      if (appliedFilters.areaCode) params.areaCode = appliedFilters.areaCode;
      if (appliedFilters.isMadarasaStudent) params.isMadarasaStudent = appliedFilters.isMadarasaStudent;
      if (appliedFilters.hasMembership) params.hasMembership = appliedFilters.hasMembership;
      if (showArchived) params.includeArchived = "true";
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
        areaCode: data.areaCode ? Number(data.areaCode) : null,
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

  function handleToggleArchive(p: Person) {
    const newVal = !(p as any).isArchived;
    if (newVal) {
      setArchiveTarget(p);
      return;
    }
    doArchive(p, false);
  }

  async function doArchive(p: Person, isArchived: boolean) {
    try {
      await api(`/persons/${p.id}/archive`, {
        method: "PATCH",
        body: JSON.stringify({ isArchived }),
      });
      toast({ title: isArchived ? "Person archived" : "Person restored" });
      setItems((prev) => showArchived
        ? prev.map((i) => (i.id === p.id ? { ...i, isArchived } as any : i))
        : prev.filter((i) => i.id !== p.id)
      );
      if (!showArchived && isArchived) setTotal((t) => Math.max(0, t - 1));
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed",
        description: err instanceof Error ? err.message : "Failed to update",
      });
    }
  }

  function applyAdvancedFilters() {
    setAppliedFilters(filters);
    setShowArchived(draftShowArchived);
    setPage(1);
    setFilterOpen(false);
    router.push(`/persons?${buildQueryString(1, appliedQ, filters, draftShowArchived)}`);
  }

  function clearAdvancedFilters() {
    const cleared = emptyPersonFilters();
    setFilters(cleared);
    setAppliedFilters(cleared);
    setShowArchived(false);
    setDraftShowArchived(false);
    setPage(1);
    setFilterOpen(false);
    router.push(`/persons?${buildQueryString(1, appliedQ, cleared, false)}`);
  }

  function handleClearAllFilters() {
    const cleared = emptyPersonFilters();
    setQInput("");
    setAppliedQ("");
    setFilters(cleared);
    setAppliedFilters(cleared);
    setShowArchived(false);
    setDraftShowArchived(false);
    setPage(1);
    setFilterOpen(false);
    router.push("/persons?page=1");
  }

  function removeAppliedFilter(key: AppliedPersonPill["key"]) {
    if (key === "q") {
      setQInput("");
      setAppliedQ("");
      setPage(1);
      router.push(`/persons?${buildQueryString(1, "", appliedFilters, showArchived)}`);
      return;
    }

    if (key === "includeArchived") {
      setShowArchived(false);
      setDraftShowArchived(false);
      setPage(1);
      router.push(`/persons?${buildQueryString(1, appliedQ, appliedFilters, false)}`);
      return;
    }

    const nextFilters = { ...appliedFilters, [key]: "" };
    setFilters((prev) => ({ ...prev, [key]: "" }));
    setAppliedFilters(nextFilters);
    setPage(1);
    router.push(`/persons?${buildQueryString(1, appliedQ, nextFilters, showArchived)}`);
  }

  function PersonActions({ person }: { person: Person }) {
    const archived = Boolean((person as any).isArchived);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Open actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/persons/${person.id}`} className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              <span>View</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openEdit(person)}>
            <Pencil className="mr-2 h-4 w-4" />
            <span>Edit</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => handleToggleArchive(person)}
            className={
              archived
                ? "text-emerald-700 focus:bg-emerald-50 focus:text-emerald-700"
                : "text-red-600 focus:bg-red-50 focus:text-red-700"
            }
          >
            {archived ? (
              <>
                <ArchiveRestore className="mr-2 h-4 w-4" />
                <span>Restore</span>
              </>
            ) : (
              <>
                <Archive className="mr-2 h-4 w-4" />
                <span>Archive</span>
              </>
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  function openPersonDetails(personId: string) {
    router.push(`/persons/${personId}`);
  }

  const zoneLabel = (areaCode: string) => {
    const zone = zones.find((item) => String(item.code) === areaCode);
    return zone ? `${zone.code} - ${zone.name}` : areaCode;
  };

  const appliedPills: AppliedPersonPill[] = [];
  if (appliedQ) appliedPills.push({ key: "q", label: `Search: ${appliedQ}` });
  if (appliedFilters.residentType) {
    const residentLabel = RESIDENT_TYPES.find((item) => item.value === appliedFilters.residentType)?.label ?? appliedFilters.residentType;
    appliedPills.push({ key: "residentType", label: `Resident Type: ${residentLabel}` });
  }
  if (appliedFilters.livingStatus) {
    appliedPills.push({ key: "livingStatus", label: `Status: ${appliedFilters.livingStatus}` });
  }
  if (appliedFilters.areaCode) {
    appliedPills.push({ key: "areaCode", label: `Zone: ${zoneLabel(appliedFilters.areaCode)}` });
  }
  if (appliedFilters.isMadarasaStudent) {
    appliedPills.push({
      key: "isMadarasaStudent",
      label: `Madarasa: ${appliedFilters.isMadarasaStudent === "true" ? "Yes" : "No"}`,
    });
  }
  if (appliedFilters.hasMembership) {
    appliedPills.push({
      key: "hasMembership",
      label: `Membership: ${appliedFilters.hasMembership === "true" ? "Linked" : "Not linked"}`,
    });
  }
  if (showArchived) appliedPills.push({ key: "includeArchived", label: "Archived included" });

  const totalPages = Math.ceil(total / limit) || 1;
  const appliedFilterCount = appliedPills.length;
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
            <form onSubmit={handleSearch} className="space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  placeholder="Search by name, NIC, email, mobile..."
                  value={qInput}
                  onChange={(e) => setQInput(e.target.value)}
                  className="sm:max-w-sm"
                />
                <Button type="submit" variant="secondary">
                  <Search className="h-4 w-4 mr-1" />
                  Search
                </Button>
                <div className="relative" ref={filterRef}>
                  <Button
                    type="button"
                    variant={appliedFilterCount > 0 ? "default" : "outline"}
                    className="gap-1.5"
                    onClick={() => setFilterOpen((open) => !open)}
                  >
                    <Filter className="h-4 w-4" />
                    Filters
                    {appliedFilterCount > 0 && (
                      <span className="rounded-full bg-background/90 px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
                        {appliedFilterCount}
                      </span>
                    )}
                  </Button>

                  {filterOpen && (
                    <div className="absolute right-0 z-50 mt-2 w-[min(92vw,26rem)] rounded-xl border border-border/80 bg-popover p-4 shadow-xl">
                      <div className="mb-3 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-foreground">Advanced Filters</p>
                          <p className="text-xs text-muted-foreground">
                            Narrow people by status, residency, and linked household info.
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => setFilterOpen(false)}
                          aria-label="Close filters"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <p className="text-xs font-medium text-muted-foreground">Resident Type</p>
                          <Select
                            value={filters.residentType || "__all__"}
                            onValueChange={(value) =>
                              setFilters((prev) => ({ ...prev, residentType: value === "__all__" ? "" : value }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Any type" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__all__">Any type</SelectItem>
                              {RESIDENT_TYPES.map((type) => (
                                <SelectItem key={type.value} value={type.value}>
                                  {type.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-xs font-medium text-muted-foreground">Living Status</p>
                          <Select
                            value={filters.livingStatus || "__all__"}
                            onValueChange={(value) =>
                              setFilters((prev) => ({ ...prev, livingStatus: value === "__all__" ? "" : value }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Any status" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__all__">Any status</SelectItem>
                              {LIVING_STATUS_OPTIONS.map((status) => (
                                <SelectItem key={status} value={status}>
                                  {status}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-xs font-medium text-muted-foreground">Zone</p>
                          <Select
                            value={filters.areaCode || "__all__"}
                            onValueChange={(value) =>
                              setFilters((prev) => ({ ...prev, areaCode: value === "__all__" ? "" : value }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Any zone" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__all__">Any zone</SelectItem>
                              {zones.map((zone) => (
                                <SelectItem key={zone.id} value={String(zone.code)}>
                                  {zone.code} - {zone.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-xs font-medium text-muted-foreground">Linked Membership</p>
                          <Select
                            value={filters.hasMembership || "__all__"}
                            onValueChange={(value) =>
                              setFilters((prev) => ({ ...prev, hasMembership: value === "__all__" ? "" : value }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Any" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__all__">Any</SelectItem>
                              <SelectItem value="true">Linked</SelectItem>
                              <SelectItem value="false">Not linked</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-xs font-medium text-muted-foreground">Madarasa Student</p>
                          <Select
                            value={filters.isMadarasaStudent || "__all__"}
                            onValueChange={(value) =>
                              setFilters((prev) => ({ ...prev, isMadarasaStudent: value === "__all__" ? "" : value }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Any" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__all__">Any</SelectItem>
                              <SelectItem value="true">Yes</SelectItem>
                              <SelectItem value="false">No</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-xs font-medium text-muted-foreground">Archived Records</p>
                          <Select
                            value={draftShowArchived ? "include" : "active_only"}
                            onValueChange={(value) => setDraftShowArchived(value === "include")}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="active_only">Active only</SelectItem>
                              <SelectItem value="include">Include archived</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="mt-4 flex items-center justify-between gap-2">
                        <p className="text-xs text-muted-foreground">
                          {appliedFilterCount > 0
                            ? `${appliedFilterCount} filter${appliedFilterCount === 1 ? "" : "s"} applied`
                            : "No filters applied yet"}
                        </p>
                        <div className="flex gap-2">
                          <Button type="button" variant="ghost" onClick={clearAdvancedFilters}>
                            Clear
                          </Button>
                          <Button type="button" onClick={applyAdvancedFilters}>
                            Apply
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                {appliedFilterCount > 0 && (
                  <Button type="button" variant="ghost" onClick={handleClearAllFilters} className="sm:ml-auto">
                    Clear All
                  </Button>
                )}
              </div>
            </form>

            {appliedPills.length > 0 && (
              <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
                {appliedPills.map((pill) => (
                  <button
                    key={`${pill.key}-${pill.label}`}
                    type="button"
                    onClick={() => removeAppliedFilter(pill.key)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    <span>{pill.label}</span>
                    <X className="h-3 w-3 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
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
                    <div
                      key={p.id}
                      className="rounded-md border p-3 bg-card cursor-pointer transition-colors hover:bg-muted/30"
                      onClick={() => openPersonDetails(p.id)}
                    >
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
                        <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                          <PersonActions person={p} />
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
                        <tr
                          key={p.id}
                          className="border-t cursor-pointer transition-colors hover:bg-muted/30"
                          onClick={() => openPersonDetails(p.id)}
                        >
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <Link
                                href={`/persons/${p.id}`}
                                className={`font-medium text-primary hover:underline ${(p as any).isArchived ? "line-through opacity-60" : ""}`}
                              >
                                {p.fullName}
                              </Link>
                              {(p as any).isArchived && (
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">Archived</span>
                              )}
                            </div>
                            <span className="text-muted-foreground text-xs ml-0">
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
                            <div onClick={(e) => e.stopPropagation()}>
                              <PersonActions person={p} />
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
                      onClick={() => {
                        const nextPage = Math.max(1, page - 1);
                        setPage(nextPage);
                        router.push(`/persons?${buildQueryString(nextPage)}`);
                      }}
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
                      onClick={() => {
                        const nextPage = Math.min(totalPages, page + 1);
                        setPage(nextPage);
                        router.push(`/persons?${buildQueryString(nextPage)}`);
                      }}
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
            zones={zones}
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
              zones={zones}
              onSubmit={handleEditPerson}
              onCancel={() => setEditPerson(null)}
              submitLabel={saving ? "Saving…" : "Save"}
              disabled={saving}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!archiveTarget} onOpenChange={(open) => !open && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Archive Person
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to archive <strong>{archiveTarget?.fullName}</strong>? They will be hidden from all lists until restored.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700"
              onClick={() => {
                if (archiveTarget) doArchive(archiveTarget, true);
                setArchiveTarget(null);
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
