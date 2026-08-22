"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type DependentGroup, type Membership, type MembershipStatus, type Person, type RelationToHOH, type Zone } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PersonForm, type PersonFormData } from "@/components/person-form";
import { Header } from "@/components/header";
import { Breadcrumb } from "@/components/breadcrumb";
import { CHILD_RELATION_OPTIONS, OTHER_DEPENDENT_RELATION_OPTIONS } from "@/lib/constants";
import { toast } from "@/hooks/use-toast";
import { dashboardFlowHref } from "@/lib/dashboard-flows";
import { useFormVisibility } from "@/lib/form-visibility";

const PAYMENT_PERIODS = ["Monthly", "Quarterly", "Annually"] as const;
const MEMBERSHIP_TYPES = ["Resident", "NonResident", "Widow", "Widower"];
const MAX_ZONE_CODE = 9;
type DependentEntry = {
  id: string;
  fullName: string;
  nameWithInitials: string;
  group: DependentGroup;
  relationToHOH: RelationToHOH;
};

function defaultDependentRelation(group: DependentGroup): RelationToHOH {
  return group === "children" ? "Son" : "Cousin";
}

export default function EditMembershipPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const [membership, setMembership] = useState<Membership | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [addPersonOpen, setAddPersonOpen] = useState<"hod" | "spouse" | "dependent" | null>(null);
  const [editPerson, setEditPerson] = useState<{ id: string; role: "hod" | "spouse" | "dependent"; index?: number; initial?: Partial<PersonFormData> } | null>(null);

  // HoD
  const [hodPerson, setHodPerson] = useState<{ id: string; fullName: string; nameWithInitials: string; nicNumber?: string | null } | null>(null);
  const [hodSearch, setHodSearch] = useState("");
  const [hodResults, setHodResults] = useState<Person[]>([]);

  // Spouse
  const [spousePerson, setSpousePerson] = useState<{ id: string; fullName: string; nameWithInitials: string; nicNumber?: string | null } | null>(null);
  const [spouseSearch, setSpouseSearch] = useState("");
  const [spouseResults, setSpouseResults] = useState<Person[]>([]);

  // Dependents
  const [dependentPersons, setDependentPersons] = useState<DependentEntry[]>([]);
  const [newDependentGroup, setNewDependentGroup] = useState<DependentGroup>("children");
  const [depSearch, setDepSearch] = useState("");
  const [depResults, setDepResults] = useState<Person[]>([]);

  const [dateOfRegistration, setDateOfRegistration] = useState("");
  const [membershipType, setMembershipType] = useState("Resident");
  const [membershipStatus, setMembershipStatus] = useState<MembershipStatus>("Active");
  const [land, setLand] = useState(false);
  const [houseOwnership, setHouseOwnership] = useState(false);
  const [commercialProperties, setCommercialProperties] = useState(false);
  const [toiletFacility, setToiletFacility] = useState(false);
  const [vehicleOwnership, setVehicleOwnership] = useState(false);
  const [waterAccessibility, setWaterAccessibility] = useState(false);
  const [electricity, setElectricity] = useState(false);
  const [paymentPeriod, setPaymentPeriod] = useState<"Monthly" | "Quarterly" | "Annually">("Monthly");
  const [membershipFee, setMembershipFee] = useState("0");
  const [additionalContributions, setAdditionalContributions] = useState("0");
  const [membershipFeeDiscount, setMembershipFeeDiscount] = useState("0");
  const [disability, setDisability] = useState(false);
  const [isZakathEligible, setIsZakathEligible] = useState<boolean | null>(null);
  const [areaCode, setAreaCode] = useState("");
  const [zones, setZones] = useState<Zone[]>([]);

  const orgId = membership?.organizationId ?? user?.organizationId ?? null;
  const membershipFields = useFormVisibility("Membership", orgId);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!orgId) return;
    const params: Record<string, string> = { includeInactive: "true" };
    if (user?.role === "super_user") params.organizationId = orgId;
    api<Zone[]>("/zones", { params })
      .then(setZones)
      .catch(() => setZones([]));
  }, [orgId, user?.role]);

  useEffect(() => {
    if (!user || !id) return;
    api<Membership>(`/memberships/${id}`)
      .then((m) => {
        setMembership(m);
        setDateOfRegistration(m.dateOfRegistration ? m.dateOfRegistration.slice(0, 10) : "");
        setMembershipType(m.membershipType ?? "Resident");
        setMembershipStatus(m.membershipStatus ?? "Active");
        if (m.hod) setHodPerson({ id: m.hod.id, fullName: m.hod.fullName, nameWithInitials: m.hod.nameWithInitials, nicNumber: m.hod.nicNumber });
        if (m.spouse) setSpousePerson({ id: m.spouse.id, fullName: m.spouse.fullName, nameWithInitials: m.spouse.nameWithInitials });
        const deps = m.dependents ?? [];
        setDependentPersons(
          deps.map((d) => ({
            id: d.person.id,
            fullName: d.person.fullName,
            nameWithInitials: d.person.nameWithInitials,
            group: d.group ?? "other",
            relationToHOH: d.person.relationToHOH ?? defaultDependentRelation(d.group ?? "other"),
          }))
        );
        setLand(m.land ?? false);
        setHouseOwnership(m.houseOwnership ?? false);
        setCommercialProperties(m.commercialProperties ?? false);
        setToiletFacility(m.toiletFacility ?? false);
        setVehicleOwnership(m.vehicleOwnership ?? false);
        setWaterAccessibility(m.waterAccessibility ?? false);
        setElectricity(m.electricity ?? false);
        setPaymentPeriod(m.paymentPeriod ?? "Monthly");
        setMembershipFee(String(Number(m.membershipFee)));
        setAdditionalContributions(String(Number(m.additionalVoluntaryContributions ?? 0)));
        setMembershipFeeDiscount(String(Number(m.membershipFeeDiscount ?? 0)));
        setDisability(m.disability ?? false);
        setIsZakathEligible(m.isZakathEligible ?? null);
        setAreaCode(m.areaCode ? String(m.areaCode) : "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user, id]);

  // Person search effects
  useEffect(() => {
    if (!orgId || !hodSearch.trim()) { setHodResults([]); return; }
    const t = setTimeout(() => {
      api<{ items: Person[] }>("/persons", {
        params: { q: hodSearch.trim(), limit: "10", organizationId: orgId },
      }).then((r) => setHodResults(r.items)).catch(() => setHodResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [hodSearch, orgId]);

  useEffect(() => {
    if (!orgId || !spouseSearch.trim()) { setSpouseResults([]); return; }
    const t = setTimeout(() => {
      api<{ items: Person[] }>("/persons", {
        params: { q: spouseSearch.trim(), limit: "10", organizationId: orgId },
      }).then((r) => setSpouseResults(r.items)).catch(() => setSpouseResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [spouseSearch, orgId]);

  useEffect(() => {
    if (!orgId || !depSearch.trim()) { setDepResults([]); return; }
    const t = setTimeout(() => {
      api<{ items: Person[] }>("/persons", {
        params: { q: depSearch.trim(), limit: "10", organizationId: orgId },
      }).then((r) => setDepResults(r.items)).catch(() => setDepResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [depSearch, orgId]);

  const fee = parseFloat(membershipFee) || 0;
  const add = parseFloat(additionalContributions) || 0;
  const disc = parseFloat(membershipFeeDiscount) || 0;
  const computedTotal = Math.max(0, fee + add - disc);

  async function handleCreatePerson(data: PersonFormData) {
    try {
      const payload = {
        organizationId: orgId,
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
        schoolName: data.schoolName || undefined,
        permanentDisability: data.permanentDisability || undefined,
        livingStatus: data.livingStatus || undefined,
        isMadarasaStudent: data.isMadarasaStudent,
      };
      const created = await api<Person>("/persons", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (addPersonOpen === "hod") setHodPerson(created);
      if (addPersonOpen === "spouse") setSpousePerson(created);
      if (addPersonOpen === "dependent") {
        setDependentPersons((prev) => [
          ...prev,
          {
            id: created.id,
            fullName: created.fullName,
            nameWithInitials: created.nameWithInitials,
            group: newDependentGroup,
            relationToHOH: defaultDependentRelation(newDependentGroup),
          },
        ]);
      }
      setAddPersonOpen(null);
      toast({
        title: "Person added",
        description: "Person created successfully.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create person";
      setError(msg);
      toast({
        variant: "destructive",
        title: "Failed to add person",
        description: msg,
      });
    }
  }

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
      dateOfBirth: p.dateOfBirth ? p.dateOfBirth.slice(0, 10) : "",
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
      schoolName: p.schoolName ?? "",
      permanentDisability: p.permanentDisability ?? "",
      livingStatus: p.livingStatus ?? "Active",
      isMadarasaStudent: p.isMadarasaStudent ?? false,
    };
  }

  async function openEditPerson(personId: string, role: "hod" | "spouse" | "dependent", index?: number) {
    try {
      const p = await api<Person>(`/persons/${personId}`);
      setEditPerson({ id: personId, role, index, initial: personToFormData(p) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load person details.";
      setError(msg);
      toast({
        variant: "destructive",
        title: "Failed to load person",
        description: msg,
      });
    }
  }

  async function handleEditPerson(data: PersonFormData) {
    if (!editPerson) return;
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
    try {
      const updated = await api<Person>(`/persons/${editPerson.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      if (editPerson.role === "hod") setHodPerson(updated);
      if (editPerson.role === "spouse") setSpousePerson(updated);
      if (editPerson.role === "dependent") {
        setDependentPersons((prev) =>
          prev.map((p) =>
            p.id === updated.id ? { ...p, fullName: updated.fullName, nameWithInitials: updated.nameWithInitials } : p
          )
        );
      }
      setEditPerson(null);
      toast({
        title: "Person updated",
        description: "Person details updated successfully.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update person";
      setError(msg);
      toast({
        variant: "destructive",
        title: "Failed to update person",
        description: msg,
      });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!hodPerson) {
      const msg = "Head of household is required.";
      setError(msg);
      toast({
        variant: "destructive",
        title: "Cannot update membership",
        description: msg,
      });
      return;
    }
    if (membershipFields.required("areaCode") && !areaCode) {
      const msg = "Zone is required.";
      setError(msg);
      toast({
        variant: "destructive",
        title: "Cannot update membership",
        description: msg,
      });
      return;
    }
    setSaving(true);
    try {
      await api(`/memberships/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          dateOfRegistration,
          membershipType,
          membershipStatus,
          hodPersonId: hodPerson.id,
          spousePersonId: spousePerson?.id ?? null,
          spouseRelationToHOH: spousePerson ? "Wife" : null,
          dependentPersons: dependentPersons.map((p) => ({
            personId: p.id,
            relationToHOH: p.relationToHOH,
            group: p.group,
          })),
          land,
          houseOwnership,
          commercialProperties,
          toiletFacility,
          vehicleOwnership,
          waterAccessibility,
          electricity,
          paymentPeriod,
          membershipFee: fee,
          additionalVoluntaryContributions: add,
          membershipFeeDiscount: disc,
          totalContribution: computedTotal,
          disability,
          isZakathEligible,
          areaCode: membershipFields.visible("areaCode") && areaCode ? Number(areaCode) : null,
        }),
      });
      toast({
        title: "Membership updated",
        description: "Membership changes saved successfully.",
      });
      router.push(`/members/${id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update";
      setError(msg);
      toast({
        variant: "destructive",
        title: "Failed to update membership",
        description: msg,
      });
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || !user) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (loading) return <div className="p-8 text-muted-foreground">Loading membership…</div>;
  if (!membership) return <div className="p-8 text-muted-foreground">Not found.</div>;

  const isActive = membershipStatus === "Active";

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="p-6 max-w-3xl mx-auto">
        <Breadcrumb
          items={[
            { label: "Dashboard", href: dashboardFlowHref("membership") },
            { label: "Members", href: "/members" },
            { label: membership.membershipNo, href: `/members/${id}` },
            { label: "Edit" },
          ]}
        />
        <h1 className="text-xl font-semibold text-foreground mb-6">
          Edit {membership.membershipNo}
        </h1>

        <form onSubmit={handleSubmit}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Membership Details</CardTitle>
                <button hidden={!membershipFields.visible("membershipStatus")}
                  type="button"
                  onClick={() => setMembershipStatus(isActive ? "Inactive" : "Active")}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${isActive ? "bg-green-500" : "bg-gray-300"}`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${isActive ? "translate-x-5" : "translate-x-0"}`}
                  />
                  <span className="sr-only">Toggle status</span>
                </button>
              </div>
              <p hidden={!membershipFields.visible("membershipStatus")} className="text-xs text-muted-foreground mt-1">
                Status: <span className={isActive ? "text-green-600 font-medium" : "text-red-500 font-medium"}>{membershipStatus}</span>
              </p>
            </CardHeader>
            <CardContent className="space-y-6">

              {/* Head of household */}
              <div className="space-y-2">
                <Label className="font-semibold">
                  Head of Household <span className="text-destructive">*</span>
                </Label>
                {hodPerson ? (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2 bg-muted/50 rounded-md border">
                    <span className="text-sm truncate">
                      {hodPerson.fullName}{" "}
                      <span className="text-muted-foreground text-xs">({hodPerson.nameWithInitials})</span>
                    </span>
                    <div className="flex gap-1 flex-shrink-0">
                      <Button type="button" variant="ghost" size="sm" onClick={() => openEditPerson(hodPerson.id, "hod")}>
                        Edit
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setHodPerson(null)}>
                        Clear
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="relative">
                      <Input
                        placeholder="Search by name or NIC…"
                        value={hodSearch}
                        onChange={(e) => setHodSearch(e.target.value)}
                      />
                      {hodResults.length > 0 && (
                        <ul className="absolute z-10 mt-1 w-full bg-background border rounded-md shadow-md divide-y max-h-40 overflow-auto">
                          {hodResults.map((p) => (
                            <li key={p.id}>
                              <button
                                type="button"
                                className="w-full text-left px-3 py-2 hover:bg-muted text-sm"
                                onClick={() => { setHodPerson(p); setHodSearch(""); setHodResults([]); }}
                              >
                                {p.fullName} ({p.nameWithInitials}){p.nicNumber && ` – ${p.nicNumber}`}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => setAddPersonOpen("hod")}>
                      + Add New Person
                    </Button>
                  </div>
                )}
              </div>

              <hr className="border-border" />

              {/* Spouse */}
              <div className="space-y-2">
                <Label className="font-semibold">
                  Spouse{" "}
                  <span className="text-muted-foreground text-xs font-normal">(optional)</span>
                </Label>
                {spousePerson ? (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2 bg-muted/50 rounded-md border">
                    <span className="text-sm truncate">
                      {spousePerson.fullName}{" "}
                      <span className="text-muted-foreground text-xs">({spousePerson.nameWithInitials})</span>
                    </span>
                    <div className="flex gap-1 flex-shrink-0">
                      <Button type="button" variant="ghost" size="sm" onClick={() => openEditPerson(spousePerson.id, "spouse")}>
                        Edit
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setSpousePerson(null)}>
                        Clear
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="relative">
                      <Input
                        placeholder="Search by name or NIC…"
                        value={spouseSearch}
                        onChange={(e) => setSpouseSearch(e.target.value)}
                      />
                      {spouseResults.length > 0 && (
                        <ul className="absolute z-10 mt-1 w-full bg-background border rounded-md shadow-md divide-y max-h-40 overflow-auto">
                          {spouseResults.map((p) => (
                            <li key={p.id}>
                              <button
                                type="button"
                                className="w-full text-left px-3 py-2 hover:bg-muted text-sm"
                                onClick={() => {
                                  setSpousePerson(p);
                                  setSpouseSearch("");
                                  setSpouseResults([]);
                                }}
                              >
                                {p.fullName} ({p.nameWithInitials}){p.nicNumber && ` – ${p.nicNumber}`}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => setAddPersonOpen("spouse")}>
                      + Add New Person
                    </Button>
                  </div>
                )}
                {spousePerson && (
                  <div className="space-y-2">
                    <Label>Relation to Head of Household</Label>
                    <Input value="Wife" className="w-44" disabled />
                  </div>
                )}
              </div>

              <hr className="border-border" />

              {/* Dependents */}
              <div className="space-y-2">
                <Label className="font-semibold">
                  Dependents{" "}
                  <span className="text-muted-foreground text-xs font-normal">(optional)</span>
                </Label>
                {(["children", "other"] as DependentGroup[]).map((group) => {
                  const items = dependentPersons.filter((p) => p.group === group);
                  if (items.length === 0) return null;
                  return (
                    <div key={group} className="space-y-1">
                      <p className="text-xs uppercase text-muted-foreground">
                        {group === "children" ? "Children" : "Other Dependents"}
                      </p>
                      <ul className="space-y-1">
                        {items.map((p) => {
                          const listIndex = dependentPersons.findIndex((x) => x.id === p.id);
                          return (
                            <li
                              key={p.id}
                              className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2 bg-muted/50 rounded-md border"
                            >
                              <span className="text-sm truncate">
                                {p.fullName}{" "}
                                <span className="text-muted-foreground text-xs">({p.nameWithInitials})</span>
                              </span>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <Select
                                  value={p.relationToHOH}
                                  onValueChange={(value: RelationToHOH) =>
                                    setDependentPersons((prev) =>
                                      prev.map((item) =>
                                        item.id === p.id ? { ...item, relationToHOH: value } : item
                                      )
                                    )
                                  }
                                >
                                  <SelectTrigger className="h-8 w-36 sm:w-44"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {(p.group === "children" ? CHILD_RELATION_OPTIONS : OTHER_DEPENDENT_RELATION_OPTIONS).map((opt) => (
                                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Button type="button" variant="ghost" size="sm" onClick={() => openEditPerson(p.id, "dependent", listIndex)}>
                                  Edit
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setDependentPersons((prev) => prev.filter((x) => x.id !== p.id))}
                                >
                                  Remove
                                </Button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
                <div className="space-y-2">
                  <div className="space-y-1">
                    <Label>Add to Group</Label>
                    <Select value={newDependentGroup} onValueChange={(v: DependentGroup) => setNewDependentGroup(v)}>
                      <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="children">Children</SelectItem>
                        <SelectItem value="other">Other Dependents</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="relative">
                    <Input
                      placeholder="Search by name or NIC…"
                      value={depSearch}
                      onChange={(e) => setDepSearch(e.target.value)}
                    />
                    {depResults.length > 0 && (
                      <ul className="absolute z-10 mt-1 w-full bg-background border rounded-md shadow-md divide-y max-h-40 overflow-auto">
                        {depResults.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              className="w-full text-left px-3 py-2 hover:bg-muted text-sm"
                              onClick={() => {
                                if (!dependentPersons.find((d) => d.id === p.id)) {
                                  setDependentPersons((prev) => [
                                    ...prev,
                                    {
                                      id: p.id,
                                      fullName: p.fullName,
                                      nameWithInitials: p.nameWithInitials,
                                      group: newDependentGroup,
                                      relationToHOH: defaultDependentRelation(newDependentGroup),
                                    },
                                  ]);
                                }
                                setDepSearch("");
                                setDepResults([]);
                              }}
                            >
                              {p.fullName} ({p.nameWithInitials}){p.nicNumber && ` – ${p.nicNumber}`}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setAddPersonOpen("dependent")}>
                    + Add New Person
                  </Button>
                </div>
              </div>

              <hr className="border-border" />

              {/* Registration & type */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Date of Registration</Label>
                  <Input
                    type="date"
                    value={dateOfRegistration}
                    onChange={(e) => setDateOfRegistration(e.target.value)}
                    required
                  />
                </div>
                <div hidden={!membershipFields.visible("membershipType")} className="space-y-2">
                  <Label>Membership Type {membershipFields.required("membershipType") && <span className="text-destructive">*</span>}</Label>
                  <Select value={membershipType} onValueChange={setMembershipType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MEMBERSHIP_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div hidden={!membershipFields.visible("paymentPeriod")} className="space-y-2">
                  <Label>Payment Period {membershipFields.required("paymentPeriod") && <span className="text-destructive">*</span>}</Label>
                  <Select
                    value={paymentPeriod}
                    onValueChange={(v: "Monthly" | "Quarterly" | "Annually") => setPaymentPeriod(v)}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_PERIODS.map((p) => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <hr className="border-border" />

              {/* Household facilities */}
              <div className="space-y-2">
                <Label className="font-semibold">Household Facilities</Label>
                <div className="rounded-md border overflow-hidden divide-y text-sm">
                  {(
                    [
                      ["land", "Land", land, setLand],
                      ["houseOwnership", "House Ownership", houseOwnership, setHouseOwnership],
                      ["commercialProperties", "Commercial Properties", commercialProperties, setCommercialProperties],
                      ["toiletFacility", "Toilet Facility", toiletFacility, setToiletFacility],
                      ["vehicleOwnership", "Vehicle Ownership", vehicleOwnership, setVehicleOwnership],
                      ["waterAccessibility", "Water Accessibility", waterAccessibility, setWaterAccessibility],
                      ["electricity", "Electricity", electricity, setElectricity],
                    ] as [string, string, boolean, (v: boolean) => void][]
                  ).filter(([field]) => membershipFields.visible(field)).map(([field, label, val, set]) => (
                    <label
                      key={field}
                      className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-muted/40 transition-colors"
                    >
                      <span>{label}{membershipFields.required(field) && <span className="text-destructive"> *</span>}</span>
                      <Checkbox checked={val} onCheckedChange={(c) => set(!!c)} />
                    </label>
                  ))}
                </div>
              </div>

              <hr className="border-border" />

              {/* Contributions — receipt style */}
              <div className="space-y-2">
                <Label className="font-semibold">Contributions</Label>
                <div className="rounded-md border overflow-hidden divide-y text-sm">
                  <div hidden={!membershipFields.visible("membershipFee")} className="flex items-center justify-between px-4 py-3">
                    <span className="text-muted-foreground">Membership Fee</span>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={membershipFee}
                      onChange={(e) => setMembershipFee(e.target.value)}
                      className="w-36 text-right h-8"
                      required={membershipFields.required("membershipFee")}
                    />
                  </div>
                  <div hidden={!membershipFields.visible("additionalVoluntaryContributions")} className="flex items-center justify-between px-4 py-3">
                    <span className="text-muted-foreground">Additional Voluntary Contributions</span>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={additionalContributions}
                      onChange={(e) => setAdditionalContributions(e.target.value)}
                      className="w-36 text-right h-8"
                    />
                  </div>
                  <div hidden={!membershipFields.visible("membershipFeeDiscount")} className="flex items-center justify-between px-4 py-3">
                    <span className="text-muted-foreground">Discount</span>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={membershipFeeDiscount}
                      onChange={(e) => setMembershipFeeDiscount(e.target.value)}
                      className="w-36 text-right h-8"
                    />
                  </div>
                  <div hidden={!membershipFields.visible("totalContribution")} className="flex items-center justify-between px-4 py-3 bg-muted/40">
                    <span className="font-semibold">Total</span>
                    <span className="text-base font-semibold tabular-nums">{computedTotal.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              <hr className="border-border" />

              {/* Disability */}
              <div hidden={!membershipFields.visible("disability")} className="space-y-2">
                <Label>Disability in Household</Label>
                <Select
                  value={disability ? "yes" : "no"}
                  onValueChange={(v) => setDisability(v === "yes")}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div hidden={!membershipFields.visible("isZakathEligible")} className="space-y-2">
                  <Label>Zakath Eligible</Label>
                  <Select
                    value={isZakathEligible === null ? "unset" : isZakathEligible ? "yes" : "no"}
                    onValueChange={(v) =>
                      setIsZakathEligible(v === "unset" ? null : v === "yes")
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unset">Not Set</SelectItem>
                      <SelectItem value="yes">Yes</SelectItem>
                      <SelectItem value="no">No</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div hidden={!membershipFields.visible("areaCode")} className="space-y-2">
                  <Label>Zone {membershipFields.required("areaCode") && <span className="text-destructive">*</span>}</Label>
                  <Select
                    value={areaCode || undefined}
                    onValueChange={setAreaCode}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select zone" />
                    </SelectTrigger>
                    <SelectContent>
                      {zones
                        .filter(
                          (z) =>
                            z.code >= 1 &&
                            z.code <= MAX_ZONE_CODE &&
                            (z.isActive || String(z.code) === areaCode)
                        )
                        .map((z) => (
                          <SelectItem key={z.id} value={String(z.code)}>
                            {z.code} — {z.name}{!z.isActive ? " (Inactive)" : ""}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex gap-2 pt-2">
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
                <Link href={`/members/${id}`}>
                  <Button type="button" variant="outline">Cancel</Button>
                </Link>
              </div>

            </CardContent>
          </Card>
        </form>
      </main>

      {/* Add person dialog */}
      <Dialog open={!!addPersonOpen} onOpenChange={(open) => !open && setAddPersonOpen(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {addPersonOpen === "hod" && "Add Head of Household"}
              {addPersonOpen === "spouse" && "Add Spouse"}
              {addPersonOpen === "dependent" && "Add Dependent"}
            </DialogTitle>
          </DialogHeader>
          <PersonForm
            organizationId={orgId}
            zones={zones}
            onSubmit={handleCreatePerson}
            onCancel={() => setAddPersonOpen(null)}
            submitLabel="Add Person"
          />
        </DialogContent>
      </Dialog>

      {/* Edit person dialog */}
      <Dialog open={!!editPerson} onOpenChange={(open) => !open && setEditPerson(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Person</DialogTitle>
          </DialogHeader>
          {editPerson?.initial && (
            <PersonForm
              organizationId={orgId}
              initial={editPerson.initial}
              zones={zones}
              onSubmit={handleEditPerson}
              onCancel={() => setEditPerson(null)}
              submitLabel="Save Changes"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
