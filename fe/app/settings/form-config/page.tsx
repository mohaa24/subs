"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type FormFieldConfig } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Header } from "@/components/header";
import { AbstractBg } from "@/components/abstract-bg";
import { Breadcrumb } from "@/components/breadcrumb";
import { Settings, Save } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { dashboardFlowHref } from "@/lib/dashboard-flows";

const PERSON_FIELDS = [
  "title", "nameWithInitials", "fullName", "preferredName", "residentType", "gender",
  "identityType", "nicNumber", "idNumber", "dateOfBirth", "bloodGroup", "maritalStatus",
  "address", "areaCode", "mobileNumber", "whatsAppNumber", "email", "occupation", "placeOfWork",
  "highestQualificationType", "highestQualificationTitle", "permanentDisability",
  "schoolName", "livingStatus", "isMadarasaStudent",
];

const MEMBERSHIP_FIELDS = [
  "membershipType", "membershipStatus", "isZakathEligible", "areaCode", "land",
  "houseOwnership", "commercialProperties", "toiletFacility", "vehicleOwnership",
  "waterAccessibility", "electricity", "paymentPeriod", "membershipFee",
  "additionalVoluntaryContributions", "membershipFeeDiscount", "totalContribution", "disability",
];

type FormType = "Person" | "Membership";
type Visibility = "Required" | "Optional" | "Hidden";

function buildFieldMap(configs: FormFieldConfig[]): Record<string, Visibility> {
  const map: Record<string, Visibility> = {};
  for (const c of configs) {
    map[c.fieldName] = c.visibility;
  }
  return map;
}

function formatFieldName(name: string): string {
  return name
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

export default function FormConfigPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [personConfigs, setPersonConfigs] = useState<FormFieldConfig[]>([]);
  const [membershipConfigs, setMembershipConfigs] = useState<FormFieldConfig[]>([]);
  const [personFields, setPersonFields] = useState<Record<string, Visibility>>({});
  const [membershipFields, setMembershipFields] = useState<Record<string, Visibility>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<FormType | null>(null);
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");

  const isSuper = user?.role === "super_user";

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user) return;
    if (isSuper) {
      api<{ id: string; name: string }[]>("/organizations")
        .then((list) => {
          setOrgs(list);
          if (list.length > 0) setSelectedOrgId((prev) => prev || list[0].id);
          else setLoading(false);
        })
        .catch(() => { setOrgs([]); setLoading(false); });
      return;
    }
    const load = async () => {
      try {
        const [personRes, memberRes] = await Promise.all([
          api<FormFieldConfig[]>("/form-config", { params: { formType: "Person" } }),
          api<FormFieldConfig[]>("/form-config", { params: { formType: "Membership" } }),
        ]);
        setPersonConfigs(Array.isArray(personRes) ? personRes : []);
        setMembershipConfigs(Array.isArray(memberRes) ? memberRes : []);
        setPersonFields(buildFieldMap(Array.isArray(personRes) ? personRes : []));
        setMembershipFields(buildFieldMap(Array.isArray(memberRes) ? memberRes : []));
      } catch {
        setPersonFields({});
        setMembershipFields({});
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user, isSuper]);

  useEffect(() => {
    if (!isSuper || !selectedOrgId) return;
    setLoading(true);
    Promise.all([
      api<FormFieldConfig[]>("/form-config", { params: { formType: "Person", organizationId: selectedOrgId } }),
      api<FormFieldConfig[]>("/form-config", { params: { formType: "Membership", organizationId: selectedOrgId } }),
    ])
      .then(([personRes, memberRes]) => {
        setPersonConfigs(Array.isArray(personRes) ? personRes : []);
        setMembershipConfigs(Array.isArray(memberRes) ? memberRes : []);
        setPersonFields(buildFieldMap(Array.isArray(personRes) ? personRes : []));
        setMembershipFields(buildFieldMap(Array.isArray(memberRes) ? memberRes : []));
      })
      .catch(() => {
        setPersonFields({});
        setMembershipFields({});
      })
      .finally(() => setLoading(false));
  }, [selectedOrgId, isSuper]);

  async function handleSave(formType: FormType) {
    const fields = formType === "Person" ? PERSON_FIELDS : MEMBERSHIP_FIELDS;
    const fieldMap = formType === "Person" ? personFields : membershipFields;
    setSaving(formType);
    try {
      const body: { formType: FormType; fields: { fieldName: string; visibility: Visibility; displayOrder: number }[]; organizationId?: string } = {
        formType,
        fields: fields.map((f, i) => ({
          fieldName: f,
          visibility: fieldMap[f] ?? "Optional",
          displayOrder: i,
        })),
      };
      if (isSuper && selectedOrgId) body.organizationId = selectedOrgId;
      await api("/form-config", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      const updated = await api<FormFieldConfig[]>("/form-config", { params: { formType, ...(isSuper && selectedOrgId ? { organizationId: selectedOrgId } : {}) } });
      if (formType === "Person") {
        setPersonConfigs(Array.isArray(updated) ? updated : []);
        setPersonFields(buildFieldMap(Array.isArray(updated) ? updated : []));
      } else {
        setMembershipConfigs(Array.isArray(updated) ? updated : []);
        setMembershipFields(buildFieldMap(Array.isArray(updated) ? updated : []));
      }
    } finally {
      setSaving(null);
    }
  }

  if (authLoading || !user) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (user.role !== "admin" && user.role !== "super_user") {
    router.replace("/");
    return null;
  }

  return (
    <div className="min-h-screen bg-background relative">
      <AbstractBg />
      <Header />
      <main className="relative p-6 max-w-4xl mx-auto">
        <Breadcrumb items={[{ label: "Dashboard", href: dashboardFlowHref("admin") }, { label: "Settings" }, { label: "Form Configuration" }]} />
        <div className="flex items-center gap-2 mb-5">
          <Settings className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold text-foreground">Form Configuration</h1>
        </div>
        {isSuper && orgs.length > 0 && (
          <div className="mb-4 flex items-center gap-2">
            <label className="text-sm font-medium text-foreground">Organization:</label>
            <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
              <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                {orgs.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {!isSuper && user?.role === "admin" && (
          <p className="text-sm text-muted-foreground mb-4">
            Configuring forms for your organization
          </p>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Field visibility</CardTitle>
            <p className="text-sm text-muted-foreground">Configure which fields are required, optional, or hidden in each form.</p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <Tabs defaultValue="person">
                <TabsList>
                  <TabsTrigger value="person">Person Form</TabsTrigger>
                  <TabsTrigger value="membership">Membership Form</TabsTrigger>
                </TabsList>
                <TabsContent value="person" className="mt-4">
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="py-2 pr-4 font-medium">Field</th>
                          <th className="py-2 font-medium">Visibility</th>
                        </tr>
                      </thead>
                      <tbody>
                        {PERSON_FIELDS.map((f) => (
                          <tr key={f} className="border-b">
                            <td className="py-2 pr-4">{formatFieldName(f)}</td>
                            <td className="py-2">
                              <Select
                                value={personFields[f] ?? "Optional"}
                                onValueChange={(v: Visibility) =>
                                  setPersonFields((prev) => ({ ...prev, [f]: v }))
                                }
                              >
                                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Required">Required</SelectItem>
                                  <SelectItem value="Optional">Optional</SelectItem>
                                  <SelectItem value="Hidden">Hidden</SelectItem>
                                </SelectContent>
                              </Select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Button
                    className="mt-4 gap-2"
                    onClick={() => handleSave("Person")}
                    disabled={saving === "Person"}
                  >
                    <Save className="h-4 w-4" />
                    {saving === "Person" ? "Saving…" : "Save Person Form"}
                  </Button>
                </TabsContent>
                <TabsContent value="membership" className="mt-4">
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="py-2 pr-4 font-medium">Field</th>
                          <th className="py-2 font-medium">Visibility</th>
                        </tr>
                      </thead>
                      <tbody>
                        {MEMBERSHIP_FIELDS.map((f) => (
                          <tr key={f} className="border-b">
                            <td className="py-2 pr-4">{formatFieldName(f)}</td>
                            <td className="py-2">
                              <Select
                                value={membershipFields[f] ?? "Optional"}
                                onValueChange={(v: Visibility) =>
                                  setMembershipFields((prev) => ({ ...prev, [f]: v }))
                                }
                              >
                                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Required">Required</SelectItem>
                                  <SelectItem value="Optional">Optional</SelectItem>
                                  <SelectItem value="Hidden">Hidden</SelectItem>
                                </SelectContent>
                              </Select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Button
                    className="mt-4 gap-2"
                    onClick={() => handleSave("Membership")}
                    disabled={saving === "Membership"}
                  >
                    <Save className="h-4 w-4" />
                    {saving === "Membership" ? "Saving…" : "Save Membership Form"}
                  </Button>
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
