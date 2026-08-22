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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Search, ChevronLeft, ChevronRight, Eye, Pencil, Archive, ArchiveRestore, AlertTriangle, Filter, X, MoreHorizontal, UserPlus, RefreshCw, UserRound } from "lucide-react";
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
  const [limit, setLimit] = useState(parseInt(searchParams.get("limit") || "10", 10));
  const [sort, setSort] = useState(searchParams.get("sort") || "recent");
  const [refreshKey, setRefreshKey] = useState(0);
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
    nextShowArchived = showArchived,
    nextSort = sort,
    nextLimit = limit
  ) {
    const params = new URLSearchParams();
    params.set("page", String(nextPage));
    params.set("limit", String(nextLimit));
    if (nextSort !== "recent") params.set("sort", nextSort);
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
    params.sort = sort;
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
    limit,
    sort,
    refreshKey,
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
              <span>View Member</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/members/${membership.id}/edit`} className="flex items-center gap-2">
              <Pencil className="h-4 w-4" />
              <span>Edit Member</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
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
                <span>Restore Member</span>
              </>
            ) : (
              <>
                <Archive className="mr-2 h-4 w-4" />
                <span>Archive Member</span>
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

  function applyQuickFilter(key: "membershipType" | "membershipStatus" | "areaCode", value: string) {
    const nextFilters = { ...appliedFilters, [key]: value === "__all__" ? "" : value };
    setFilters(nextFilters);
    setAppliedFilters(nextFilters);
    setPage(1);
    router.push(`/members?${buildQueryString(1, appliedQ, nextFilters, showArchived)}`);
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
    router.push(`/members?${buildQueryString(1, "", cleared, false)}`);
  }

  function applyAdvancedFilters() {
    setAppliedFilters(filters);
    setShowArchived(draftShowArchived);
    setPage(1);
    setFilterOpen(false);
    router.push(`/members?${buildQueryString(1, appliedQ, filters, draftShowArchived)}`);
  }

  function clearAdvancedFilters() {
    const cleared = {
      ...appliedFilters,
      paymentPeriod: "",
      isZakathEligible: "",
      disability: "",
      registeredFrom: "",
      registeredTo: "",
    };
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
  const memberLocation = (membership: Membership) => {
    if (membership.areaCode === undefined || membership.areaCode === null) return "Location not set";
    return zones.find((zone) => zone.code === Number(membership.areaCode))?.name ?? "Location not set";
  };
  const memberInitials = (membership: Membership) => {
    const words = memberDisplayName(membership)
      .replace(/[^A-Za-z\s]/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (words.length === 0) return "M";
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
  };
  const registeredDateLabel = (value?: string | null) => value
    ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "—";
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
  const advancedFilterCount = [
    appliedFilters.paymentPeriod,
    appliedFilters.isZakathEligible,
    appliedFilters.disability,
    appliedFilters.registeredFrom,
    appliedFilters.registeredTo,
    showArchived ? "true" : "",
  ].filter(Boolean).length;
  const resultFrom = total === 0 ? 0 : (page - 1) * limit + 1;
  const resultTo = Math.min(page * limit, total);

  if (authLoading || !user) return <div className="p-8 text-muted-foreground">Loading…</div>;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-7xl p-4 md:p-6">
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

        <Card className="overflow-hidden">
          <CardHeader className="pb-2 md:hidden">
            <CardTitle className="text-sm font-medium">Search Memberships</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4 md:p-5">
            <form onSubmit={handleSearch} className="space-y-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search by member, membership ID, or name..."
                    value={qInput}
                    onChange={(e) => setQInput(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Button type="submit" variant="secondary" className="md:hidden">
                  <Search className="h-4 w-4 mr-1" />
                  Search
                </Button>
                <div className="hidden w-36 md:block">
                  <Select value={appliedFilters.membershipType || "__all__"} onValueChange={(value) => applyQuickFilter("membershipType", value)}>
                    <SelectTrigger><SelectValue placeholder="All types" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All types</SelectItem>
                      {MEMBERSHIP_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="hidden w-40 md:block">
                  <Select value={appliedFilters.areaCode || "__all__"} onValueChange={(value) => applyQuickFilter("areaCode", value)}>
                    <SelectTrigger><SelectValue placeholder="All zones" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All zones</SelectItem>
                      {zones.filter((zone) => zone.code >= 1 && zone.code <= 9).map((zone) => (
                        <SelectItem key={zone.id} value={String(zone.code)}>{zone.code} - {zone.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="hidden w-32 md:block">
                  <Select value={appliedFilters.membershipStatus || "__all__"} onValueChange={(value) => applyQuickFilter("membershipStatus", value)}>
                    <SelectTrigger><SelectValue placeholder="All statuses" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All statuses</SelectItem>
                      {MEMBERSHIP_STATUSES.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="hidden w-48 md:block">
                  <Select
                    value={sort}
                    onValueChange={(value) => {
                      setSort(value);
                      setPage(1);
                      router.push(`/members?${buildQueryString(1, appliedQ, appliedFilters, showArchived, value)}`);
                    }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="recent">Recently Registered</SelectItem>
                      <SelectItem value="name_asc">Name A–Z</SelectItem>
                      <SelectItem value="name_desc">Name Z–A</SelectItem>
                      <SelectItem value="oldest">Oldest Registered</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="relative" ref={filterRef}>
                  <Button
                    type="button"
                    variant={advancedFilterCount > 0 ? "default" : "outline"}
                    className="gap-1.5"
                    onClick={() => setFilterOpen((open) => !open)}
                  >
                    <Filter className="h-4 w-4" />
                    Filters
                    {advancedFilterCount > 0 && (
                      <span className="rounded-full bg-background/90 px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
                        {advancedFilterCount}
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
                        <div className="space-y-1.5 md:hidden">
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

                        <div className="space-y-1.5 md:hidden">
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

                        <div className="space-y-1.5 md:hidden">
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
                          {advancedFilterCount > 0
                            ? `${advancedFilterCount} filter${advancedFilterCount === 1 ? "" : "s"} applied`
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

            <div className="hidden items-center justify-between border-t border-slate-200 pt-4 md:flex">
              <span className="text-sm font-medium text-slate-700">
                {total} {total === 1 ? "Member" : "Members"}
              </span>
              <Button type="button" variant="ghost" size="sm" className="gap-2 text-muted-foreground" disabled={loading} onClick={() => setRefreshKey((key) => key + 1)}>
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>

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
                <div className="hidden overflow-x-auto rounded-lg border border-slate-200 md:block">
                  <table className="min-w-[900px] w-full text-sm">
                    <thead className="bg-slate-50/80">
                      <tr>
                        <th className="w-[31%] px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">Member</th>
                        <th className="w-[25%] px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">Full Name</th>
                        <th className="w-[14%] px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">Type</th>
                        <th className="w-[12%] px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">Status</th>
                        <th className="w-[13%] px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">Registered</th>
                        <th className="w-[5%] px-4 py-3 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {items.map((m) => (
                        <tr
                          key={m.id}
                          className="cursor-pointer transition-colors hover:bg-slate-50/70"
                          onClick={() => openMembershipDetails(m.id)}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-emerald-600">
                                {memberInitials(m)}
                              </span>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className={`truncate font-semibold text-slate-900 ${(m as any).isArchived ? "opacity-60" : ""}`}>
                                    {memberDisplayName(m)}
                                  </span>
                                {(m as any).isArchived && (
                                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-medium text-amber-700">Archived</span>
                                )}
                                </div>
                                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                  {membershipIdOnly(m.membershipNo) ? `ID: ${membershipIdOnly(m.membershipNo)} · ` : ""}{memberLocation(m)}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {memberFullName(m)}
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-2 text-xs text-slate-700">
                              <span className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500">
                                <UserRound className="h-3.5 w-3.5" />
                              </span>
                              {m.membershipType}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium ${
                                m.membershipStatus === "Active"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-red-200 bg-red-50 text-red-700"
                              }`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  m.membershipStatus === "Active" ? "bg-emerald-500" : "bg-red-500"
                                }`}
                              />
                              {m.membershipStatus}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-700">
                            {registeredDateLabel(m.dateOfRegistration)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="inline-flex" onClick={(e) => e.stopPropagation()}>
                              <MembershipActions membership={m} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                  <span>Showing {resultFrom}–{resultTo} of {total}</span>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="hidden items-center gap-2 md:flex">
                      <span className="text-xs">Rows per page</span>
                      <Select
                        value={String(limit)}
                        onValueChange={(value) => {
                          const nextLimit = Number(value);
                          setLimit(nextLimit);
                          setPage(1);
                          router.push(`/members?${buildQueryString(1, appliedQ, appliedFilters, showArchived, sort, nextLimit)}`);
                        }}
                      >
                        <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="10">10</SelectItem>
                          <SelectItem value="25">25</SelectItem>
                          <SelectItem value="50">50</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <span className="min-w-[90px] text-center text-xs">Page {page} of {totalPages}</span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={page <= 1}
                      onClick={() => {
                        const nextPage = Math.max(1, page - 1);
                        setPage(nextPage);
                        router.push(`/members?${buildQueryString(nextPage)}`);
                      }}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
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
