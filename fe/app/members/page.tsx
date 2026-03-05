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
import { Search, Plus, ChevronLeft, ChevronRight, Eye, Pencil } from "lucide-react";
import { Header } from "@/components/header";
import { Breadcrumb } from "@/components/breadcrumb";

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

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user) return;
    const params: Record<string, string> = { page: String(page), limit: String(limit) };
    if (q) params.q = q;
    if (user.role === "super_user" && user.organizationId) params.organizationId = user.organizationId;
    setLoading(true);
    api<{ items: Membership[]; total: number }>("/memberships", { params })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user, page, q]);

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
                            <Link
                              href={`/members/${m.id}`}
                              className="font-medium text-primary hover:underline"
                            >
                              {m.hod?.fullName ?? m.hodPersonId}
                            </Link>
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
