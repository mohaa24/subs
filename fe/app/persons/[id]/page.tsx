"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { api, type Person, type Zone } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PersonForm, type PersonFormData } from "@/components/person-form";
import { ActivityFeedPanel } from "@/components/activity-feed-panel";
import { Header } from "@/components/header";
import { Breadcrumb } from "@/components/breadcrumb";
import { BLOOD_GROUPS, RESIDENT_TYPES } from "@/lib/constants";
import { toast } from "@/hooks/use-toast";
import { dashboardFlowHref } from "@/lib/dashboard-flows";
import {
  User,
  BadgeCheck,
  Archive,
  Edit,
  Phone,
  Mail,
  MapPin,
  Calendar,
  Briefcase,
  Shield,
  Fingerprint,
  Activity,
  ArrowUpRight,
  BookOpen,
  MessageSquareText,
} from "lucide-react";

function displayValue(value: string | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  return value;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function getAge(value: string | null | undefined) {
  if (!value) return null;
  const dob = new Date(value);
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
}

function getInitials(person: Person) {
  const source = person.nameWithInitials || person.fullName || "";
  const parts = source
    .replace(/\./g, " ")
    .split(" ")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return "P";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-border/40 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right">{value}</span>
    </div>
  );
}

export default function PersonDetailPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [person, setPerson] = useState<Person | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [zones, setZones] = useState<Zone[]>([]);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user || !id) return;
    api<Person>(`/persons/${id}`)
      .then(setPerson)
      .catch(() => setPerson(null))
      .finally(() => setLoading(false));
  }, [user, id]);

  useEffect(() => {
    if (!person?.organizationId) {
      setZones([]);
      return;
    }
    const params: Record<string, string> = { includeInactive: "true" };
    if (user?.role === "super_user") params.organizationId = person.organizationId;
    api<Zone[]>("/zones", { params })
      .then(setZones)
      .catch(() => setZones([]));
  }, [person?.organizationId, user?.role]);

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

  async function handleEdit(data: PersonFormData) {
    setSaving(true);
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
      const updated = await api<Person>(`/persons/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setPerson(updated);
      setEditOpen(false);
      toast({
        title: "Person updated",
        description: "Person details updated successfully.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update person";
      toast({
        variant: "destructive",
        title: "Failed to update person",
        description: msg,
      });
    } finally {
      setSaving(false);
    }
  }

  const bloodGroupLabel = useMemo(() => {
    if (!person?.bloodGroup) return "—";
    return BLOOD_GROUPS.find((b) => b.value === person.bloodGroup)?.label ?? person.bloodGroup;
  }, [person?.bloodGroup]);

  const residentTypeLabel = useMemo(() => {
    if (!person?.residentType) return "—";
    return RESIDENT_TYPES.find((r) => r.value === person.residentType)?.label ?? person.residentType;
  }, [person?.residentType]);
  const areaCodeLabel = useMemo(() => {
    if (!person?.areaCode) return "—";
    const zone = zones.find((z) => z.code === person.areaCode);
    return zone ? `${zone.code} - ${zone.name}` : String(person.areaCode);
  }, [person?.areaCode, zones]);

  const age = useMemo(() => getAge(person?.dateOfBirth), [person?.dateOfBirth]);
  const initials = useMemo(() => (person ? getInitials(person) : "P"), [person]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="p-6 max-w-5xl mx-auto">
          <div className="animate-pulse space-y-6">
            <div className="h-4 w-48 bg-muted rounded" />
            <div className="h-24 bg-muted rounded-xl" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 space-y-4">
                <div className="h-64 bg-muted rounded-xl" />
                <div className="h-48 bg-muted rounded-xl" />
              </div>
              <div className="h-48 bg-muted rounded-xl" />
            </div>
          </div>
        </main>
      </div>
    );
  }
  if (!person) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="p-6 max-w-5xl mx-auto flex flex-col items-center justify-center py-20">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <User className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold mb-1">Person Not Found</h2>
          <p className="text-sm text-muted-foreground mb-4">
            The person you are looking for does not exist or has been removed.
          </p>
          <Link href="/persons">
            <Button variant="outline">Back to Manage People</Button>
          </Link>
        </main>
      </div>
    );
  }

  const livingStatusStyle =
    person.livingStatus === "Active"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : person.livingStatus === "Deceased"
      ? "bg-red-50 text-red-700 border-red-200"
      : "bg-amber-50 text-amber-700 border-amber-200";

  const livingStatusDot =
    person.livingStatus === "Active"
      ? "bg-emerald-500"
      : person.livingStatus === "Deceased"
      ? "bg-red-500"
      : "bg-amber-500";

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="p-6 max-w-5xl mx-auto">
        <Breadcrumb
          items={[
            { label: "Dashboard", href: dashboardFlowHref("person") },
            { label: "Manage People", href: "/persons" },
            { label: person.fullName },
          ]}
        />

        {/* ── Hero Section ────────────────────────────── */}
        <div className="mt-2 mb-8 rounded-xl border bg-card overflow-hidden">
          <div className="h-2 bg-gradient-to-r from-primary via-primary/70 to-primary/40" />
          <div className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 rounded-full bg-primary/10 text-primary font-semibold flex items-center justify-center text-lg flex-shrink-0">
                  {initials}
                </div>
                <div>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h1 className="text-xl font-bold text-foreground">
                      {person.fullName}
                    </h1>
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full border ${livingStatusStyle}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${livingStatusDot}`} />
                      {displayValue(person.livingStatus)}
                    </span>
                    {person.isArchived && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">
                        <Archive className="h-3 w-3" />
                        Archived
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {displayValue(person.preferredName || person.nameWithInitials)}
                  </p>
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    {person.gender && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                        <User className="h-3 w-3" />
                        {person.gender}
                      </span>
                    )}
                    {age !== null && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                        <Calendar className="h-3 w-3" />
                        {age} years
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                      <MapPin className="h-3 w-3" />
                      {residentTypeLabel}
                    </span>
                    {person.isMadarasaStudent && (
                      <span className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                        <BookOpen className="h-3 w-3" />
                        Madarasa Student
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <Link href="/persons">
                  <Button variant="outline" size="sm">
                    Back
                  </Button>
                </Link>
                <Button size="sm" className="gap-1.5" onClick={() => setEditOpen(true)}>
                  <Edit className="h-4 w-4" />
                  <span className="hidden sm:inline">Edit</span>
                </Button>
                {person.membershipId && (
                  <Link href={`/members/${person.membershipId}`}>
                    <Button variant="outline" size="sm" className="gap-1.5">
                      <BadgeCheck className="h-4 w-4" />
                      <span className="hidden sm:inline">Membership</span>
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Content Grid ────────────────────────────── */}
        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2 space-y-6">

            {/* Personal Information */}
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <User className="h-5 w-5 text-primary" />
                  Personal Information
                </CardTitle>
              </CardHeader>
              <CardContent>
                <InfoRow label="Title" value={displayValue(person.title)} />
                <InfoRow label="Full Name" value={displayValue(person.fullName)} />
                <InfoRow label="Name with Initials" value={displayValue(person.nameWithInitials)} />
                <InfoRow label="Preferred Name" value={displayValue(person.preferredName)} />
                <InfoRow label="Gender" value={displayValue(person.gender)} />
                <InfoRow label="Date of Birth" value={formatDate(person.dateOfBirth)} />
                <InfoRow label="Age" value={age !== null ? `${age} years` : "—"} />
                <InfoRow label="Marital Status" value={displayValue(person.maritalStatus)} />
                <InfoRow label="Blood Group" value={bloodGroupLabel} />
              </CardContent>
            </Card>

            {/* Contact and Address */}
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <Phone className="h-5 w-5 text-primary" />
                  Contact and Address
                </CardTitle>
              </CardHeader>
              <CardContent>
                <InfoRow
                  label="Mobile Number"
                  value={
                    person.mobileNumber ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                        {person.mobileNumber}
                      </span>
                    ) : (
                      "—"
                    )
                  }
                />
                <InfoRow
                  label="WhatsApp Number"
                  value={
                    person.whatsAppNumber ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                        {person.whatsAppNumber}
                      </span>
                    ) : (
                      "—"
                    )
                  }
                />
                <InfoRow
                  label="Email"
                  value={
                    person.email ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                        {person.email}
                      </span>
                    ) : (
                      "—"
                    )
                  }
                />
                <InfoRow
                  label="Main Address"
                  value={
                    person.address ? (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="text-right">{person.address}</span>
                      </span>
                    ) : (
                      "—"
                    )
                  }
                />
                <InfoRow label="Zone" value={areaCodeLabel} />
              </CardContent>
            </Card>

            {/* Residency and Identity */}
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <Fingerprint className="h-5 w-5 text-primary" />
                  Residency and Identity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <InfoRow label="Resident Type" value={residentTypeLabel} />
                <InfoRow label="Identity Type" value={displayValue(person.identityType)} />
                <InfoRow label="NIC Number" value={displayValue(person.nicNumber)} />
                <InfoRow label="ID Number" value={displayValue(person.idNumber)} />
              </CardContent>
            </Card>

            {/* Employment and Education */}
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <Briefcase className="h-5 w-5 text-primary" />
                  Employment and Education
                </CardTitle>
              </CardHeader>
              <CardContent>
                <InfoRow label="Occupation" value={displayValue(person.occupation)} />
                <InfoRow label="Place of Work" value={displayValue(person.placeOfWork)} />
                <InfoRow
                  label="Highest Qualification Type"
                  value={displayValue(person.highestQualificationType)}
                />
                <InfoRow
                  label="Highest Qualification Title"
                  value={displayValue(person.highestQualificationTitle)}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <MessageSquareText className="h-5 w-5 text-primary" />
                  Activity Feed
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ActivityFeedPanel
                  resourcePath={`/persons/${id}/feed`}
                  placeholder="Write a remark for this person..."
                  emptyMessage="No remarks or activity recorded yet."
                />
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">

            {/* Status and Membership */}
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-5 w-5 text-primary" />
                  Status and Membership
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <InfoRow label="Living Status" value={displayValue(person.livingStatus)} />
                <InfoRow label="Archived" value={person.isArchived ? "Yes" : "No"} />
                <InfoRow
                  label="Local Madarasa Student"
                  value={person.isMadarasaStudent ? "Yes" : "No"}
                />
                <InfoRow
                  label="Permanent Disability"
                  value={displayValue(person.permanentDisability)}
                />
                <div className="pt-3 border-t border-border/40">
                  {person.membershipId ? (
                    <Link href={`/members/${person.membershipId}`}>
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/10 hover:bg-primary/10 transition-colors cursor-pointer">
                        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                          <BadgeCheck className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">View Membership</p>
                          <p className="text-xs text-muted-foreground">
                            Linked to a membership
                          </p>
                        </div>
                        <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 p-3 rounded-lg border border-dashed">
                      <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center">
                        <Shield className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-muted-foreground">
                          No Membership Linked
                        </p>
                        <p className="text-xs text-muted-foreground">
                          This person is not part of a membership
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

          </div>
        </div>
      </main>

      <Dialog open={editOpen} onOpenChange={(o) => !o && setEditOpen(false)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Person</DialogTitle>
          </DialogHeader>
          {person && (
            <PersonForm
              initial={personToFormData(person)}
              zones={zones}
              onSubmit={handleEdit}
              onCancel={() => setEditOpen(false)}
              submitLabel={saving ? "Saving…" : "Save"}
              disabled={saving}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
