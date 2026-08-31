"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Clock3,
  FileText,
  MessageSquare,
  Pencil,
  Plus,
  Save,
  Search,
  Send,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { dashboardFlowHref } from "@/lib/dashboard-flows";
import { Header } from "@/components/header";
import { AbstractBg } from "@/components/abstract-bg";
import { Breadcrumb } from "@/components/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

type Status = "draft" | "scheduled" | "queued" | "sent" | "partially_sent" | "partially_failed" | "failed";
type Audience = { allMembers: boolean; groupIds: string[]; membershipIds: string[]; excludedMembershipIds: string[] };
type MemberOption = { id: string; membershipNo: string; memberName: string; hasPhone: boolean };
type Template = { id: string; name: string; description?: string | null; body: string; updatedAt: string };
type Group = { id: string; name: string; description?: string | null; memberCount: number; createdAt: string };
type GroupMember = { id: string; membershipId: string; membershipNo: string; memberName: string };
type Announcement = {
  id: string;
  templateId?: string | null;
  message: string;
  audience?: Audience | null;
  recipientCount: number;
  estimatedSmsCount: number;
  consumedSmsCount: number;
  sentCount: number;
  errorCount: number;
  queuedCount: number;
  status: Status;
  sentAt?: string | null;
  updatedAt: string;
  template?: { id: string; name: string } | null;
  sentBy?: { id: string; email: string } | null;
};
type AnnouncementDetail = Announcement & {
  recipients: Array<{
    id: string;
    membershipNo: string;
    memberName: string;
    messageQueue?: { status: string; smsCount?: number | null; lastError?: string | null; providerStatus?: string | null; lastAttemptAt?: string | null } | null;
  }>;
};
type Quota = { period: string; monthlyQuota: number; used: number; reserved: number; remaining: number; queued: number };
type Estimate = {
  selectedCount: number;
  eligibleCount: number;
  missingPhone: Array<{ membershipId: string; membershipNo: string; memberName: string }>;
  estimatedSmsCount: number;
  quota: Quota;
  canSend: boolean;
};

const EMPTY_AUDIENCE: Audience = { allMembers: true, groupIds: [], membershipIds: [], excludedMembershipIds: [] };
const VARIABLES = ["member_name", "membership_no", "organization_name", "total_outstanding_due"];

function statusStyle(status: Status) {
  if (status === "sent") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "draft") return "bg-slate-50 text-slate-700 border-slate-200";
  if (status === "queued" || status === "scheduled") return "bg-sky-50 text-sky-700 border-sky-200";
  if (status === "partially_sent" || status === "partially_failed") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-red-50 text-red-700 border-red-200";
}

function statusLabel(status: Status) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function AnnouncementsWorkspace({ section = "announcements" }: { section?: "announcements" | "templates" | "groups" }) {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [composerOpen, setComposerOpen] = useState(false);
  const [draftId, setDraftId] = useState<string | undefined>();
  const [templateId, setTemplateId] = useState("");
  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState<Audience>(EMPTY_AUDIENCE);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberResults, setMemberResults] = useState<MemberOption[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<Record<string, MemberOption>>({});
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [announcementDetail, setAnnouncementDetail] = useState<AnnouncementDetail | null>(null);
  const [detailSummary, setDetailSummary] = useState<Announcement | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [recipientPickerOpen, setRecipientPickerOpen] = useState(false);
  const [recipientPickerMode, setRecipientPickerMode] = useState<"all" | "add">("add");
  const messageRef = useRef<HTMLTextAreaElement>(null);

  const [templateOpen, setTemplateOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [templateBody, setTemplateBody] = useState("");

  const [groupOpen, setGroupOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [groupQuery, setGroupQuery] = useState("");
  const [groupResults, setGroupResults] = useState<MemberOption[]>([]);

  const loadData = useCallback(async () => {
    const [announcementRows, templatePayload, groupRows, quotaPayload] = await Promise.all([
      api<Announcement[]>("/announcements"),
      api<{ items: Template[] }>("/announcement-templates"),
      api<Group[]>("/announcement-groups"),
      api<Quota>("/announcements/quota"),
    ]);
    setAnnouncements(announcementRows);
    setTemplates(templatePayload.items);
    setGroups(groupRows);
    setQuota(quotaPayload);
  }, []);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    loadData().catch((err) => setError(err instanceof Error ? err.message : "Unable to load announcements")).finally(() => setLoading(false));
  }, [user, loadData]);

  useEffect(() => {
    if (!user || section !== "announcements") return;
    const timer = window.setInterval(() => {
      loadData().catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [user, section, loadData]);

  useEffect(() => {
    if (!composerOpen) return;
    const timer = setTimeout(() => {
      api<{ items: MemberOption[] }>("/announcement-members", { params: { q: memberQuery, limit: "100" } })
        .then((data) => setMemberResults(data.items))
        .catch(() => setMemberResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [composerOpen, memberQuery]);

  useEffect(() => {
    if (!composerOpen || !message.trim() || (!audience.allMembers && !audience.groupIds.length && !audience.membershipIds.length)) {
      setEstimate(null);
      return;
    }
    const timer = setTimeout(() => {
      setEstimating(true);
      api<Estimate>("/announcements/estimate", {
        method: "POST",
        body: JSON.stringify({ message, audience }),
      }).then(setEstimate).catch(() => setEstimate(null)).finally(() => setEstimating(false));
    }, 450);
    return () => clearTimeout(timer);
  }, [composerOpen, message, audience]);

  useEffect(() => {
    if (!groupOpen) return;
    const timer = setTimeout(() => {
      api<{ items: MemberOption[] }>("/announcement-members", { params: { q: groupQuery, limit: "50" } })
        .then((data) => setGroupResults(data.items.filter((item) => !groupMembers.some((member) => member.membershipId === item.id))))
        .catch(() => setGroupResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [groupOpen, groupQuery, groupMembers]);

  const audienceSummary = useMemo(() => {
    if (audience.allMembers) return `All active members${audience.excludedMembershipIds.length ? ` except ${audience.excludedMembershipIds.length}` : ""}`;
    const parts = [];
    if (audience.groupIds.length) parts.push(`${audience.groupIds.length} group${audience.groupIds.length > 1 ? "s" : ""}`);
    if (audience.membershipIds.length) parts.push(`${audience.membershipIds.length} individual${audience.membershipIds.length > 1 ? "s" : ""}`);
    return parts.join(" and ") || "No recipients selected";
  }, [audience]);

  function resetComposer() {
    setDraftId(undefined);
    setTemplateId("");
    setMessage("");
    setAudience({ ...EMPTY_AUDIENCE });
    setSelectedMembers({});
    setMemberQuery("");
    setEstimate(null);
    setError("");
  }

  function openNewAnnouncement() {
    resetComposer();
    setComposerOpen(true);
  }

  function openDraft(announcement: Announcement) {
    setDraftId(announcement.id);
    setTemplateId(announcement.templateId ?? "");
    setMessage(announcement.message);
    setAudience(announcement.audience ?? { ...EMPTY_AUDIENCE });
    setSelectedMembers({});
    setMemberQuery("");
    setComposerOpen(true);
  }

  function chooseTemplate(id: string) {
    setTemplateId(id);
    const selected = templates.find((template) => template.id === id);
    if (selected) setMessage(selected.body);
  }

  function toggleMember(member: MemberOption, checked: boolean) {
    if (audience.allMembers) {
      setAudience((current) => ({
        ...current,
        excludedMembershipIds: checked
          ? current.excludedMembershipIds.filter((id) => id !== member.id)
          : Array.from(new Set([...current.excludedMembershipIds, member.id])),
      }));
      return;
    }
    setSelectedMembers((current) => {
      const next = { ...current };
      if (checked) next[member.id] = member;
      else delete next[member.id];
      return next;
    });
    setAudience((current) => ({
      ...current,
      membershipIds: checked ? Array.from(new Set([...current.membershipIds, member.id])) : current.membershipIds.filter((id) => id !== member.id),
    }));
  }

  function insertVariable(variable: string, target: "message" | "template") {
    const token = `{{${variable}}}`;
    if (target === "template") {
      setTemplateBody((body) => `${body}${body && !body.endsWith(" ") ? " " : ""}${token}`);
      return;
    }
    const element = messageRef.current;
    if (!element) return setMessage((body) => `${body}${token}`);
    const start = element.selectionStart;
    const end = element.selectionEnd;
    setMessage((body) => `${body.slice(0, start)}${token}${body.slice(end)}`);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function saveDraft() {
    setSaving(true);
    setError("");
    try {
      const saved = await api<Announcement>("/announcements/drafts", {
        method: "POST",
        body: JSON.stringify({ id: draftId, templateId: templateId || null, message, audience }),
      });
      setDraftId(saved.id);
      await loadData();
      setComposerOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save draft");
    } finally {
      setSaving(false);
    }
  }

  async function sendAnnouncement() {
    if (!estimate) return;
    setSaving(true);
    setError("");
    try {
      await api("/announcements/send", {
        method: "POST",
        body: JSON.stringify({
          id: draftId,
          templateId: templateId || null,
          message,
          audience,
          confirmedEstimatedSmsCount: estimate.estimatedSmsCount,
        }),
      });
      setConfirmOpen(false);
      setComposerOpen(false);
      resetComposer();
      await loadData();
    } catch (err) {
      setConfirmOpen(false);
      setError(err instanceof Error ? err.message : "Unable to send announcement");
    } finally {
      setSaving(false);
    }
  }

  function openTemplate(template?: Template) {
    setEditingTemplate(template ?? null);
    setTemplateName(template?.name ?? "");
    setTemplateDescription(template?.description ?? "");
    setTemplateBody(template?.body ?? "Dear {{member_name}}, ");
    setTemplateOpen(true);
  }

  async function saveTemplate() {
    setSaving(true);
    try {
      await api(editingTemplate ? `/announcement-templates/${editingTemplate.id}` : "/announcement-templates", {
        method: editingTemplate ? "PUT" : "POST",
        body: JSON.stringify({ name: templateName, description: templateDescription || null, body: templateBody }),
      });
      setTemplateOpen(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save template");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTemplate(template: Template) {
    if (!confirm(`Delete template “${template.name}”?`)) return;
    await api(`/announcement-templates/${template.id}`, { method: "DELETE" });
    await loadData();
  }

  async function openGroup(group?: Group) {
    setEditingGroup(group ?? null);
    setGroupName(group?.name ?? "");
    setGroupDescription(group?.description ?? "");
    setGroupQuery("");
    setGroupMembers(group ? await api<GroupMember[]>(`/announcement-groups/${group.id}/members`) : []);
    setGroupOpen(true);
  }

  async function saveGroup() {
    setSaving(true);
    try {
      await api<Group>(editingGroup ? `/announcement-groups/${editingGroup.id}` : "/announcement-groups", {
        method: editingGroup ? "PUT" : "POST",
        body: JSON.stringify({ name: groupName, description: groupDescription || null, ...(!editingGroup ? { membershipIds: groupMembers.map((member) => member.membershipId) } : {}) }),
      });
      setGroupOpen(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save group");
    } finally {
      setSaving(false);
    }
  }

  async function addGroupMember(member: MemberOption) {
    if (!editingGroup) {
      setGroupMembers((current) => [...current, { id: member.id, membershipId: member.id, membershipNo: member.membershipNo, memberName: member.memberName }]);
      return;
    }
    await api(`/announcement-groups/${editingGroup.id}/members`, { method: "POST", body: JSON.stringify({ membershipIds: [member.id] }) });
    setGroupMembers(await api<GroupMember[]>(`/announcement-groups/${editingGroup.id}/members`));
  }

  async function removeGroupMember(membershipId: string) {
    if (!editingGroup) {
      setGroupMembers((current) => current.filter((member) => member.membershipId !== membershipId));
      return;
    }
    await api(`/announcement-groups/${editingGroup.id}/members/${membershipId}`, { method: "DELETE" });
    setGroupMembers((current) => current.filter((member) => member.membershipId !== membershipId));
  }

  async function deleteGroup(group: Group) {
    if (!confirm(`Delete group “${group.name}”?`)) return;
    await api(`/announcement-groups/${group.id}`, { method: "DELETE" });
    await loadData();
  }

  async function deleteDraft(announcement: Announcement) {
    if (!confirm("Delete this draft announcement?")) return;
    await api(`/announcements/${announcement.id}`, { method: "DELETE" });
    await loadData();
  }

  async function openAnnouncementDetail(announcement: Announcement) {
    setDetailOpen(true);
    setDetailSummary(announcement);
    setAnnouncementDetail(null);
    setDetailLoading(true);
    try {
      setAnnouncementDetail(await api<AnnouncementDetail>(`/announcements/${announcement.id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load announcement details");
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }

  const sectionTitle = section === "templates" ? "Announcement templates" : section === "groups" ? "Announcement groups" : "Announcements";
  const sectionDescription = section === "templates"
    ? "Create and maintain reusable personalized message templates."
    : section === "groups"
      ? "Create reusable recipient groups from active member profiles."
      : "Create personalized messages for members and track SMS usage.";

  if (authLoading || !user) return <div className="min-h-screen grid place-items-center"><div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-background relative">
      <AbstractBg />
      <Header />
      <main className="relative z-10 mx-auto max-w-7xl px-4 py-5 sm:px-6">
        <Breadcrumb items={[{ label: "Dashboard", href: dashboardFlowHref("announcements") }, ...(section === "announcements" ? [{ label: "Announcements" }] : [{ label: "Announcements", href: "/announcements" }, { label: sectionTitle }])]} />
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold"><MessageSquare className="h-6 w-6 text-primary" /> {sectionTitle}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{sectionDescription}</p>
          </div>
          {quota && (
            <div className="rounded-xl border bg-card px-4 py-2 text-sm shadow-sm">
              <span className="text-muted-foreground">Available quota</span>
              <span className="ml-2 text-lg font-semibold text-primary">{quota.remaining.toLocaleString()}</span>
              <span className="ml-1 text-xs text-muted-foreground">segments</span>
            </div>
          )}
        </div>
        {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {section === "announcements" && (
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div><CardTitle className="text-base">Announcement history</CardTitle><p className="mt-1 text-xs text-muted-foreground">Drafts and previously queued messages</p></div>
                <Button onClick={openNewAnnouncement} className="gap-2"><Plus className="h-4 w-4" /> <span className="hidden sm:inline">New announcement</span><span className="sm:hidden">New</span></Button>
              </CardHeader>
              <CardContent className="p-0 sm:p-6 sm:pt-0">
                {loading ? <p className="p-4 text-sm text-muted-foreground">Loading…</p> : announcements.length === 0 ? (
                  <div className="p-10 text-center"><MessageSquare className="mx-auto h-9 w-9 text-muted-foreground/50" /><p className="mt-3 text-sm font-medium">No announcements yet</p></div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-sm">
                      <thead><tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="px-4 py-3">Message</th><th className="px-3 py-3">Recipients</th><th className="px-3 py-3">Quota</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Sent by</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
                      <tbody>{announcements.map((announcement) => (
                        <tr key={announcement.id} className="border-b last:border-0">
                          <td className="max-w-[360px] px-4 py-3"><p className="truncate font-medium">{announcement.message || "Untitled draft"}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(announcement.sentAt ?? announcement.updatedAt).toLocaleString()}{announcement.template?.name ? ` · ${announcement.template.name}` : ""}</p></td>
                          <td className="px-3 py-3">{announcement.status === "draft" ? "—" : <div><span className="font-medium">{announcement.sentCount} / {announcement.recipientCount} sent</span>{announcement.errorCount > 0 && <p className="mt-0.5 text-xs text-red-600">{announcement.errorCount} error{announcement.errorCount === 1 ? "" : "s"}</p>}{announcement.queuedCount > 0 && <p className="mt-0.5 text-xs text-muted-foreground">{announcement.queuedCount} waiting</p>}</div>}</td>
                          <td className="px-3 py-3"><span className="font-medium">{announcement.consumedSmsCount}</span><span className="text-xs text-muted-foreground"> / {announcement.estimatedSmsCount || 0}</span></td>
                          <td className="px-3 py-3"><span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${statusStyle(announcement.status)}`}>{statusLabel(announcement.status)}</span></td>
                          <td className="px-3 py-3 text-xs text-muted-foreground">{announcement.sentBy?.email ?? "—"}</td>
                          <td className="px-4 py-3"><div className="flex justify-end gap-1">{announcement.status === "draft" ? <><Button size="sm" variant="outline" onClick={() => openDraft(announcement)}><Pencil className="h-3.5 w-3.5" /></Button><Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteDraft(announcement)}><Trash2 className="h-3.5 w-3.5" /></Button></> : <Button size="sm" variant="outline" onClick={() => openAnnouncementDetail(announcement)} className="gap-1.5"><FileText className="h-3.5 w-3.5" /> Details</Button>}</div></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
        )}

        {section === "templates" && (
            <Card><CardHeader className="flex-row items-center justify-between space-y-0"><div><CardTitle className="text-base">Message templates</CardTitle><p className="mt-1 text-xs text-muted-foreground">Reusable organization templates with personalized variables</p></div><Button onClick={() => openTemplate()} className="gap-2"><Plus className="h-4 w-4" /> New template</Button></CardHeader>
              <CardContent><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{templates.map((template) => <div key={template.id} className="rounded-xl border bg-card p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-medium">{template.name}</h3>{template.description && <p className="mt-1 text-xs text-muted-foreground">{template.description}</p>}</div><div className="flex"><Button size="sm" variant="ghost" onClick={() => openTemplate(template)}><Pencil className="h-3.5 w-3.5" /></Button><Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteTemplate(template)}><Trash2 className="h-3.5 w-3.5" /></Button></div></div><p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{template.body}</p></div>)}{templates.length === 0 && <p className="text-sm text-muted-foreground">No templates created yet.</p>}</div></CardContent>
            </Card>
        )}

        {section === "groups" && (
            <Card><CardHeader className="flex-row items-center justify-between space-y-0"><div><CardTitle className="text-base">Recipient groups</CardTitle><p className="mt-1 text-xs text-muted-foreground">Save frequently used sets of memberships</p></div><Button onClick={() => openGroup()} className="gap-2"><Plus className="h-4 w-4" /> New group</Button></CardHeader>
              <CardContent><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{groups.map((group) => <div key={group.id} className="rounded-xl border bg-card p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-medium">{group.name}</h3><p className="mt-1 text-xs text-muted-foreground">{group.memberCount} members{group.description ? ` · ${group.description}` : ""}</p></div><div className="flex"><Button size="sm" variant="ghost" onClick={() => openGroup(group)}><Pencil className="h-3.5 w-3.5" /></Button><Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteGroup(group)}><Trash2 className="h-3.5 w-3.5" /></Button></div></div></div>)}{groups.length === 0 && <p className="text-sm text-muted-foreground">No groups created yet.</p>}</div></CardContent>
            </Card>
        )}
      </main>

      <Dialog open={composerOpen} onOpenChange={(open) => { setComposerOpen(open); if (!open) setError(""); }}>
        <DialogContent className="max-h-[94vh] max-w-4xl overflow-y-auto p-0">
          <DialogHeader className="border-b px-5 py-4"><DialogTitle>{draftId ? "Edit draft" : "New announcement"}</DialogTitle></DialogHeader>
          <div className="grid gap-5 p-5 lg:grid-cols-[1fr_280px]">
            <div className="space-y-5">
              <div><label className="mb-1.5 block text-sm font-medium">Template</label><select value={templateId} onChange={(event) => chooseTemplate(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Start without a template</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></div>
              <div className="rounded-xl border p-4">
                <div className="flex items-center justify-between"><label className="text-sm font-medium">To</label><span className="text-xs text-muted-foreground">{audienceSummary}</span></div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {audience.allMembers && <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 py-1.5 pl-3 pr-1.5 text-sm text-primary"><Users className="h-3.5 w-3.5" /> All active members{audience.excludedMembershipIds.length > 0 && ` except ${audience.excludedMembershipIds.length}`}<button type="button" aria-label="Edit all active members" onClick={() => { setRecipientPickerMode("all"); setRecipientPickerOpen(true); }} className="rounded-full p-1 hover:bg-primary/10"><Pencil className="h-3 w-3" /></button><button type="button" aria-label="Remove all active members" onClick={() => setAudience((current) => ({ ...current, allMembers: false, excludedMembershipIds: [] }))} className="rounded-full p-1 hover:bg-primary/10"><X className="h-3 w-3" /></button></span>}
                  {audience.groupIds.map((groupId) => { const group = groups.find((item) => item.id === groupId); return <span key={groupId} className="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 py-1.5 pl-3 pr-1.5 text-sm"><Users className="h-3.5 w-3.5" /> {group?.name ?? "Recipient group"}<button type="button" aria-label="Remove group" onClick={() => setAudience((current) => ({ ...current, groupIds: current.groupIds.filter((id) => id !== groupId) }))} className="rounded-full p-1 hover:bg-muted"><X className="h-3 w-3" /></button></span>; })}
                  {audience.membershipIds.map((membershipId) => { const member = selectedMembers[membershipId] ?? memberResults.find((item) => item.id === membershipId); return <span key={membershipId} className="inline-flex items-center gap-1 rounded-full border bg-muted/50 py-1.5 pl-3 pr-1.5 text-sm">{member ? `${member.membershipNo} · ${member.memberName}` : "Individual member"}<button type="button" aria-label="Remove member" onClick={() => member ? toggleMember(member, false) : setAudience((current) => ({ ...current, membershipIds: current.membershipIds.filter((id) => id !== membershipId) }))} className="rounded-full p-1 hover:bg-muted"><X className="h-3 w-3" /></button></span>; })}
                  <button type="button" aria-label="Add recipients" onClick={() => { setRecipientPickerMode("add"); setRecipientPickerOpen(true); }} className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-dashed text-muted-foreground hover:border-primary hover:text-primary"><Plus className="h-4 w-4" /></button>
                </div>
              </div>
              <div><div className="mb-1.5 flex items-center justify-between"><label className="text-sm font-medium">Message</label><span className="text-xs text-muted-foreground">{message.length}/2000</span></div><Textarea ref={messageRef} value={message} onChange={(event) => setMessage(event.target.value)} rows={7} placeholder="Write your announcement…" /><div className="mt-2 flex flex-wrap gap-1.5">{VARIABLES.map((variable) => <button type="button" key={variable} onClick={() => insertVariable(variable, "message")} className="rounded border bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground hover:border-primary hover:text-primary">{`{{${variable}}}`}</button>)}</div></div>
            </div>
            <aside className="space-y-3">
              <div className="rounded-xl border bg-slate-950 p-4 text-white"><p className="text-xs text-slate-300">Available this month</p><p className="mt-1 text-3xl font-semibold">{(estimate?.quota.remaining ?? quota?.remaining ?? 0).toLocaleString()}</p><p className="text-xs text-slate-300">SMS segments</p><div className="mt-3 border-t border-white/15 pt-3 text-xs text-slate-300"><div className="flex justify-between"><span>Used</span><span>{estimate?.quota.used ?? quota?.used ?? 0}</span></div><div className="mt-1 flex justify-between"><span>Already queued</span><span>{estimate?.quota.reserved ?? quota?.reserved ?? 0}</span></div></div></div>
              <div className="rounded-xl border p-4"><p className="text-sm font-medium">Send estimate</p>{estimating ? <p className="mt-3 text-sm text-muted-foreground">Calculating…</p> : estimate ? <div className="mt-3 space-y-2 text-sm"><div className="flex justify-between"><span className="text-muted-foreground">Selected</span><span>{estimate.selectedCount}</span></div><div className="flex justify-between"><span className="text-muted-foreground">With phone</span><span>{estimate.eligibleCount}</span></div><div className="flex justify-between"><span className="text-muted-foreground">No phone</span><span className={estimate.missingPhone.length ? "text-amber-600" : ""}>{estimate.missingPhone.length}</span></div><div className="border-t pt-2"><div className="flex justify-between font-medium"><span>Will consume</span><span>{estimate.estimatedSmsCount} segments</span></div></div>{!estimate.canSend && <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">The available organization quota is not enough for this announcement.</p>}</div> : <p className="mt-3 text-xs text-muted-foreground">Select recipients and enter a message to calculate quota usage.</p>}</div>
            </aside>
          </div>
          <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t bg-background px-5 py-4 sm:flex-row sm:justify-end"><Button variant="outline" onClick={() => setComposerOpen(false)}>Cancel</Button><Button variant="outline" onClick={saveDraft} disabled={saving} className="gap-2"><Save className="h-4 w-4" /> Save draft</Button><Button onClick={() => setConfirmOpen(true)} disabled={saving || !estimate?.canSend} className="gap-2"><Send className="h-4 w-4" /> Review & send</Button></div>
        </DialogContent>
      </Dialog>

      <Dialog open={recipientPickerOpen} onOpenChange={setRecipientPickerOpen}>
        <DialogContent className="max-h-[88vh] max-w-xl overflow-y-auto">
          <DialogHeader><DialogTitle>{recipientPickerMode === "all" ? "Edit all active members" : "Add recipients"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {recipientPickerMode === "all" ? (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground">All active members are selected. Untick any members who should be excluded from this announcement.</div>
            ) : (
              <>
                {!audience.allMembers && <button type="button" onClick={() => setAudience((current) => ({ ...current, allMembers: true, excludedMembershipIds: [] }))} className="flex w-full items-center gap-3 rounded-lg border p-3 text-left hover:border-primary"><span className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-primary"><Users className="h-4 w-4" /></span><span><span className="block text-sm font-medium">All active members</span><span className="text-xs text-muted-foreground">Send to every active membership</span></span></button>}
                {groups.length > 0 && <div><p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Groups</p><div className="flex flex-wrap gap-2">{groups.map((group) => { const checked = audience.groupIds.includes(group.id); return <button type="button" key={group.id} onClick={() => setAudience((current) => ({ ...current, groupIds: checked ? current.groupIds.filter((id) => id !== group.id) : [...current.groupIds, group.id] }))} className={`rounded-full border px-3 py-2 text-xs ${checked ? "border-primary bg-primary/10 text-primary" : "bg-background"}`}>{checked && <Check className="mr-1 inline h-3 w-3" />}{group.name} ({group.memberCount})</button>; })}</div></div>}
              </>
            )}
            <div>
              <label className="mb-1.5 block text-sm font-medium">{audience.allMembers ? "Members" : "Individual members"}</label>
              <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder={audience.allMembers ? "Search members to include or exclude…" : "Search by member name or ID…"} className="pl-9" /></div>
              <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border">{memberResults.map((member) => { const checked = audience.allMembers ? !audience.excludedMembershipIds.includes(member.id) : audience.membershipIds.includes(member.id); return <label key={member.id} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2.5 last:border-0 hover:bg-muted/40"><Checkbox checked={checked} onCheckedChange={(value) => toggleMember(member, Boolean(value))} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{member.memberName}</span><span className="text-xs text-muted-foreground">{member.membershipNo}</span></span>{!member.hasPhone && <span className="text-xs text-amber-600">No phone</span>}</label>; })}{memberResults.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">No active members found.</p>}</div>
            </div>
            <div className="flex justify-end"><Button onClick={() => setRecipientPickerOpen(false)}>Done</Button></div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>Announcement delivery details</DialogTitle></DialogHeader>
          {detailLoading ? <p className="py-8 text-center text-sm text-muted-foreground">Loading delivery results…</p> : announcementDetail && detailSummary ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Sent</p><p className="mt-1 text-xl font-semibold text-emerald-700">{detailSummary.sentCount} / {detailSummary.recipientCount}</p></div>
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Errors</p><p className={`mt-1 text-xl font-semibold ${detailSummary.errorCount ? "text-red-700" : "text-foreground"}`}>{detailSummary.errorCount}</p></div>
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Waiting</p><p className="mt-1 text-xl font-semibold text-sky-700">{detailSummary.queuedCount}</p></div>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[620px] text-sm">
                  <thead><tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="px-3 py-2.5">Member</th><th className="px-3 py-2.5">Delivery</th><th className="px-3 py-2.5">Result</th></tr></thead>
                  <tbody>{announcementDetail.recipients.map((recipient) => { const queue = recipient.messageQueue; const hasError = queue?.status === "failed" || (queue?.status === "pending" && Boolean(queue.lastError)); const wasSent = queue && ["submitted", "sent", "delivered"].includes(queue.status); return <tr key={recipient.id} className="border-b align-top last:border-0"><td className="px-3 py-3"><p className="font-medium">{recipient.memberName}</p><p className="text-xs text-muted-foreground">{recipient.membershipNo}</p></td><td className="px-3 py-3"><span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${hasError ? "border-red-200 bg-red-50 text-red-700" : wasSent ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-sky-200 bg-sky-50 text-sky-700"}`}>{hasError ? "Error" : wasSent ? "Sent" : "Waiting"}</span></td><td className="max-w-md px-3 py-3 text-xs">{hasError ? <span className="text-red-700">{queue?.lastError || "Delivery failed"}</span> : <span className="text-muted-foreground">{queue?.providerStatus || (wasSent ? "Accepted by SMS provider" : "Waiting to be processed")}</span>}</td></tr>; })}</tbody>
                </table>
              </div>
            </div>
          ) : <p className="py-8 text-center text-sm text-muted-foreground">Delivery details are unavailable.</p>}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Confirm announcement</AlertDialogTitle><AlertDialogDescription asChild><div className="space-y-3"><p>This will queue personalized SMS messages for <strong>{estimate?.eligibleCount ?? 0} members</strong>.</p><div className="rounded-lg border bg-muted/40 p-3 text-foreground"><div className="flex justify-between text-sm"><span>Estimated quota usage</span><strong>{estimate?.estimatedSmsCount ?? 0} segments</strong></div><div className="mt-1 flex justify-between text-sm"><span>Available quota</span><strong>{estimate?.quota.remaining ?? 0} segments</strong></div></div>{Boolean(estimate?.missingPhone.length) && <p className="flex gap-2 text-amber-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {estimate?.missingPhone.length} selected members without a mobile or WhatsApp number will be skipped.</p>}<p>Do you want to continue?</p></div></AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel><AlertDialogAction onClick={(event) => { event.preventDefault(); sendAnnouncement(); }} disabled={saving}>{saving ? "Queuing…" : "Confirm & send"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>

      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>{editingTemplate ? "Edit template" : "New template"}</DialogTitle></DialogHeader><div className="space-y-4"><div><label className="mb-1 block text-sm font-medium">Name</label><Input value={templateName} onChange={(event) => setTemplateName(event.target.value)} /></div><div><label className="mb-1 block text-sm font-medium">Description</label><Input value={templateDescription} onChange={(event) => setTemplateDescription(event.target.value)} /></div><div><label className="mb-1 block text-sm font-medium">Message</label><Textarea rows={7} value={templateBody} onChange={(event) => setTemplateBody(event.target.value)} /><div className="mt-2 flex flex-wrap gap-1.5">{VARIABLES.map((variable) => <button type="button" key={variable} onClick={() => insertVariable(variable, "template")} className="rounded border px-2 py-1 font-mono text-[11px] text-muted-foreground">{`{{${variable}}}`}</button>)}</div></div><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setTemplateOpen(false)}>Cancel</Button><Button onClick={saveTemplate} disabled={saving || !templateName.trim() || !templateBody.trim()}>{saving ? "Saving…" : "Save template"}</Button></div></div></DialogContent></Dialog>

      <Dialog open={groupOpen} onOpenChange={setGroupOpen}><DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto"><DialogHeader><DialogTitle>{editingGroup ? "Edit group" : "New group"}</DialogTitle></DialogHeader><div className="space-y-4"><div><label className="mb-1 block text-sm font-medium">Name</label><Input value={groupName} onChange={(event) => setGroupName(event.target.value)} /></div><div><label className="mb-1 block text-sm font-medium">Description</label><Input value={groupDescription} onChange={(event) => setGroupDescription(event.target.value)} /></div><div className="border-t pt-4"><div className="mb-2 flex items-center justify-between"><p className="text-sm font-medium">Selected members</p><span className="text-xs text-muted-foreground">{groupMembers.length}</span></div><div className="max-h-40 overflow-y-auto rounded-lg border">{groupMembers.map((member) => <div key={member.membershipId} className="flex items-center justify-between border-b px-3 py-2 text-sm last:border-0"><span><strong>{member.membershipNo}</strong> · {member.memberName}</span><Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeGroupMember(member.membershipId)}><X className="h-3.5 w-3.5" /></Button></div>)}{!groupMembers.length && <p className="p-3 text-xs text-muted-foreground">No members selected yet.</p>}</div></div><div><label className="mb-1 block text-sm font-medium">Add members</label><Input value={groupQuery} onChange={(event) => setGroupQuery(event.target.value)} placeholder="Search name or membership ID" /><div className="mt-2 max-h-44 overflow-y-auto rounded-lg border">{groupResults.map((member) => <div key={member.id} className="flex items-center justify-between border-b px-3 py-2 last:border-0"><span className="text-sm"><strong>{member.membershipNo}</strong> · {member.memberName}</span><Button size="sm" variant="outline" onClick={() => addGroupMember(member)}>Add</Button></div>)}{groupResults.length === 0 && <p className="p-3 text-xs text-muted-foreground">No additional active members found.</p>}</div></div><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setGroupOpen(false)}>Close</Button><Button onClick={saveGroup} disabled={saving || !groupName.trim()}>{editingGroup ? "Save changes" : "Create group"}</Button></div></div></DialogContent></Dialog>
    </div>
  );
}

export default function AnnouncementsPage() {
  return <AnnouncementsWorkspace />;
}
