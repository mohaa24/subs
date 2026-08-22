"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type FormFieldConfig } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export type FormType = "Person" | "Membership";
export type FieldVisibility = "Required" | "Optional" | "Hidden";
export type FieldVisibilityMap = Record<string, FieldVisibility>;

export const PERSON_DEFAULT_VISIBILITY: FieldVisibilityMap = {
  title: "Required",
  nameWithInitials: "Required",
  fullName: "Required",
  gender: "Required",
  dateOfBirth: "Required",
  maritalStatus: "Required",
  residentType: "Required",
  address: "Required",
};

export const MEMBERSHIP_DEFAULT_VISIBILITY: FieldVisibilityMap = {
  membershipType: "Required",
  membershipStatus: "Required",
  areaCode: "Required",
  paymentPeriod: "Required",
  membershipFee: "Required",
  totalContribution: "Required",
};

export function configuredVisibility(
  map: FieldVisibilityMap,
  formType: FormType,
  fieldName: string,
) {
  const defaults = formType === "Person" ? PERSON_DEFAULT_VISIBILITY : MEMBERSHIP_DEFAULT_VISIBILITY;
  return map[fieldName] ?? defaults[fieldName] ?? "Optional";
}

export function useFormVisibility(formType: FormType, organizationId?: string | null) {
  const { user } = useAuth();
  const [map, setMap] = useState<FieldVisibilityMap>({});

  useEffect(() => {
    if (!user || (user.role === "super_user" && !organizationId)) {
      setMap({});
      return;
    }
    const params: Record<string, string> = { formType };
    if (user.role === "super_user" && organizationId) params.organizationId = organizationId;
    api<FormFieldConfig[]>("/form-config", { params })
      .then((rows) => setMap(Object.fromEntries(rows.map((row) => [row.fieldName, row.visibility]))))
      .catch(() => setMap({}));
  }, [formType, organizationId, user]);

  return useMemo(() => ({
    visibility: (fieldName: string) => configuredVisibility(map, formType, fieldName),
    visible: (fieldName: string) => configuredVisibility(map, formType, fieldName) !== "Hidden",
    required: (fieldName: string) => configuredVisibility(map, formType, fieldName) === "Required",
    map,
  }), [formType, map]);
}
