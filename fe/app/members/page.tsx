"use client";

import { Suspense } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, type Membership, type MembershipStatus, type Zone } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Search, ChevronLeft, ChevronRight, Eye, Pencil, Archive, ArchiveRestore, AlertTriangle, Filter, X, MoreHorizontal, UserPlus } from "lucide-react";
import { Header } from "@/components/header";
import { Breadcrumb } from "@/components/breadcrumb";
import { toast } from "@/hooks/use-toast";
import { dashboardFlowHref } from "@/lib/dashboard-flows";
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

const MEMBERSHIP_TYPES = ["Resident", "NonResident", "Widow", "Widower"] as const;
const MEMBERSHIP_STATUSES: MembershipStatus[] = ["Active", "Inactive"];
const PAYMENT_PERIODS = ["Monthly", "Quarterly", "Annually"] as const;

type MembershipFilters = {
  membershipType: string;
  membershipStatus: string;
  paymentPeriod: string;
  areaCode: string;
  isZakathEligible: string;
  disability: string;
  registeredFrom: string;
  registeredTo: string;
};

function emptyFilters(): MembershipFilters {
  return {
    membershipType: "",
    membershipStatus: "",
    paymentPeriod: "",
    areaCode: "",
    isZakathEligible: "",
    disability: "",
    registeredFrom: "",
    registeredTo: "",
  };
}

function filtersFromSearchParams(searchParams: URLSearchParams): MembershipFilters {
  return {
    membershipType: searchParams.get("membershipType") || "",
    membershipStatus: searchParams.get("membershipStatus") || "",
    paymentPeriod: searchParams.get("paymentPeriod") || "",
    areaCode: searchParams.get("areaCode") || "",
    isZakathEligible: searchParams.get("isZakathEligible") || "",
    disability: searchParams.get("disability") || "",
    registeredFrom: searchParams.get("registeredFrom") || "",
    registeredTo: searchParams.get("registeredTo") || "",
  };
}

type AppliedFilterPill = {
  key: "q" | keyof MembershipFilters | "includeArchived";
  label: string;
};

function MembersContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<Membership[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [qInput, setQInput] = useState(searchParams.get("q") || "");
  const [appliedQ, setAppliedQ] = useState(searchParams.get("q") || "");
  const [page, setPage] = useState(parseInt(searchParams.get("page") || "1", 10));
  const limit = 10;
  const [showArchived, setShowArchived] = useState(searchParams.get("includeArchived") === "true");
  const [filters, setFilters] = useState<MembershipFilters>(() => filtersFromSearchParams(searchParams));
  const [appliedFilters, setAppliedFilters] = useState<MembershipFilters>(() => filtersFromSearchParams(searchParams));
  const [filterOpen, setFilterOpen] = useState(false);
  const [draftShowArchived, setDraftShowArchived] = useState(searchParams.get("includeArchived") === "true");
  const [zones, setZones] = useState<Zone[]>([]);
  const [archiveTarget, setArchiveTarget] = useState<Membership | null>(null);
  const effectiveOrgId = user?.organizationId ?? null;
  const filterRef = useRef<HTMLDivElement | null>(null);

  function isFilterPortalInteraction(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest("[data-radix-popper-content-wrapper]"));
  }

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!filterOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (isFilterPortalInteraction(event.target)) {
        return;
      }
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
    if (nextFilters.membershipType) params.set("membershipType", nextFilters.membershipType);
    if (nextFilters.membershipStatus) params.set("membershipStatus", nextFilters.membershipStatus);
    if (nextFilters.paymentPeriod) params.set("paymentPeriod", nextFilters.paymentPeriod);
    if (nextFilters.areaCode) params.set("areaCode", nextFilters.areaCode);
    if (nextFilters.isZakathEligible) params.set("isZakathEligible", nextFilters.isZakathEligible);
    if (nextFilters.disability) params.set("disability", nextFilters.disability);
    if (nextFilters.registeredFrom) params.set("registeredFrom", nextFilters.registeredFrom);
    if (nextFilters.registeredTo) params.set("registeredTo", nextFilters.registeredTo);
    return params.toString();
  }

  useEffect(() => {
    if (!user) return;
    const params: Record<string, string> = { page: String(page), limit: String(limit) };
    if (appliedQ) params.q = appliedQ;
    if (showArchived) params.includeArchived = "true";
    if (user.role === "super_user" && user.organizationId) params.organizationId = user.organizationId;
    if (appliedFilters.membershipType) params.membershipType = appliedFilters.membershipType;
    if (appliedFilters.membershipStatus) params.membershipStatus = appliedFilters.membershipStatus;
    if (appliedFilters.paymentPeriod) params.paymentPeriod = appliedFilters.paymentPeriod;
    if (appliedFilters.areaCode) params.areaCode = appliedFilters.areaCode;
    if (appliedFilters.isZakathEligible) params.isZakathEligible = appliedFilters.isZakathEligible;
    if (appliedFilters.disability) params.disability = appliedFilters.disability;
    if (appliedFilters.registeredFrom) params.registeredFrom = appliedFilters.registeredFrom;
    if (appliedFilters.registeredTo) params.registeredTo = appliedFilters.registeredTo;
    setLoading(true);
    api<{ items: Membership[]; total: number }>("/memberships", { params })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [
    user,
    page,
    appliedQ,
    showArchived,
    appliedFilters.membershipType,
    appliedFilters.membershipStatus,
    appliedFilters.paymentPeriod,
    appliedFilters.areaCode,
    appliedFilters.isZakathEligible,
    appliedFilters.disability,
    appliedFilters.registeredFrom,
    appliedFilters.registeredTo,
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

  function handleToggleArchive(m: Membership) {
    const newVal = !(m as any).isArchived;
    if (newVal) {
      setArchiveTarget(m);
      return;
    }
    doArchive(m, false);
  }

  function MembershipActions({ membership }: { membership: Membership }) {
    const archived = Boolean((membership as any).isArchived);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Open actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/members/${membership.id}`} className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              <span>View</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/members/${membership.id}/edit`} className="flex items-center gap-2">
              <Pencil className="h-4 w-4" />
              <span>Edit</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => handleToggleArchive(membership)}
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

  function openMembershipDetails(membershipId: string) {
    router.push(`/members/${membershipId}`);
  }

  async function doArchive(m: Membership, isArchived: boolean) {
    try {
      await api(`/memberships/${m.id}/archive`, {
        method: "PATCH",
        body: JSON.stringify({ isArchived }),
      });
      toast({ title: isArchived ? "Membership archived" : "Membership restored" });
      setItems((prev) => showArchived
        ? prev.map((i) => (i.id === m.id ? { ...i, isArchived } as any : i))
        : prev.filter((i) => i.id !== m.id)
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

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setAppliedQ(qInput);
    setPage(1);
    router.push(`/members?${buildQueryString(1, qInput, appliedFilters, showArchived)}`);
  }

  function handleClearFilters() {
    const cleared = emptyFilters();
    setQInput("");
    setAppliedQ("");
    setFilters(cleared);
    setAppliedFilters(cleared);
    setShowArchived(false);
    setDraftShowArchived(false);
    setFilterOpen(false);
    setPage(1);
    router.push("/members?page=1");
  }

  function applyAdvancedFilters() {
    setAppliedFilters(filters);
    setShowArchived(draftShowArchived);
    setPage(1);
    setFilterOpen(false);
    router.push(`/members?${buildQueryString(1, appliedQ, filters, draftShowArchived)}`);
  }

  function clearAdvancedFilters() {
    const cleared = emptyFilters();
    setFilters(cleared);
    setAppliedFilters(cleared);
    setShowArchived(false);
    setDraftShowArchived(false);
    setPage(1);
    setFilterOpen(false);
    router.push(`/members?${buildQueryString(1, appliedQ, cleared, false)}`);
  }

  function removeAppliedFilter(key: AppliedFilterPill["key"]) {
    if (key === "q") {
      setQInput("");
      setAppliedQ("");
      setPage(1);
      router.push(`/members?${buildQueryString(1, "", appliedFilters, showArchived)}`);
      return;
    }

    if (key === "includeArchived") {
      setShowArchived(false);
      setPage(1);
      router.push(`/members?${buildQueryString(1, appliedQ, appliedFilters, false)}`);
      return;
    }

    const nextFilters = { ...appliedFilters, [key]: "" };
    setFilters((prev) => ({ ...prev, [key]: "" }));
    setAppliedFilters(nextFilters);
    setPage(1);
    router.push(`/members?${buildQueryString(1, appliedQ, nextFilters, showArchived)}`);
  }

  const totalPages = Math.ceil(total / limit) || 1;
  const zoneLabel = (areaCode: string) => {
    const zone = zones.find((item) => String(item.code) === areaCode);
    return zone ? `${zone.code} - ${zone.name}` : areaCode;
  };
  const membershipIdOnly = (membershipNo: string | null | undefined) => {
    const normalized = membershipNo?.trim();
    if (!normalized) return null;
    const match = normalized.match(/(\d+)\s*$/);
    return match?.[1] ?? normalized;
  };
  const memberDisplayName = (membership: Membership) =>
    membership.hod?.nameWithInitials ?? membership.hod?.fullName ?? membership.hodPersonId;
  const memberFullName = (membership: Membership) =>
    membership.hod?.fullName ?? membership.hod?.nameWithInitials ?? membership.hodPersonId;
  const memberZone = (membership: Membership) =>
    membership.areaCode !== undefined && membership.areaCode !== null
      ? zoneLabel(String(membership.areaCode))
      : null;
  const appliedPills: AppliedFilterPill[] = [];
  if (appliedQ) appliedPills.push({ key: "q", label: `Search: ${appliedQ}` });
  if (appliedFilters.membershipType) {
    appliedPills.push({ key: "membershipType", label: `Type: ${appliedFilters.membershipType}` });
  }
  if (appliedFilters.membershipStatus) {
    appliedPills.push({ key: "membershipStatus", label: `Status: ${appliedFilters.membershipStatus}` });
  }
  if (appliedFilters.paymentPeriod) {
    appliedPills.push({ key: "paymentPeriod", label: `Period: ${appliedFilters.paymentPeriod}` });
  }
  if (appliedFilters.areaCode) {
    appliedPills.push({ key: "areaCode", label: `Zone: ${zoneLabel(appliedFilters.areaCode)}` });
  }
  if (appliedFilters.isZakathEligible) {
    const zakathMap: Record<string, string> = { true: "Yes", false: "No", unset: "Not Set" };
    appliedPills.push({
      key: "isZakathEligible",
      label: `Zakath: ${zakathMap[appliedFilters.isZakathEligible] ?? appliedFilters.isZakathEligible}`,
    });
  }
  if (appliedFilters.disability) {
    appliedPills.push({
      key: "disability",
      label: `Disability: ${appliedFilters.disability === "true" ? "Yes" : "No"}`,
    });
  }
  if (appliedFilters.registeredFrom) {
    appliedPills.push({ key: "registeredFrom", label: `From: ${appliedFilters.registeredFrom}` });
  }
  if (appliedFilters.registeredTo) {
    appliedPills.push({ key: "registeredTo", label: `To: ${appliedFilters.registeredTo}` });
  }
  if (showArchived) {
    appliedPills.push({ key: "includeArchived", label: "Archived included" });
  }
  const appliedFilterCount = appliedPills.length;

  if (authLoading || !user) return <div className="p-8 text-muted-foreground">Loading…</div>;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="p-6 max-w-4xl mx-auto">
        <Breadcrumb items={[{ label: "Dashboard", href: dashboardFlowHref("membership") }, { label: "Members" }]} />

        <div className="flex items-center justify-between mb-5">
          <h1 className="text-xl font-semibold text-foreground">Members</h1>
          <Link href="/members/new">
            <Button size="sm" variant="addNew" className="gap-1.5">
              <UserPlus className="h-4 w-4" />
              New Member
            </Button>
          </Link>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Search Memberships</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleSearch} className="space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  placeholder="Search by membership no or head of household..."
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
                    <div className="absolute right-0 z-50 mt-2 w-[min(92vw,28rem)] rounded-xl border border-border/80 bg-popover p-4 shadow-xl">
                      <div className="mb-3 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-foreground">Advanced Filters</p>
                          <p className="text-xs text-muted-foreground">
                            Combine any filters to narrow memberships.
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
                          <p className="text-xs font-medium text-muted-foreground">Membership Type</p>
                          <Select
                            value={filters.membershipType || "__all__"}
                            onValueChange={(value) =>
                              setFilters((prev) => ({ ...prev, membershipType: value === "__all__" ? "" : value }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Any type" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__all__">Any type</SelectItem>
                              {MEMBERSHIP_TYPES.map((type) => (
                                <SelectItem key={type} value={type}>
                                  {type}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-xs font-medium text-muted-foreground">Membership Status</p>
                          <Select
                            value={filters.membershipStatus || "__all__"}
                            onValueChange={(value) =>
                              setFilters((prev) => ({ ...prev, membershipStatus: value === "__all__" ? "" : value }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Any status" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__all__">Any status</SelectItem>
                              {MEMBERSHIP_STATUSES.map((status) => (
                                <SelectItem key={status} value={status}>
                                  {status}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-xs font-medium text-muted-foreground">Payment Period</p>
                          <Select
                            value={filters.paymentPeriod || "__all__"}
                            onValueChange={(value) =>
                              setFilters((prev) => ({ ...prev, paymentPeriod: value === "__all__" ? "" : value }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Any period" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__all__">Any period</SelectItem>
                              {PAYMENT_PERIODS.map((period) => (
                                <SelectItem key={period} value={period}>
                                  {period}
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
                              {zones
                                .filter((zone) => zone.code >= 1 && zone.code <= 9)
                                .map((zone) => (
                                <SelectItem key={zone.id} value={String(zone.code)}>
                                  {zone.code} - {zone.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-xs font-medium text-muted-foreground">Zakath Eligible</p>
                          <Select
                            value={filters.isZakathEligible || "__all__"}
                            onValueChange={(value) =>
                              setFilters((prev) => ({
                                ...prev,
                                isZakathEligible: value === "__all__" ? "" : value,
                              }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Any" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__all__">Any</SelectItem>
                              <SelectItem value="true">Yes</SelectItem>
                              <SelectItem value="false">No</SelectItem>
                              <SelectItem value="unset">Not Set</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-xs font-medium text-muted-foreground">Disability</p>
                          <Select
                            value={filters.disability || "__all__"}
                            onValueChange={(value) =>
                              setFilters((prev) => ({ ...prev, disability: value === "__all__" ? "" : value }))
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
                          <p className="text-xs font-medium text-muted-foreground">Registered From</p>
                          <Input
                            type="date"
                            value={filters.registeredFrom}
                            onChange={(e) =>
                              setFilters((prev) => ({ ...prev, registeredFrom: e.target.value }))
                            }
                          />
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-xs font-medium text-muted-foreground">Registered To</p>
                          <Input
                            type="date"
                            value={filters.registeredTo}
                            onChange={(e) =>
                              setFilters((prev) => ({ ...prev, registeredTo: e.target.value }))
                            }
                          />
                        </div>

                        <div className="space-y-1.5 sm:col-span-2">
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
                  <Button type="button" variant="ghost" onClick={handleClearFilters} className="sm:ml-auto">
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

            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <>
                <div className="space-y-3 md:hidden">
                  {items.map((m) => (
                    <div
                      key={m.id}
                      className="rounded-md border p-3 bg-card cursor-pointer transition-colors hover:bg-muted/30"
                      onClick={() => openMembershipDetails(m.id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium break-words">
                            {memberDisplayName(m)}
                          </p>
                          {memberZone(m) && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Zone: {memberZone(m)}
                            </p>
                          )}
                          {membershipIdOnly(m.membershipNo) && (
                            <p className="text-xs text-muted-foreground">
                              ID: {membershipIdOnly(m.membershipNo)}
                            </p>
                          )}
                        </div>
                        <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                          <MembershipActions membership={m} />
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                        <div>
                          <p className="text-muted-foreground">Type</p>
                          <p className="font-medium">{m.membershipType}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Status</p>
                          <p>
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${
                                m.membershipStatus === "Active"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-red-200 bg-red-50 text-red-700"
                              }`}
                            >
                              <span
                                className={`h-2 w-2 rounded-full ${
                                  m.membershipStatus === "Active" ? "bg-emerald-500" : "bg-red-500"
                                }`}
                              />
                              {m.membershipStatus}
                            </span>
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Registered</p>
                          <p className="font-medium">
                            {m.dateOfRegistration
                              ? new Date(m.dateOfRegistration).toLocaleDateString()
                              : "—"}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="hidden md:block rounded-md border overflow-x-auto">
                  <table className="w-full text-sm min-w-[640px]">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-3 font-medium">Member</th>
                        <th className="text-left p-3 font-medium">Full Name</th>
                        <th className="text-left p-3 font-medium">Type</th>
                        <th className="text-left p-3 font-medium">Status</th>
                        <th className="text-left p-3 font-medium">Registered</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((m) => (
                        <tr
                          key={m.id}
                          className="border-t cursor-pointer transition-colors hover:bg-muted/30"
                          onClick={() => openMembershipDetails(m.id)}
                        >
                          <td className="p-3">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className={`${(m as any).isArchived ? "line-through opacity-60" : ""}`}>
                                  {memberDisplayName(m)}
                                </span>
                                {(m as any).isArchived && (
                                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">Archived</span>
                                )}
                              </div>
                              {memberZone(m) && (
                                <p className="text-xs text-muted-foreground">
                                  Zone: {memberZone(m)}
                                </p>
                              )}
                              {membershipIdOnly(m.membershipNo) && (
                                <p className="text-xs text-muted-foreground">
                                  ID: {membershipIdOnly(m.membershipNo)}
                                </p>
                              )}
                            </div>
                          </td>
                          <td className="p-3">
                            {memberFullName(m)}
                          </td>
                          <td className="p-3">{m.membershipType}</td>
                          <td className="p-3">
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                                m.membershipStatus === "Active"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-red-200 bg-red-50 text-red-700"
                              }`}
                            >
                              <span
                                className={`h-2 w-2 rounded-full ${
                                  m.membershipStatus === "Active" ? "bg-emerald-500" : "bg-red-500"
                                }`}
                              />
                              {m.membershipStatus}
                            </span>
                          </td>
                          <td className="p-3">
                            {m.dateOfRegistration
                              ? new Date(m.dateOfRegistration).toLocaleDateString()
                              : ""}
                          </td>
                          <td className="p-3">
                            <div onClick={(e) => e.stopPropagation()}>
                              <MembershipActions membership={m} />
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
                        router.push(`/members?${buildQueryString(nextPage)}`);
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
                        router.push(`/members?${buildQueryString(nextPage)}`);
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
      </main>

      <AlertDialog open={!!archiveTarget} onOpenChange={(open) => !open && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Archive Membership
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to archive the membership for <strong>{archiveTarget?.hod?.fullName ?? archiveTarget?.membershipNo}</strong>? It will be hidden from all lists until restored.
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

export default function MembersPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background p-8 text-muted-foreground">Loading…</div>}>
      <MembersContent />
    </Suspense>
  );
}
