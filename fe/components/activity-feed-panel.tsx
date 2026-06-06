"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type ActivityFeedItem } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { ChevronLeft, ChevronRight, MessageSquareText } from "lucide-react";

const LIMIT = 10;

function actorLabel(item: ActivityFeedItem) {
  if (item.actorType === "system") return "System";
  return item.createdBy?.email ?? "User";
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

export function ActivityFeedPanel({
  resourcePath,
  placeholder,
  emptyMessage,
}: {
  resourcePath: string;
  placeholder: string;
  emptyMessage: string;
}) {
  const [items, setItems] = useState<ActivityFeedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const fieldId = useMemo(() => `remark-${resourcePath.replace(/[^a-zA-Z0-9_-]/g, "-")}`, [resourcePath]);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api<{ items: ActivityFeedItem[]; total: number; page: number; limit: number }>(resourcePath, {
        params: { page: String(page), limit: String(LIMIT) },
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load activity";
      setItems([]);
      setTotal(0);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [page, resourcePath]);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed, refreshKey]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / LIMIT)), [total]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) {
      setError("Remark cannot be empty.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await api<ActivityFeedItem>(resourcePath, {
        method: "POST",
        body: JSON.stringify({ entryType: "remark", body: trimmed }),
      });
      setBody("");
      setPage(1);
      setRefreshKey((v) => v + 1);
      toast({
        title: "Remark added",
        description: "Activity feed updated successfully.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to add remark";
      setError(msg);
      toast({
        variant: "destructive",
        title: "Failed to add remark",
        description: msg,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor={fieldId}>Add Remark</Label>
          <Textarea
            id={fieldId}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={placeholder}
            disabled={submitting}
          />
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Posting..." : "Post Remark"}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </form>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading activity…</p>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed py-10 text-center">
          <MessageSquareText className="mx-auto mb-2 h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="rounded-lg border bg-card p-4">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{actorLabel(item)}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</p>
                </div>
                <span className="rounded-full bg-muted px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {item.entryType.replace(/_/g, " ")}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-foreground">{item.body || "—"}</p>
            </div>
          ))}
        </div>
      )}

      {total > LIMIT && (
        <div className="flex items-center justify-between border-t pt-4 text-sm text-muted-foreground">
          <span className="font-medium">
            {total} entr{total === 1 ? "y" : "ies"}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[100px] text-center tabular-nums">
              Page {page} of {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
