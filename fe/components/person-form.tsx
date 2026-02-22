"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

const MARITAL_OPTIONS = [
  { value: "single", label: "Single" },
  { value: "married", label: "Married" },
  { value: "widower", label: "Widower" },
  { value: "widow", label: "Widow" },
];

export interface PersonFormData {
  nameWithInitials: string;
  fullName: string;
  gender: string;
  nicNumber: string;
  dateOfBirth: string;
  age: string;
  maritalStatus: string;
  address: string;
  mobileNumber: string;
  whatsAppNumber: string;
  email: string;
  occupation: string;
  placeOfWork: string;
  educationalQualification: string;
  isMadarasaStudent: boolean;
}

const defaultPerson: PersonFormData = {
  nameWithInitials: "",
  fullName: "",
  gender: "",
  nicNumber: "",
  dateOfBirth: "",
  age: "",
  maritalStatus: "",
  address: "",
  mobileNumber: "",
  whatsAppNumber: "",
  email: "",
  occupation: "",
  placeOfWork: "",
  educationalQualification: "",
  isMadarasaStudent: false,
};

export function PersonForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel = "Save",
}: {
  initial?: Partial<PersonFormData>;
  onSubmit: (data: PersonFormData) => void;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const [form, setForm] = useState<PersonFormData>({ ...defaultPerson, ...initial });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(form);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Name with initials</Label>
          <Input
            value={form.nameWithInitials}
            onChange={(e) => setForm((f) => ({ ...f, nameWithInitials: e.target.value }))}
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Full name</Label>
          <Input
            value={form.fullName}
            onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Gender</Label>
          <Input
            value={form.gender}
            onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label>NIC number</Label>
          <Input
            value={form.nicNumber}
            onChange={(e) => setForm((f) => ({ ...f, nicNumber: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label>Date of birth</Label>
          <Input
            type="date"
            value={form.dateOfBirth}
            onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label>Age</Label>
          <Input
            type="number"
            min={0}
            value={form.age}
            onChange={(e) => setForm((f) => ({ ...f, age: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label>Marital status</Label>
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
        <div className="space-y-2 md:col-span-2">
          <Label>Address</Label>
          <Input
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label>Mobile number</Label>
          <Input
            value={form.mobileNumber}
            onChange={(e) => setForm((f) => ({ ...f, mobileNumber: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label>WhatsApp number</Label>
          <Input
            value={form.whatsAppNumber}
            onChange={(e) => setForm((f) => ({ ...f, whatsAppNumber: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label>Email</Label>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label>Occupation</Label>
          <Input
            value={form.occupation}
            onChange={(e) => setForm((f) => ({ ...f, occupation: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label>Place of work</Label>
          <Input
            value={form.placeOfWork}
            onChange={(e) => setForm((f) => ({ ...f, placeOfWork: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label>Educational qualification</Label>
          <Input
            value={form.educationalQualification}
            onChange={(e) => setForm((f) => ({ ...f, educationalQualification: e.target.value }))}
          />
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox
            id="madarasa"
            checked={form.isMadarasaStudent}
            onCheckedChange={(c) => setForm((f) => ({ ...f, isMadarasaStudent: !!c }))}
          />
          <Label htmlFor="madarasa">Madarasa student</Label>
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit">{submitLabel}</Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
