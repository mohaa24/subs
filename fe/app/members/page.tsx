"use client";

import { Suspense } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type Membership } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, Plus, ChevronLeft, ChevronRight, Eye, Pencil, Archive, ArchiveRestore, AlertTriangle } from "lucide-react";
import { Header } from "@/components/header";
import { Breadcrumb } from "@/components/breadcrumb";
import { toast } from "@/hooks/use-toast";
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

function MembersContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<Membership[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(searchParams.get("q") || "");
  const [page, setPage] = useState(parseInt(searchParams.get("page") || "1", 10));
  const limit = 10;
  const [showArchived, setShowArchived] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Membership | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user) return;
    const params: Record<string, string> = { page: String(page), limit: String(limit) };
    if (q) params.q = q;
    if (showArchived) params.includeArchived = "true";
    if (user.role === "super_user" && user.organizationId) params.organizationId = user.organizationId;
    setLoading(true);
    api<{ items: Membership[]; total: number }>("/memberships", { params })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user, page, q, showArchived]);

  function handleToggleArchive(m: Membership) {
    const newVal = !(m as any).isArchived;
    if (newVal) {
      setArchiveTarget(m);
      return;
    }
    doArchive(m, false);
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
    setPage(1);
    const u = new URLSearchParams(searchParams);
    u.set("page", "1");
    if (q) u.set("q", q);
    else u.delete("q");
    router.push(`/members?${u.toString()}`);
  }

  const totalPages = Math.ceil(total / limit) || 1;

  if (authLoading || !user) return <div className="p-8 text-muted-foreground">Loading…</div>;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="p-6 max-w-4xl mx-auto">
        <Breadcrumb items={[{ label: "Dashboard", href: "/" }, { label: "Members" }]} />

        <div className="flex items-center justify-between mb-5">
          <h1 className="text-xl font-semibold text-foreground">Members</h1>
          <Link href="/members/new">
            <Button size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" />
              New Membership
            </Button>
          </Link>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Search Memberships</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleSearch} className="flex gap-2">
              <Input
                placeholder="Search by membership no or name..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="max-w-sm"
              />
              <Button type="submit" variant="secondary">
                <Search className="h-4 w-4 mr-1" />
                Search
              </Button>
              <Button
                type="button"
                variant={showArchived ? "default" : "outline"}
                size="sm"
                className="gap-1.5 ml-auto"
                onClick={() => { setShowArchived((v) => !v); setPage(1); }}
              >
                <Archive className="h-3.5 w-3.5" />
                {showArchived ? "Hide Archived" : "Show Archived"}
              </Button>
            </form>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <>
                <div className="space-y-3 md:hidden">
                  {items.map((m) => (
                    <div key={m.id} className="rounded-md border p-3 bg-card">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            href={`/members/${m.id}`}
                            className="font-medium text-primary hover:underline break-words"
                          >
                            {m.hod?.fullName ?? m.hodPersonId}
                          </Link>
                          <p className="text-xs text-muted-foreground mt-0.5">{m.membershipNo}</p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Link href={`/members/${m.id}`}>
                            <Button variant="ghost" size="sm" aria-label="View Membership">
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </Link>
                          <Link href={`/members/${m.id}/edit`}>
                            <Button variant="ghost" size="sm" aria-label="Edit Membership">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggleArchive(m)}
                            aria-label={(m as any).isArchived ? "Restore" : "Archive"}
                          >
                            {(m as any).isArchived ? <ArchiveRestore className="h-3.5 w-3.5 text-emerald-600" /> : <Archive className="h-3.5 w-3.5 text-amber-600" />}
                          </Button>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                        <div>
                          <p className="text-muted-foreground">Type</p>
                          <p className="font-medium">{m.membershipType}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Status</p>
                          <p className="font-medium">{m.membershipStatus}</p>
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
                        <th className="text-left p-3 font-medium">Name</th>
                        <th className="text-left p-3 font-medium">Membership No</th>
                        <th className="text-left p-3 font-medium">Type</th>
                        <th className="text-left p-3 font-medium">Status</th>
                        <th className="text-left p-3 font-medium">Registered</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((m) => (
                        <tr key={m.id} className="border-t">
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <Link
                                href={`/members/${m.id}`}
                                className={`font-medium text-primary hover:underline ${(m as any).isArchived ? "line-through opacity-60" : ""}`}
                              >
                                {m.hod?.fullName ?? m.hodPersonId}
                              </Link>
                              {(m as any).isArchived && (
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">Archived</span>
                              )}
                            </div>
                          </td>
                          <td className="p-3">{m.membershipNo}</td>
                          <td className="p-3">{m.membershipType}</td>
                          <td className="p-3">{m.membershipStatus}</td>
                          <td className="p-3">
                            {m.dateOfRegistration
                              ? new Date(m.dateOfRegistration).toLocaleDateString()
                              : ""}
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-1">
                              <Link href={`/members/${m.id}`}>
                                <Button variant="ghost" size="sm" aria-label="View Membership">
                                  <Eye className="h-3.5 w-3.5" />
                                </Button>
                              </Link>
                              <Link href={`/members/${m.id}/edit`}>
                                <Button variant="ghost" size="sm" aria-label="Edit Membership">
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              </Link>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleToggleArchive(m)}
                                aria-label={(m as any).isArchived ? "Restore" : "Archive"}
                                title={(m as any).isArchived ? "Restore" : "Archive"}
                              >
                                {(m as any).isArchived ? <ArchiveRestore className="h-3.5 w-3.5 text-emerald-600" /> : <Archive className="h-3.5 w-3.5 text-amber-600" />}
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
