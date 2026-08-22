"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Gauge, MessageSquare, Pencil, Save } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { dashboardFlowHref } from "@/lib/dashboard-flows";
import { Header } from "@/components/header";
import { AbstractBg } from "@/components/abstract-bg";
import { Breadcrumb } from "@/components/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

type MessageTemplate = {
  eventType: string;
  label: string;
  description: string;
  available: boolean;
  enabled: boolean;
  body: string;
  allowedVariables: string[];
};

type MessageSettingsPayload = {
  organization: { id: string; name: string };
  monthlyQuota: number;
  usage: {
    period: string;
    monthlyQuota: number;
    used: number;
    remaining: number;
    queued: number;
  };
  templates: MessageTemplate[];
};

export default function MessageSettingsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [organizations, setOrganizations] = useState<{ id: string; name: string }[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [settings, setSettings] = useState<MessageSettingsPayload | null>(null);
  const [monthlyQuota, setMonthlyQuota] = useState(100);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedTemplateType, setSelectedTemplateType] = useState<string | null>(null);

  const isSuperUser = user?.role === "super_user";
  const effectiveOrgId = isSuperUser ? selectedOrgId : user?.organizationId ?? "";

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, router, user]);

  useEffect(() => {
    if (!isSuperUser) return;
    api<{ id: string; name: string }[]>("/organizations")
      .then((items) => {
        setOrganizations(items);
        setSelectedOrgId((current) => current || items[0]?.id || "");
      })
      .catch((error) => {
        toast({
          variant: "destructive",
          title: "Unable to load organizations",
          description: error instanceof Error ? error.message : "Please try again",
        });
        setLoading(false);
      });
  }, [isSuperUser]);

  const loadSettings = useCallback(async () => {
    if (!effectiveOrgId) {
      if (!isSuperUser) setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const payload = await api<MessageSettingsPayload>("/messages/settings", {
        params: isSuperUser ? { organizationId: effectiveOrgId } : {},
      });
      setSettings(payload);
      setMonthlyQuota(payload.monthlyQuota);
      setTemplates(payload.templates);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Unable to load SMS settings",
        description: error instanceof Error ? error.message : "Please try again",
      });
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }, [effectiveOrgId, isSuperUser]);

  useEffect(() => {
    if (user && (user.role === "admin" || user.role === "super_user")) void loadSettings();
  }, [loadSettings, user]);

  const usagePercent = useMemo(() => {
    if (!settings?.usage.monthlyQuota) return settings?.usage.used ? 100 : 0;
    return Math.min(100, Math.round((settings.usage.used / settings.usage.monthlyQuota) * 100));
  }, [settings]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.eventType === selectedTemplateType) ?? null,
    [selectedTemplateType, templates]
  );

  function updateTemplate(eventType: string, patch: Partial<MessageTemplate>) {
    setTemplates((items) =>
      items.map((template) => (template.eventType === eventType ? { ...template, ...patch } : template))
    );
  }

  async function saveSettings() {
    if (!isSuperUser || !effectiveOrgId) return;
    setSaving(true);
    try {
      const updated = await api<MessageSettingsPayload>("/messages/settings", {
        method: "PUT",
        body: JSON.stringify({
          organizationId: effectiveOrgId,
          monthlyQuota,
          templates: templates.map(({ eventType, enabled, body }) => ({ eventType, enabled, body })),
        }),
      });
      setSettings(updated);
      setMonthlyQuota(updated.monthlyQuota);
      setTemplates(updated.templates);
      toast({ title: "SMS settings saved" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Unable to save SMS settings",
        description: error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || !user) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (user.role !== "admin" && user.role !== "super_user") {
    router.replace("/");
    return null;
  }

  return (
    <div className="relative min-h-screen bg-background">
      <AbstractBg />
      <Header />
      <main className="relative mx-auto max-w-5xl p-6">
        <Breadcrumb
          items={[
            { label: "Dashboard", href: dashboardFlowHref("admin") },
            { label: "Settings" },
            { label: "SMS Settings" },
          ]}
        />

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-muted-foreground" />
              <h1 className="text-xl font-semibold text-foreground">SMS Settings</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage monthly quota and member notification templates.
            </p>
          </div>
          {isSuperUser && (
            <Button onClick={saveSettings} disabled={saving || loading || !settings} className="gap-2">
              <Save className="h-4 w-4" />
              {saving ? "Saving…" : "Save settings"}
            </Button>
          )}
        </div>

        {isSuperUser && organizations.length > 0 && (
          <div className="mb-5 flex max-w-md items-center gap-3">
            <Label className="shrink-0">Organization</Label>
            <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {organizations.map((organization) => (
                  <SelectItem key={organization.id} value={organization.id}>{organization.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {loading ? (
          <div className="space-y-4">
            <div className="h-40 animate-pulse rounded-lg bg-muted" />
            <div className="h-64 animate-pulse rounded-lg bg-muted" />
          </div>
        ) : !settings ? (
          <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No SMS settings available.</CardContent></Card>
        ) : (
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Gauge className="h-4 w-4" /> Monthly SMS quota
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Used</p>
                    <p className="mt-1 text-2xl font-semibold">{settings.usage.used}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Available</p>
                    <p className="mt-1 text-2xl font-semibold">{settings.usage.remaining}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Queued</p>
                    <p className="mt-1 text-2xl font-semibold">{settings.usage.queued}</p>
                  </div>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${usagePercent}%` }} />
                </div>
                <div className="mt-4 max-w-xs space-y-1.5">
                  <Label htmlFor="monthly-quota">Monthly quota (SMS segments)</Label>
                  <Input
                    id="monthly-quota"
                    type="number"
                    min={0}
                    max={1000000}
                    value={monthlyQuota}
                    disabled={!isSuperUser}
                    onChange={(event) => setMonthlyQuota(Math.max(0, Number(event.target.value) || 0))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Usage period: {settings.usage.period}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Message templates</CardTitle>
                <p className="text-sm text-muted-foreground">
                  The rendered message is saved with each queued SMS, so later template changes do not alter message history.
                </p>
              </CardHeader>
              <CardContent>
                <div className="overflow-hidden rounded-lg border">
                {templates.map((template) => (
                  <div
                    key={template.eventType}
                    className="flex flex-col gap-3 border-b px-4 py-3 last:border-b-0 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">{template.label}</p>
                      {template.description && (
                        <p className="mt-0.5 truncate text-sm text-muted-foreground">
                          {template.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {template.enabled ? "Enabled" : "Disabled"}
                        </span>
                        <Checkbox
                          aria-label={`Enable ${template.label}`}
                          checked={template.enabled}
                          disabled={!isSuperUser || !template.available}
                          onCheckedChange={(checked) =>
                            updateTemplate(template.eventType, { enabled: checked === true })
                          }
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-w-20 gap-1.5"
                        onClick={() => setSelectedTemplateType(template.eventType)}
                      >
                        {isSuperUser && template.available ? (
                          <Pencil className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                        {isSuperUser && template.available ? "Edit" : "View"}
                      </Button>
                    </div>
                  </div>
                ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      <Dialog
        open={Boolean(selectedTemplate)}
        onOpenChange={(open) => {
          if (!open) setSelectedTemplateType(null);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          {selectedTemplate && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedTemplate.label}</DialogTitle>
                {selectedTemplate.description && (
                  <DialogDescription>{selectedTemplate.description}</DialogDescription>
                )}
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="message-template-body">Message template</Label>
                <Textarea
                  id="message-template-body"
                  className="min-h-36"
                  value={selectedTemplate.body}
                  disabled={!isSuperUser || !selectedTemplate.available}
                  onChange={(event) =>
                    updateTemplate(selectedTemplate.eventType, { body: event.target.value })
                  }
                />
              </div>
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Available placeholders
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedTemplate.allowedVariables.map((variable) => (
                    <code
                      key={variable}
                      className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                    >
                      {`{{${variable}}}`}
                    </code>
                  ))}
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="button" onClick={() => setSelectedTemplateType(null)}>
                  Done
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
