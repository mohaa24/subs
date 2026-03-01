"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { api, type Person, type AnnouncementGroup, type Announcement } from "@/lib/api";
import { Header } from "@/components/header";
import { AbstractBg } from "@/components/abstract-bg";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MessageSquare, Plus, Trash2, Send, Users, X } from "lucide-react";
import { Breadcrumb } from "@/components/breadcrumb";

interface GroupMember {
  id: string;
  personId: string;
  person: Person;
}

export default function AnnouncementsPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [groups, setGroups] = useState<AnnouncementGroup[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  // Group edit modal
  const [editGroup, setEditGroup] = useState<AnnouncementGroup | null>(null);
  const [editGroupName, setEditGroupName] = useState("");
  const [editGroupDesc, setEditGroupDesc] = useState("");
  const [editGroupMembers, setEditGroupMembers] = useState<GroupMember[]>([]);
  const [editGroupLoading, setEditGroupLoading] = useState(false);
  const [editGroupSaving, setEditGroupSaving] = useState(false);

  // Add member search within group modal
  const [memberSearch, setMemberSearch] = useState("");
  const [memberResults, setMemberResults] = useState<Person[]>([]);
  const [memberSearching, setMemberSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  // Create group dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState("");

  // Send announcement
  const [sendMessage, setSendMessage] = useState("");
  const [sendToAll, setSendToAll] = useState(false);
  const [sendGroupId, setSendGroupId] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sendSuccess, setSendSuccess] = useState("");

  const [error, setError] = useState("");

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  const loadGroups = useCallback(async () => {
    try {
      const g = await api<AnnouncementGroup[]>("/announcement-groups");
      setGroups(g);
    } catch {}
  }, []);

  const loadAnnouncements = useCallback(async () => {
    try {
      const a = await api<Announcement[]>("/announcements");
      setAnnouncements(a);
    } catch {}
  }, []);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([loadGroups(), loadAnnouncements()]).finally(() => setLoading(false));
  }, [user, loadGroups, loadAnnouncements]);

  async function handleCreateGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!createName.trim()) return;
    setCreateError("");
    setCreateSubmitting(true);
    try {
      await api("/announcement-groups", {
        method: "POST",
        body: JSON.stringify({ name: createName.trim(), description: createDesc.trim() || undefined }),
      });
      setCreateOpen(false);
      setCreateName("");
      setCreateDesc("");
      loadGroups();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed");
    } finally {
      setCreateSubmitting(false);
    }
  }

  async function openGroupModal(g: AnnouncementGroup) {
    setEditGroup(g);
    setEditGroupName(g.name);
    setEditGroupDesc(g.description ?? "");
    setEditGroupLoading(true);
    setMemberSearch("");
    setMemberResults([]);
    try {
      const members = await api<GroupMember[]>(`/announcement-groups/${g.id}/members`);
      setEditGroupMembers(members);
    } catch {
      setEditGroupMembers([]);
    } finally {
      setEditGroupLoading(false);
    }
  }

  async function handleDeleteGroup() {
    if (!editGroup) return;
    if (!confirm(t("announcements.deleteGroupConfirm"))) return;
    try {
      await api(`/announcement-groups/${editGroup.id}`, { method: "DELETE" });
      setEditGroup(null);
      loadGroups();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  async function handleRemoveMember(personId: string) {
    if (!editGroup) return;
    try {
      await api(`/announcement-groups/${editGroup.id}/members/${personId}`, { method: "DELETE" });
      setEditGroupMembers((m) => m.filter((x) => x.personId !== personId));
    } catch {}
  }

  function handleMemberSearchChange(val: string) {
    setMemberSearch(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!val.trim()) { setMemberResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setMemberSearching(true);
      try {
        const r = await api<{ items: Person[] }>(`/persons`, { params: { q: val, limit: "10" } });
        const existingIds = new Set(editGroupMembers.map((m) => m.personId));
        setMemberResults(r.items.filter((p) => !existingIds.has(p.id)));
      } catch {}
      setMemberSearching(false);
    }, 300);
  }

  async function handleAddMember(person: Person) {
    if (!editGroup) return;
    try {
      await api(`/announcement-groups/${editGroup.id}/members`, {
        method: "POST",
        body: JSON.stringify({ personIds: [person.id] }),
      });
      const members = await api<GroupMember[]>(`/announcement-groups/${editGroup.id}/members`);
      setEditGroupMembers(members);
      const existingIds = new Set(members.map((m) => m.personId));
      setMemberResults((prev) => prev.filter((p) => !existingIds.has(p.id)));
    } catch {}
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!sendMessage.trim()) return;
    if (!sendToAll && !sendGroupId) { setSendError(t("announcements.selectGroupOrSendToAll")); return; }
    setSendError("");
    setSendSuccess("");
    setSending(true);
    try {
      await api("/announcements", {
        method: "POST",
        body: JSON.stringify({
          message: sendMessage.trim(),
          ...(sendToAll ? { sendToAll: true } : { groupId: sendGroupId }),
        }),
      });
      setSendMessage("");
      setSendSuccess(t("announcements.sentSuccess"));
      loadAnnouncements();
      setTimeout(() => setSendSuccess(""), 3000);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background relative">
      <AbstractBg />
      <Header />
      <main className="relative z-10 p-6 max-w-6xl mx-auto">
        <Breadcrumb items={[{ label: t("dashboard.title"), href: "/" }, { label: t("announcements.title") }]} />

        <h1 className="text-xl font-semibold text-foreground flex items-center gap-2 mb-5">
          <MessageSquare className="h-5 w-5 text-primary" />
          {t("announcements.title")}
        </h1>

        {error && <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>}

        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          {/* Groups sidebar */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-muted-foreground">{t("announcements.groups")}</h2>
              <Button size="sm" variant="outline" onClick={() => { setCreateOpen(true); setCreateError(""); }} className="gap-1 h-7 text-xs">
                <Plus className="h-3 w-3" /> {t("announcements.createGroup")}
              </Button>
            </div>

            {loading ? (
              <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
            ) : groups.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("announcements.noGroups")}</p>
            ) : (
              groups.map((g) => (
                <Card
                  key={g.id}
                  className="cursor-pointer hover:border-primary/40 transition-colors"
                  onClick={() => openGroupModal(g)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{g.name}</p>
                        {g.description && <p className="text-xs text-muted-foreground truncate">{g.description}</p>}
                      </div>
                      <Users className="h-4 w-4 text-muted-foreground shrink-0" />
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          {/* Main content */}
          <div className="space-y-6">
            {/* Send Announcement */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Send className="h-4 w-4 text-primary" />
                  {t("announcements.sendAnnouncement")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSend} className="space-y-3">
                  <textarea
                    value={sendMessage}
                    onChange={(e) => setSendMessage(e.target.value)}
                    placeholder={t("announcements.typeMessage")}
                    className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    required
                  />
                  <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                    {!sendToAll && (
                      <select
                        value={sendGroupId}
                        onChange={(e) => setSendGroupId(e.target.value)}
                        className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="">{t("announcements.selectGroup")}</option>
                        {groups.map((g) => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                    )}
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={sendToAll} onCheckedChange={(c) => setSendToAll(!!c)} />
                      {t("announcements.sendToAll")}
                    </label>
                  </div>
                  {sendError && <p className="text-sm text-destructive">{sendError}</p>}
                  {sendSuccess && <p className="text-sm text-green-600">{sendSuccess}</p>}
                  <Button type="submit" disabled={sending} className="gap-1.5">
                    <Send className="h-3.5 w-3.5" />
                    {sending ? t("announcements.sending") : t("common.send")}
                  </Button>
                </form>
              </CardContent>
            </Card>

            {/* History */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("announcements.sentHistory")}</CardTitle>
              </CardHeader>
              <CardContent>
                {announcements.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("announcements.noSentYet")}</p>
                ) : (
                  <div className="space-y-3">
                    {announcements.map((a) => (
                      <div key={a.id} className="border rounded-lg p-3">
                        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                          <span>{a.group?.name ?? t("announcements.allMembers")}</span>
                          <span>{a.sentAt ? new Date(a.sentAt).toLocaleString() : t("announcements.draft")}</span>
                        </div>
                        <p className="text-sm">{a.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* Create Group Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t("announcements.createGroupDialog")}</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateGroup} className="space-y-3">
            <div>
              <label className="text-sm font-medium block mb-1">{t("announcements.groupName")}</label>
              <Input value={createName} onChange={(e) => setCreateName(e.target.value)} required disabled={createSubmitting} />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">{t("announcements.descriptionOptional")}</label>
              <Input value={createDesc} onChange={(e) => setCreateDesc(e.target.value)} disabled={createSubmitting} />
            </div>
            {createError && <p className="text-sm text-destructive">{createError}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={createSubmitting}>{createSubmitting ? t("announcements.creating") : t("common.create")}</Button>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>{t("common.cancel")}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Group Edit Modal */}
      <Dialog open={!!editGroup} onOpenChange={(o) => { if (!o) setEditGroup(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>{editGroup?.name ?? t("announcements.group")}</DialogTitle>
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive h-7" onClick={handleDeleteGroup}>
                <Trash2 className="h-3.5 w-3.5 mr-1" /> {t("announcements.deleteGroup")}
              </Button>
            </div>
          </DialogHeader>

          {editGroupLoading ? (
            <p className="text-sm text-muted-foreground">{t("announcements.loadingMembers")}</p>
          ) : (
            <div className="space-y-4">
              {/* Current members */}
              <div>
                <p className="text-sm font-medium mb-2">{t("announcements.members")} ({editGroupMembers.length})</p>
                {editGroupMembers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("announcements.noMembersInGroup")}</p>
                ) : (
                  <div className="space-y-1 max-h-[200px] overflow-y-auto">
                    {editGroupMembers.map((m) => (
                      <div key={m.id} className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-accent/50 text-sm">
                        <span>{m.person.fullName || m.person.nameWithInitials}</span>
                        <button
                          type="button"
                          className="p-1 rounded hover:bg-destructive/10"
                          onClick={() => handleRemoveMember(m.personId)}
                        >
                          <X className="h-3.5 w-3.5 text-destructive" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add members search - stays open */}
              <div className="border-t pt-3">
                <p className="text-sm font-medium mb-2">{t("announcements.addMembers")}</p>
                <Input
                  value={memberSearch}
                  onChange={(e) => handleMemberSearchChange(e.target.value)}
                  placeholder={t("common.search")}
                />
                {memberSearching && <p className="text-xs text-muted-foreground mt-1">{t("announcements.searching")}</p>}
                {memberResults.length > 0 && (
                  <div className="mt-2 space-y-1 max-h-[200px] overflow-y-auto">
                    {memberResults.map((p) => (
                      <div key={p.id} className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-accent/50 text-sm">
                        <span>{p.fullName || p.nameWithInitials}</span>
                          <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => handleAddMember(p)}>
                          {t("common.add")}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                {memberSearch.trim() && !memberSearching && memberResults.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">{t("common.noDataFound")}</p>
                )}
              </div>

              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setEditGroup(null)}>{t("common.done")}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

