const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

export async function api<T>(
  path: string,
  options: RequestInit & { params?: Record<string, string> } = {}
): Promise<T> {
  const { params, ...init } = options;
  const url = new URL(path, API_URL);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const token = getToken();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  if (token) (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url.toString(), { ...init, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error || res.statusText);
  }
  return res.json();
}

export type UserRole = "super_user" | "admin" | "user";

export interface User {
  id: string;
  email: string;
  role: UserRole;
  organizationId: string | null;
  organization?: { id: string; name: string; slug: string } | null;
}

export interface Person {
  id: string;
  organizationId: string;
  nameWithInitials: string;
  fullName: string;
  gender?: string | null;
  nicNumber?: string | null;
  dateOfBirth?: string | null;
  age?: number | null;
  maritalStatus?: "single" | "married" | "widower" | "widow" | null;
  address?: string | null;
  mobileNumber?: string | null;
  whatsAppNumber?: string | null;
  email?: string | null;
  occupation?: string | null;
  placeOfWork?: string | null;
  educationalQualification?: string | null;
  isMadarasaStudent: boolean;
}

export interface Membership {
  id: string;
  membershipNo: string;
  organizationId: string;
  dateOfRegistration: string;
  membershipType: string;
  membershipStatus: string;
  hodPersonId: string;
  spousePersonId?: string | null;
  hod?: Person & { id: string; nameWithInitials: string; fullName: string; nicNumber?: string | null };
  spouse?: (Person & { id: string; nameWithInitials: string; fullName: string }) | null;
  dependents?: Array<{ person: Person & { id: string; nameWithInitials: string; fullName: string } }>;
  land: boolean;
  houseOwnership: boolean;
  commercialProperties: boolean;
  toiletFacility: boolean;
  vehicleOwnership: boolean;
  waterAccessibility: boolean;
  electricity: boolean;
  paymentPeriod: "Monthly" | "Quarterly" | "Annually";
  membershipFee: number;
  additionalVoluntaryContributions: number;
  membershipFeeDiscount: number;
  totalContribution: number;
  disability: boolean;
  createdByUserId?: string | null;
  createdBy?: { id: string; email: string } | null;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
}

export type DueStatus = "pending" | "partial" | "paid" | "overdue";

export interface PaymentDue {
  id: string;
  membershipId: string;
  organizationId: string;
  dueDate: string;
  period: string;
  amountDue: number;
  amountPaid: number;
  status: DueStatus;
  createdAt: string;
  membership?: {
    membershipNo: string;
    hod?: { fullName: string; nameWithInitials: string };
  };
}

export interface Payment {
  id: string;
  paymentDueId: string;
  membershipId: string;
  organizationId: string;
  amount: number;
  paymentDate: string;
  collectedByUserId: string;
  note?: string | null;
  createdAt: string;
  paymentDue?: { period: string; amountDue: number };
  collectedBy?: { id: string; email: string };
}

export interface DashboardStats {
  totalMembers: number;
  children: number;
  teenagers: number;
  totalDueThisMonth: number;
  collectedThisMonth: number;
  period: string;
}

export interface MembershipBalance {
  membershipId: string;
  membershipNo: string;
  totalDue: number;
  totalPaid: number;
  outstanding: number;
  overdueCount: number;
  dues: PaymentDue[];
}
