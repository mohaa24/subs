"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Search, ShieldCheck } from "lucide-react";
import { Header } from "@/components/header";
import { AbstractBg } from "@/components/abstract-bg";
import { Breadcrumb } from "@/components/breadcrumb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth-context";
import { api, type AuditLogPage } from "@/lib/api";

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function label(value: string) {
  return value.replace(/^finance\./, "").replace(/_/g, " ").replace(/\./g, " · ");
}

export default function AuditLogPageView() {
  const { user, loading } = useAuth();
  const [data, setData] = useState<AuditLogPage | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("all");
  const [entityType, setEntityType] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user || (user.role !== "admin" && user.role !== "super_user")) return;
    setIsLoading(true);
    setError("");
    try {
      const params: Record<string, string> = { page: String(page), limit: "25" };
      if (search) params.q = search;
      if (action !== "all") params.action = action;
      if (entityType !== "all") params.entityType = entityType;
      setData(await api<AuditLogPage>("/audit-logs", { params }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load audit log");
    } finally {
      setIsLoading(false);
    }
  }, [action, entityType, page, search, user]);

  useEffect(() => { void load(); }, [load]);

  if (loading || !user) return null;
  if (user.role !== "admin" && user.role !== "super_user") {
    return <div className="relative min-h-screen bg-background"><AbstractBg /><Header /><main className="relative z-10 mx-auto max-w-7xl p-6"><Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Only administrators can view the audit log.</CardContent></Card></main></div>;
  }

  const items = data?.items ?? [];
  return (
    <div className="relative min-h-screen bg-background">
      <AbstractBg />
      <Header />
      <main className="relative z-10 mx-auto max-w-7xl space-y-5 p-4 md:p-6">
        <Breadcrumb items={[{ label: "Dashboard", href: "/" }, { label: "Audit Log" }]} />
        <div><h1 className="flex items-center gap-2 text-2xl font-semibold"><ShieldCheck className="h-6 w-6 text-primary" />Audit Log</h1><p className="mt-1 text-sm text-muted-foreground">Append-only history of successful finance and administrative actions.</p></div>
        <Card>
          <CardHeader className="gap-3 border-b pb-4"><CardTitle className="text-base">Recorded Actions</CardTitle><div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_240px_220px_auto]"><form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(query.trim()); }}><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search action, user, or details" /><Button type="submit" size="icon" variant="outline"><Search className="h-4 w-4" /></Button></form><Select value={action} onValueChange={(value) => { setAction(value); setPage(1); }}><SelectTrigger><SelectValue placeholder="All actions" /></SelectTrigger><SelectContent><SelectItem value="all">All actions</SelectItem>{data?.actions.map((item) => <SelectItem key={item} value={item}>{label(item)}</SelectItem>)}</SelectContent></Select><Select value={entityType} onValueChange={(value) => { setEntityType(value); setPage(1); }}><SelectTrigger><SelectValue placeholder="All record types" /></SelectTrigger><SelectContent><SelectItem value="all">All record types</SelectItem>{data?.entityTypes.map((item) => <SelectItem key={item} value={item}>{label(item)}</SelectItem>)}</SelectContent></Select><Button variant="outline" onClick={() => { setQuery(""); setSearch(""); setAction("all"); setEntityType("all"); setPage(1); }}>Clear</Button></div></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b bg-muted/30 text-left text-xs text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Date</th><th className="px-4 py-3 font-medium">Action</th><th className="px-4 py-3 font-medium">Details</th><th className="px-4 py-3 font-medium">Record</th><th className="px-4 py-3 font-medium">User</th></tr></thead><tbody className="divide-y">{items.map((item) => <tr key={item.id} className="hover:bg-muted/20"><td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDate(item.createdAt)}</td><td className="px-4 py-3 font-medium capitalize">{label(item.action)}</td><td className="max-w-md px-4 py-3 text-muted-foreground">{item.summary}</td><td className="px-4 py-3"><div className="capitalize">{label(item.entityType)}</div>{item.entityId ? <div className="max-w-40 truncate font-mono text-[10px] text-muted-foreground" title={item.entityId}>{item.entityId}</div> : null}</td><td className="px-4 py-3 text-muted-foreground">{item.actor?.email ?? "System"}</td></tr>)}</tbody></table></div>
            {isLoading ? <div className="p-8 text-center text-sm text-muted-foreground">Loading audit log…</div> : null}{error ? <div className="p-8 text-center text-sm text-destructive">{error}</div> : null}{!isLoading && !error && items.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">No matching audit entries.</div> : null}
            <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground"><span>{data ? `${data.total} entries` : ""}</span><div className="flex items-center gap-2"><Button variant="outline" size="icon" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={!data || data.page <= 1}><ChevronLeft className="h-4 w-4" /></Button><span>Page {data?.page ?? 1} of {data?.pageCount ?? 1}</span><Button variant="outline" size="icon" onClick={() => setPage((value) => value + 1)} disabled={!data || data.page >= data.pageCount}><ChevronRight className="h-4 w-4" /></Button></div></div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
