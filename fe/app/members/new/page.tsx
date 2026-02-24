"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type Person } from "@/lib/api";
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

const PAYMENT_PERIODS = ["Monthly", "Quarterly", "Annually"] as const;
const MEMBERSHIP_TYPES = ["Resident", "NonResident", "Widow", "Widower"];

export default function NewMembershipPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [orgs, setOrgs] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");

  // Head of household
  const [hodPerson, setHodPerson] = useState<Person | null>(null);
  const [hodSearch, setHodSearch] = useState("");
  const [hodResults, setHodResults] = useState<Person[]>([]);

  // Spouse
  const [spousePerson, setSpousePerson] = useState<Person | null>(null);
  const [spouseSearch, setSpouseSearch] = useState("");
  const [spouseResults, setSpouseResults] = useState<Person[]>([]);

  // Dependents
  const [dependentPersons, setDependentPersons] = useState<Person[]>([]);
  const [depSearch, setDepSearch] = useState("");
  const [depResults, setDepResults] = useState<Person[]>([]);

  const [addPersonOpen, setAddPersonOpen] = useState<"hod" | "spouse" | "dependent" | null>(null);
  const [editPerson, setEditPerson] = useState<{ id: string; role: "hod" | "spouse" | "dependent"; index?: number; initial?: Partial<PersonFormData> } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [dateOfRegistration, setDateOfRegistration] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [membershipType, setMembershipType] = useState("Resident");
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

  const effectiveOrgId =
    user?.role === "super_user" ? selectedOrgId : (user?.organizationId ?? null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user || user.role !== "super_user") return;
    api<{ id: string; name: string; slug: string }[]>("/organizations")
      .then(setOrgs)
      .catch(() => setOrgs([]));
  }, [user]);

  useEffect(() => {
    if (!effectiveOrgId || !hodSearch.trim()) { setHodResults([]); return; }
    const t = setTimeout(() => {
      api<{ items: Person[] }>("/persons", {
        params: { q: hodSearch.trim(), limit: "10", organizationId: effectiveOrgId },
      }).then((r) => setHodResults(r.items)).catch(() => setHodResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [hodSearch, effectiveOrgId]);

  useEffect(() => {
    if (!effectiveOrgId || !spouseSearch.trim()) { setSpouseResults([]); return; }
    const t = setTimeout(() => {
      api<{ items: Person[] }>("/persons", {
        params: { q: spouseSearch.trim(), limit: "10", organizationId: effectiveOrgId },
      }).then((r) => setSpouseResults(r.items)).catch(() => setSpouseResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [spouseSearch, effectiveOrgId]);

  useEffect(() => {
    if (!effectiveOrgId || !depSearch.trim()) { setDepResults([]); return; }
    const t = setTimeout(() => {
      api<{ items: Person[] }>("/persons", {
        params: { q: depSearch.trim(), limit: "10", organizationId: effectiveOrgId },
      }).then((r) => setDepResults(r.items)).catch(() => setDepResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [depSearch, effectiveOrgId]);

  if (authLoading || !user) return <div className="p-8 text-muted-foreground">Loading…</div>;

  const isSuperUser = user.role === "super_user";
  const orgId = effectiveOrgId;

  const fee = parseFloat(membershipFee) || 0;
  const add = parseFloat(additionalContributions) || 0;
  const disc = parseFloat(membershipFeeDiscount) || 0;
  const computedTotal = Math.max(0, fee + add - disc);

  async function handleCreatePerson(data: PersonFormData) {
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
      mobileNumber: data.mobileNumber || undefined,
      whatsAppNumber: data.whatsAppNumber || undefined,
      email: data.email || undefined,
      occupation: data.occupation || undefined,
      placeOfWork: data.placeOfWork || undefined,
      highestQualificationType: data.highestQualificationType || undefined,
      livingStatus: data.livingStatus || undefined,
      isMadarasaStudent: data.isMadarasaStudent,
    };
    const created = await api<Person>("/persons", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (addPersonOpen === "hod") setHodPerson(created);
    if (addPersonOpen === "spouse") setSpousePerson(created);
    if (addPersonOpen === "dependent") setDependentPersons((prev) => [...prev, created]);
    setAddPersonOpen(null);
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
      mobileNumber: p.mobileNumber ?? "",
      whatsAppNumber: p.whatsAppNumber ?? "",
      email: p.email ?? "",
      occupation: p.occupation ?? "",
      placeOfWork: p.placeOfWork ?? "",
      highestQualificationType: p.highestQualificationType ?? "",
      livingStatus: p.livingStatus ?? "Active",
      isMadarasaStudent: p.isMadarasaStudent ?? false,
    };
  }

  async function openEditPerson(personId: string, role: "hod" | "spouse" | "dependent", index?: number) {
    try {
      const p = await api<Person>(`/persons/${personId}`);
      setEditPerson({ id: personId, role, index, initial: personToFormData(p) });
    } catch {
      setError("Failed to load person details.");
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
      mobileNumber: data.mobileNumber || undefined,
      whatsAppNumber: data.whatsAppNumber || undefined,
      email: data.email || undefined,
      occupation: data.occupation || undefined,
      placeOfWork: data.placeOfWork || undefined,
      highestQualificationType: data.highestQualificationType || undefined,
      livingStatus: data.livingStatus || undefined,
      isMadarasaStudent: data.isMadarasaStudent,
    };
    const updated = await api<Person>(`/persons/${editPerson.id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    if (editPerson.role === "hod") setHodPerson(updated);
    if (editPerson.role === "spouse") setSpousePerson(updated);
    if (editPerson.role === "dependent") {
      setDependentPersons((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    }
    setEditPerson(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (isSuperUser && !selectedOrgId) {
      setError("Please select an organization.");
      return;
    }
    if (!hodPerson) {
      setError("Head of household is required.");
      return;
    }
    setSaving(true);
    try {
      await api("/memberships", {
        method: "POST",
        body: JSON.stringify({
          organizationId: orgId,
          dateOfRegistration,
          membershipType,
          membershipStatus: "Active",
          hodPersonId: hodPerson.id,
          spousePersonId: spousePerson?.id ?? null,
          dependentPersonIds: dependentPersons.map((p) => p.id),
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
        }),
      });
      router.push("/members");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create membership");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="p-6 max-w-3xl mx-auto">
        <Breadcrumb
          items={[
            { label: "Dashboard", href: "/" },
            { label: "Members", href: "/members" },
            { label: "New membership" },
          ]}
        />
        <h1 className="text-xl font-semibold text-foreground mb-6">New membership</h1>

        <form onSubmit={handleSubmit}>
          <Card>
            <CardHeader>
              <CardTitle>Membership details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">

              {/* Organization — super_user only */}
              {isSuperUser && (
                <>
                  <div className="space-y-2">
                    <Label>Organization</Label>
                    <Select
                      value={selectedOrgId}
                      onValueChange={(v) => {
                        setSelectedOrgId(v);
                        setHodPerson(null); setHodSearch(""); setHodResults([]);
                        setSpousePerson(null); setSpouseSearch(""); setSpouseResults([]);
                        setDependentPersons([]); setDepSearch(""); setDepResults([]);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select organization" />
                      </SelectTrigger>
                      <SelectContent>
                        {orgs.map((o) => (
                          <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <hr className="border-border" />
                </>
              )}

              {/* Head of household */}
              <div className="space-y-2">
                <Label className="font-semibold">
                  Head of household <span className="text-destructive">*</span>
                </Label>
                {hodPerson ? (
                  <div className="flex items-center justify-between px-3 py-2 bg-muted/50 rounded-md border">
                    <span className="text-sm">
                      {hodPerson.fullName}{" "}
                      <span className="text-muted-foreground text-xs">({hodPerson.nameWithInitials})</span>
                    </span>
                    <div className="flex gap-1">
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
                      + Add new person
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
                  <div className="flex items-center justify-between px-3 py-2 bg-muted/50 rounded-md border">
                    <span className="text-sm">
                      {spousePerson.fullName}{" "}
                      <span className="text-muted-foreground text-xs">({spousePerson.nameWithInitials})</span>
                    </span>
                    <div className="flex gap-1">
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
                                onClick={() => { setSpousePerson(p); setSpouseSearch(""); setSpouseResults([]); }}
                              >
                                {p.fullName} ({p.nameWithInitials}){p.nicNumber && ` – ${p.nicNumber}`}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => setAddPersonOpen("spouse")}>
                      + Add new person
                    </Button>
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
                {dependentPersons.length > 0 && (
                  <ul className="space-y-1">
                    {dependentPersons.map((p, i) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between px-3 py-2 bg-muted/50 rounded-md border"
                      >
                        <span className="text-sm">
                          {p.fullName}{" "}
                          <span className="text-muted-foreground text-xs">({p.nameWithInitials})</span>
                        </span>
                        <div className="flex gap-1">
                          <Button type="button" variant="ghost" size="sm" onClick={() => openEditPerson(p.id, "dependent", i)}>
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setDependentPersons((prev) => prev.filter((_, j) => j !== i))}
                          >
                            Remove
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="space-y-2">
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
                                  setDependentPersons((prev) => [...prev, p]);
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
                    + Add new person
                  </Button>
                </div>
              </div>

              <hr className="border-border" />

              {/* Registration & type */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Date of registration</Label>
                  <Input
                    type="date"
                    value={dateOfRegistration}
                    onChange={(e) => setDateOfRegistration(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Membership type</Label>
                  <Select value={membershipType} onValueChange={setMembershipType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MEMBERSHIP_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Payment period</Label>
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
                <Label className="font-semibold">Household facilities</Label>
                <div className="rounded-md border overflow-hidden divide-y text-sm">
                  {(
                    [
                      ["Land", land, setLand],
                      ["House ownership", houseOwnership, setHouseOwnership],
                      ["Commercial properties", commercialProperties, setCommercialProperties],
                      ["Toilet facility", toiletFacility, setToiletFacility],
                      ["Vehicle ownership", vehicleOwnership, setVehicleOwnership],
                      ["Water accessibility", waterAccessibility, setWaterAccessibility],
                      ["Electricity", electricity, setElectricity],
                    ] as [string, boolean, (v: boolean) => void][]
                  ).map(([label, val, set]) => (
                    <label
                      key={label}
                      className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-muted/40 transition-colors"
                    >
                      <span>{label}</span>
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
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-muted-foreground">Membership fee</span>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={membershipFee}
                      onChange={(e) => setMembershipFee(e.target.value)}
                      className="w-36 text-right h-8"
                    />
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-muted-foreground">Additional voluntary contributions</span>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={additionalContributions}
                      onChange={(e) => setAdditionalContributions(e.target.value)}
                      className="w-36 text-right h-8"
                    />
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
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
                  <div className="flex items-center justify-between px-4 py-3 bg-muted/40">
                    <span className="font-semibold">Total</span>
                    <span className="text-base font-semibold tabular-nums">{computedTotal.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              <hr className="border-border" />

              {/* Disability */}
              <div className="space-y-2">
                <Label>Disability in household</Label>
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

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex gap-2 pt-2">
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving…" : "Create membership"}
                </Button>
                <Link href="/members">
                  <Button type="button" variant="outline">Cancel</Button>
                </Link>
              </div>

            </CardContent>
          </Card>
        </form>
      </main>

      {/* Add person dialog */}
      <Dialog open={!!addPersonOpen} onOpenChange={(open) => !open && setAddPersonOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {addPersonOpen === "hod" && "Add head of household"}
              {addPersonOpen === "spouse" && "Add spouse"}
              {addPersonOpen === "dependent" && "Add dependent"}
            </DialogTitle>
          </DialogHeader>
          <PersonForm
            onSubmit={handleCreatePerson}
            onCancel={() => setAddPersonOpen(null)}
            submitLabel="Add person"
          />
        </DialogContent>
      </Dialog>

      {/* Edit person dialog */}
      <Dialog open={!!editPerson} onOpenChange={(open) => !open && setEditPerson(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit person</DialogTitle>
          </DialogHeader>
          {editPerson?.initial && (
            <PersonForm
              initial={editPerson.initial}
              onSubmit={handleEditPerson}
              onCancel={() => setEditPerson(null)}
              submitLabel="Save changes"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* No org modal */}
      <Dialog open={!isSuperUser && !orgId} onOpenChange={() => router.push("/")}>
        <DialogContent className="border-2 border-destructive">
          <DialogHeader>
            <DialogTitle>Organization Required</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mt-1">
            You must be assigned to an organization to create memberships.
          </p>
          <div className="flex justify-end mt-4">
            <Button variant="outline" onClick={() => router.push("/")}>
              Back
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
