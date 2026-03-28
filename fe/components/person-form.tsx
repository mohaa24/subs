"use client";

import { useState, useEffect } from "react";
import { type Zone } from "@/lib/api";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PhoneInput } from "react-international-phone";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  RESIDENT_TYPES,
  LIVING_STATUSES,
  OCCUPATIONS,
  TITLES,
  GENDER_OPTIONS,
  IDENTITY_TYPES,
  BLOOD_GROUPS,
  HIGHEST_QUALIFICATION_TYPES,
  WORK_LOCATIONS,
  PERMANENT_DISABILITY_OPTIONS,
} from "@/lib/constants";

// Input sanitizers - only allow valid characters
const onlyNIC = (v: string) => v.replace(/[^\dVAva]/g, "").toUpperCase();
const onlyAlphanumeric = (v: string) => v.replace(/[^\w\s\-]/g, "");
const onlyLettersAndSpaces = (v: string) => v.replace(/[^\w\s.'\-]/g, "").replace(/\s{2,}/g, " ");
const intlPhoneRegex = /^\+[1-9]\d{7,14}$/;

function normalizeToInternationalPhone(raw: string): string {
  const compact = raw.trim().replace(/[\s\-]/g, "");
  if (!compact) return "";
  if (intlPhoneRegex.test(compact)) return compact;
  if (/^0\d{9}$/.test(compact)) return `+94${compact.slice(1)}`; // Sri Lanka local mobile format
  if (/^94\d{9}$/.test(compact)) return `+${compact}`;
  if (/^[1-9]\d{7,14}$/.test(compact)) return `+${compact}`;
  return "";
}

const MARITAL_OPTIONS = [
  { value: "single", label: "Single" },
  { value: "married", label: "Married" },
  { value: "widower", label: "Widower" },
  { value: "widow", label: "Widow" },
];

export interface PersonFormData {
  title: string;
  nameWithInitials: string;
  fullName: string;
  preferredName: string;
  residentType: string;
  gender: string;
  identityType: string;
  nicNumber: string;
  idNumber: string;
  dateOfBirth: string;
  bloodGroup: string;
  maritalStatus: string;
  address: string;
  areaCode: string;
  mobileNumber: string;
  whatsAppNumber: string;
  email: string;
  occupation: string;
  placeOfWork: string;
  highestQualificationType: string;
  highestQualificationTitle: string;
  permanentDisability: string;
  livingStatus: string;
  isMadarasaStudent: boolean;
}

const defaultPerson: PersonFormData = {
  title: "",
  nameWithInitials: "",
  fullName: "",
  preferredName: "",
  residentType: "",
  gender: "",
  identityType: "",
  nicNumber: "",
  idNumber: "",
  dateOfBirth: "",
  bloodGroup: "",
  maritalStatus: "",
  address: "",
  areaCode: "",
  mobileNumber: "",
  whatsAppNumber: "",
  email: "",
  occupation: "",
  placeOfWork: "",
  highestQualificationType: "",
  highestQualificationTitle: "",
  permanentDisability: "",
  livingStatus: "Active",
  isMadarasaStudent: false,
};

const REQUIRED_FIELDS: (keyof PersonFormData)[] = [
  "title",
  "nameWithInitials",
  "fullName",
  "gender",
  "dateOfBirth",
  "maritalStatus",
  "residentType",
  "address",
];

function Section({
  title,
  children,
  variant = "default",
}: {
  title: string;
  children: React.ReactNode;
  variant?: "default" | "alt";
}) {
  return (
    <div
      className={`rounded-lg px-4 py-4 sm:px-5 sm:py-5 ${
        variant === "alt" ? "bg-muted/50" : "bg-muted/25"
      }`}
    >
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
        {title}
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>
    </div>
  );
}

export function PersonForm({
  initial,
  zones = [],
  onSubmit,
  onCancel,
  submitLabel = "Save",
  disabled = false,
}: {
  initial?: Partial<PersonFormData>;
  zones?: Zone[];
  onSubmit: (data: PersonFormData) => void;
  onCancel?: () => void;
  submitLabel?: string;
  disabled?: boolean;
}) {
  const [form, setForm] = useState<PersonFormData>(() => {
    const merged = { ...defaultPerson, ...initial };
    return {
      ...merged,
      mobileNumber: normalizeToInternationalPhone(merged.mobileNumber),
      whatsAppNumber: normalizeToInternationalPhone(merged.whatsAppNumber),
    };
  });
  const [validationError, setValidationError] = useState<string | null>(null);

  const getAgeFromDob = (dob: string) => {
    if (!dob) return null;
    const birth = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
  };
  const age = getAgeFromDob(form.dateOfBirth);
  const isUnder16 = age !== null && age < 16;

  useEffect(() => {
    if (age !== null && age < 16) {
      setForm((f) => ({
        ...f,
        identityType: "",
        nicNumber: "",
        idNumber: "",
        occupation: "",
        placeOfWork: "",
      }));
    }
  }, [form.dateOfBirth]);

  useEffect(() => {
    const merged = { ...defaultPerson, ...initial };
    setForm({
      ...merged,
      mobileNumber: normalizeToInternationalPhone(merged.mobileNumber),
      whatsAppNumber: normalizeToInternationalPhone(merged.whatsAppNumber),
    });
  }, [initial]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError(null);
    const missing = REQUIRED_FIELDS.filter((f) => !form[f]?.toString().trim());
    if (missing.length > 0) {
      const labels: Record<string, string> = {
        title: "Title",
        nameWithInitials: "Name with Initials",
        fullName: "Full Name",
        gender: "Gender",
        dateOfBirth: "Date of Birth",
        maritalStatus: "Marital Status",
        residentType: "Resident Type",
        address: "Main Address",
      };
      setValidationError(`Required: ${missing.map((f) => labels[f] ?? f).join(", ")}`);
      return;
    }
    // Format validations for optional fields when provided
    if (form.mobileNumber.trim() && !intlPhoneRegex.test(form.mobileNumber.trim())) {
      setValidationError("Mobile number must be in international format (e.g. +94771234567)");
      return;
    }
    if (form.whatsAppNumber.trim() && !intlPhoneRegex.test(form.whatsAppNumber.trim())) {
      setValidationError("WhatsApp number must be in international format (e.g. +94771234567)");
      return;
    }
    if (form.dateOfBirth && new Date(form.dateOfBirth) > new Date()) {
      setValidationError("Date of Birth cannot be in the future");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (form.email.trim() && !emailRegex.test(form.email.trim())) {
      setValidationError("Please enter a valid email address");
      return;
    }
    onSubmit({
      ...form,
      mobileNumber: form.mobileNumber.trim(),
      whatsAppNumber: form.whatsAppNumber.trim(),
    });
  }

  const isNIC = form.identityType === "NIC";
  const zoneOptions = zones.filter((zone) => zone.isActive || String(zone.code) === form.areaCode);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {validationError && (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
          {validationError}
        </p>
      )}

      <Section title="Personal Information" variant="default">
        <div className="space-y-2">
          <Label>Title <span className="text-destructive">*</span></Label>
          <Select
            value={form.title || undefined}
            onValueChange={(v) => setForm((f) => ({ ...f, title: v }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {TITLES.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Name with Initials <span className="text-destructive">*</span></Label>
          <Input
            value={form.nameWithInitials}
            onChange={(e) =>
              setForm((f) => ({ ...f, nameWithInitials: onlyLettersAndSpaces(e.target.value) }))
            }
            required
            placeholder="e.g. M.A. Rahman"
          />
        </div>
        <div className="space-y-2">
          <Label>Full Name <span className="text-destructive">*</span></Label>
          <Input
            value={form.fullName}
            onChange={(e) =>
              setForm((f) => ({ ...f, fullName: onlyLettersAndSpaces(e.target.value) }))
            }
            required
            placeholder="e.g. Mohamed Abdul Rahman"
          />
        </div>
        <div className="space-y-2">
          <Label>Preferred Name</Label>
          <Input
            value={form.preferredName}
            onChange={(e) =>
              setForm((f) => ({ ...f, preferredName: onlyLettersAndSpaces(e.target.value) }))
            }
            placeholder="e.g. Rahman"
          />
        </div>
        <div className="space-y-2">
          <Label>Gender <span className="text-destructive">*</span></Label>
          <Select
            value={form.gender || undefined}
            onValueChange={(v) => setForm((f) => ({ ...f, gender: v }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {GENDER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Date of Birth <span className="text-destructive">*</span></Label>
          <Input
            type="date"
            value={form.dateOfBirth}
            onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))}
            max={today}
          />
        </div>
        <div className="space-y-2">
          <Label>Marital Status <span className="text-destructive">*</span></Label>
          <Select
            value={form.maritalStatus || undefined}
            onValueChange={(v) => setForm((f) => ({ ...f, maritalStatus: v }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {MARITAL_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Blood Group</Label>
          <Select
            value={form.bloodGroup || "not_set"}
            onValueChange={(v) =>
              setForm((f) => ({ ...f, bloodGroup: v === "not_set" ? "" : v }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="not_set">Not Set</SelectItem>
              {BLOOD_GROUPS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Section>

      <Section title="Residency & Address" variant="alt">
        <div className="space-y-2 md:col-span-2">
          <Label>Resident Type <span className="text-destructive">*</span></Label>
          <Select
            value={form.residentType || undefined}
            onValueChange={(v) => setForm((f) => ({ ...f, residentType: v }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {RESIDENT_TYPES.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label>Main Address <span className="text-destructive">*</span></Label>
          <Input
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            required
            placeholder="Street, city, postal code"
          />
        </div>
        <div className="space-y-2">
          <Label>Zone</Label>
          <Select
            value={form.areaCode || "unset"}
            onValueChange={(v) => setForm((f) => ({ ...f, areaCode: v === "unset" ? "" : v }))}
          >
            <SelectTrigger disabled={disabled}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unset">Not Set</SelectItem>
              {zoneOptions.map((zone) => (
                <SelectItem key={zone.id} value={String(zone.code)}>
                  {zone.code} - {zone.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Section>

      <Section title="Identity" variant="default">
        <div className="space-y-2">
          <Label>ID Type {isUnder16 && <span className="text-muted-foreground text-xs">(under 16)</span>}</Label>
          <Select
            value={form.identityType || undefined}
            onValueChange={(v) => setForm((f) => ({ ...f, identityType: v }))}
          >
            <SelectTrigger disabled={isUnder16} className={isUnder16 ? "opacity-60" : ""}>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {IDENTITY_TYPES.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isNIC ? (
          <div className="space-y-2">
            <Label>NIC Number</Label>
            <Input
              value={form.nicNumber}
              onChange={(e) =>
                setForm((f) => ({ ...f, nicNumber: onlyNIC(e.target.value) }))
              }
              inputMode="numeric"
              placeholder="e.g. 199012345678 or 123456789V"
              disabled={isUnder16}
              className={isUnder16 ? "opacity-60" : ""}
            />
          </div>
        ) : form.identityType ? (
          <div className="space-y-2">
            <Label>ID Number</Label>
            <Input
              value={form.idNumber}
              onChange={(e) =>
                setForm((f) => ({ ...f, idNumber: onlyAlphanumeric(e.target.value) }))
              }
              placeholder="Passport or license number"
              disabled={isUnder16}
              className={isUnder16 ? "opacity-60" : ""}
            />
          </div>
        ) : null}
      </Section>

      <Section title="Contact" variant="alt">
        <div className="space-y-2">
          <Label>Mobile Number</Label>
          <div className="phone-field">
            <PhoneInput
              defaultCountry="lk"
              disableDialCodePrefill
              value={form.mobileNumber}
              onChange={(phone) =>
                setForm((f) => ({ ...f, mobileNumber: phone }))
              }
              inputProps={{ id: "mobileNumber", name: "mobileNumber" }}
              placeholder="e.g. +94 77 123 4567"
              disabled={disabled}
            />
          </div>
         
        </div>
        <div className="space-y-2">
          <Label>WhatsApp Number</Label>
          <div className="phone-field">
            <PhoneInput
              defaultCountry="lk"
              disableDialCodePrefill
              value={form.whatsAppNumber}
              onChange={(phone) =>
                setForm((f) => ({ ...f, whatsAppNumber: phone }))
              }
              inputProps={{ id: "whatsAppNumber", name: "whatsAppNumber" }}
              placeholder="e.g. +94 77 123 4567"
              disabled={disabled}
            />
          </div>
          
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label>Email</Label>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="e.g. name@example.com"
          />
        </div>
      </Section>

      <Section title="Employment Details" variant="default">
        <div className="space-y-2">
          <Label>Occupation {isUnder16 && <span className="text-muted-foreground text-xs">(under 16)</span>}</Label>
          <Select
            value={form.occupation || undefined}
            onValueChange={(v) => setForm((f) => ({ ...f, occupation: v }))}
          >
            <SelectTrigger disabled={isUnder16} className={isUnder16 ? "opacity-60" : ""}>
              <SelectValue placeholder="Select Occupation" />
            </SelectTrigger>
            <SelectContent>
              {OCCUPATIONS.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Work Location {isUnder16 && <span className="text-muted-foreground text-xs">(under 16)</span>}</Label>
          <Select
            value={form.placeOfWork || undefined}
            onValueChange={(v) => setForm((f) => ({ ...f, placeOfWork: v }))}
          >
            <SelectTrigger disabled={isUnder16} className={isUnder16 ? "opacity-60" : ""}>
              <SelectValue placeholder="Select Location" />
            </SelectTrigger>
            <SelectContent>
              {WORK_LOCATIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Section>

      <Section title="Education Details" variant="alt">
        <div className="space-y-2">
          <Label>Highest Qualification Type</Label>
          <Select
            value={form.highestQualificationType || undefined}
            onValueChange={(v) => setForm((f) => ({ ...f, highestQualificationType: v }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {HIGHEST_QUALIFICATION_TYPES.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Highest Qualification Title</Label>
          <Input
            value={form.highestQualificationTitle}
            onChange={(e) =>
              setForm((f) => ({ ...f, highestQualificationTitle: e.target.value }))
            }
            placeholder="e.g. BSc in Computer Science"
          />
        </div>
        <div className="flex items-center space-x-2 md:col-span-2">
          <Checkbox
            id="madarasa"
            checked={form.isMadarasaStudent}
            onCheckedChange={(c) => setForm((f) => ({ ...f, isMadarasaStudent: !!c }))}
          />
          <Label htmlFor="madarasa">Local Madrasa Student</Label>
        </div>
      </Section>

      <Section title="Other Details" variant="default">
        <div className="space-y-2">
          <Label>Living Status</Label>
          <Select
            value={form.livingStatus || "Active"}
            onValueChange={(v) => setForm((f) => ({ ...f, livingStatus: v }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {LIVING_STATUSES.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Permanent Disability</Label>
          <Select
            value={form.permanentDisability || undefined}
            onValueChange={(v) => setForm((f) => ({ ...f, permanentDisability: v }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {PERMANENT_DISABILITY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Section>

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={disabled}>{submitLabel}</Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
