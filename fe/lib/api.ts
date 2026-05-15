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
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }
  return res.json();
}

export type UserRole = "super_user" | "admin" | "user";

export interface User {
  id: string;
  email: string;
  role: UserRole;
  locale?: string;
  phoneNumber?: string | null;
  organizationId: string | null;
  permissions?: string[];
  organization?: {
    id: string;
    name: string;
    slug: string;
    defaultMembershipFee?: number;
    isActive?: boolean;
  } | null;
}

export type ActivityFeedEntryType =
  | "remark"
  | "document_generated"
  | "image_added"
  | "system_event";

export type ActivityFeedActorType = "user" | "system";
export type MembershipStatus = "Active" | "Inactive";

export interface ActivityFeedItem {
  id: string;
  organizationId: string;
  personId?: string | null;
  membershipId?: string | null;
  entryType: ActivityFeedEntryType;
  actorType: ActivityFeedActorType;
  body?: string | null;
  metadata?: Record<string, unknown> | null;
  createdByUserId?: string | null;
  createdAt: string;
  createdBy?: { id: string; email: string } | null;
}

export type ResidentType =
  | "ResidentSinceBirth"
  | "ResidentByMarriage"
  | "BusinessResidency"
  | "EmploymentResidency"
  | "EducationalResidency"
  | "FamilyMemberOfResident"
  | "NonResidentPerson";

export type LivingStatus = "Active" | "Deceased" | "PermanentlyRelocated";

export type RelationToHOH =
  | "Husband"
  | "Wife"
  | "Son"
  | "Daughter"
  | "AdoptedSon"
  | "AdoptedDaughter"
  | "Father"
  | "Mother"
  | "StepFather"
  | "StepMother"
  | "Brother"
  | "Sister"
  | "Grandfather"
  | "Grandmother"
  | "Grandson"
  | "Granddaughter"
  | "SonInLaw"
  | "DaughterInLaw"
  | "Uncle"
  | "Aunt"
  | "Nephew"
  | "Niece"
  | "Cousin"
  | "FatherInLaw"
  | "MotherInLaw"
  | "spouse"
  | "child"
  | "other";

export type DependentGroup = "children" | "other";

export interface Person {
  id: string;
  organizationId: string;
  membershipId?: string | null;
  title?: "Mr" | "Master" | "Miss" | "Mrs" | "Ms" | "Dr" | null;
  nameWithInitials: string;
  fullName: string;
  preferredName?: string | null;
  residentType?: ResidentType | null;
  gender?: string | null;
  identityType?: "NIC" | "Passport" | "DrivingLicense" | null;
  nicNumber?: string | null;
  idNumber?: string | null;
  dateOfBirth?: string | null;
  bloodGroup?: "A_pos" | "A_neg" | "B_pos" | "B_neg" | "AB_pos" | "AB_neg" | "O_pos" | "O_neg" | null;
  maritalStatus?: "single" | "married" | "widower" | "widow" | null;
  address?: string | null;
  areaCode?: number | null;
  mobileNumber?: string | null;
  whatsAppNumber?: string | null;
  email?: string | null;
  occupation?: string | null;
  placeOfWork?: string | null;
  highestQualificationType?: string | null;
  highestQualificationTitle?: string | null;
  permanentDisability?: string | null;
  relationToHOH?: RelationToHOH | null;
  livingStatus?: LivingStatus | null;
  isMadarasaStudent: boolean;
  isArchived?: boolean;
}

export interface Membership {
  id: string;
  membershipNo: string;
  organizationId: string;
  organization?: { id: string; name: string; slug: string; address?: string | null } | null;
  dateOfRegistration: string;
  membershipType: string;
  membershipStatus: MembershipStatus;
  hodPersonId: string;
  spousePersonId?: string | null;
  isZakathEligible?: boolean | null;
  areaCode?: number | null;
  hod?: Person & { id: string; nameWithInitials: string; fullName: string; nicNumber?: string | null };
  spouse?: (Person & { id: string; nameWithInitials: string; fullName: string }) | null;
  dependents?: Array<{
    group?: DependentGroup;
    person: Person & { id: string; nameWithInitials: string; fullName: string; relationToHOH?: RelationToHOH | null };
  }>;
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
  isArchived?: boolean;
  createdByUserId?: string | null;
  createdBy?: { id: string; email: string } | null;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  defaultMembershipFee?: number;
  isActive?: boolean;
  logoUrl?: string | null;
  contactPersonName?: string | null;
  contactPersonPhone?: string | null;
  whatsAppSenderNumber?: string | null;
  address?: string | null;
  joinDate?: string | null;
  proRataMonthly?: boolean;
  proRataQuarterly?: boolean;
  proRataYearly?: boolean;
  lateFeePercentage?: number;
  adminsCount?: number;
  usersCount?: number;
  personsCount?: number;
  membershipsCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export type DueStatus = "pending" | "partial" | "paid" | "overdue";

export interface DueType {
  id: string;
  organizationId: string;
  name: string;
  systemKey?: string | null;
  autoAllocate: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentDue {
  id: string;
  membershipId: string;
  organizationId: string;
  dueTypeId?: string;
  dueDate: string;
  period: string;
  isManual?: boolean;
  reason?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  amountDue: number;
  amountPaid: number;
  status: DueStatus;
  createdAt: string;
  dueType?: Pick<DueType, "id" | "name" | "autoAllocate" | "isActive" | "systemKey">;
  membership?: {
    membershipNo: string;
    areaCode?: number | null;
    hod?: { fullName: string; nameWithInitials: string };
  };
}

export type PaymentKind = "due" | "credit";

export interface Payment {
  id: string;
  paymentDueId: string | null;
  membershipId: string;
  organizationId: string;
  receiptNumber?: string | null;
  paymentKind: PaymentKind;
  paymentMethod?: "cash" | "bank_transfer" | "card" | "other" | null;
  amount: number;
  paymentDate: string;
  collectedByUserId: string;
  note?: string | null;
  createdAt: string;
  paymentDue?: { id?: string; period: string; amountDue: number } | null;
  collectedBy?: { id: string; email: string };
  membership?: {
    id?: string;
    membershipNo: string;
    areaCode?: number | null;
    hod?: { fullName: string; nameWithInitials: string };
  };
}

export interface PaymentReceipt {
  paymentKind: PaymentKind;
  paymentId: string;
  receiptNumber: string;
  paymentDate: string;
  note?: string | null;
  period: string;
  membershipId: string;
  membershipNo: string;
  memberName: string;
  organizationId: string;
  organizationName: string;
  collectedBy: string;
  paymentMethod?: string | null;
  paidAmount: number;
  appliedToDue: number;
  overpaymentToCredit: number;
  remainingAfter: number;
  outstandingAfterPayment: number;
  creditBalanceAfterPayment: number;
}

export interface PaymentStatementItem {
  id: string;
  entryType:
    | "due"
    | "due_adjustment"
    | "payment"
    | "payment_reversal"
    | "credit_overpayment"
    | "debit_auto_apply"
    | "credit_adjustment"
    | "debit_adjustment";
  occurredAt: string;
  action: string;
  dueType: string | null;
  detail: string | null;
  description: string;
  reference: string | null;
  note: string | null;
  debit: number;
  credit: number;
  balance: number;
  actor: string | null;
  paymentId: string | null;
  paymentDueId: string | null;
  receiptAvailable: boolean;
  reversible: boolean;
}

export interface DashboardStats {
  totalHouseholds: number;
  totalHeadcount: number;
  adults: number;
  youth: number;
  children: number;
  totalDueThisMonth: number;
  collectedThisMonth: number;
  outstandingThisMonth: number;
  overpaymentsThisMonth: number;
  period: string;
}

export interface MembershipBalance {
  membershipId: string;
  membershipNo: string;
  totalDue: number;
  totalPaid: number;
  outstanding: number;
  creditBalance: number;
  netOutstanding: number;
  overdueCount: number;
  dues: PaymentDue[];
}

export type MembershipCreditEntryType =
  | "credit_overpayment"
  | "debit_auto_apply"
  | "credit_adjustment"
  | "debit_adjustment";

export interface MembershipCreditEntry {
  id: string;
  membershipId: string;
  organizationId: string;
  paymentId?: string | null;
  paymentDueId?: string | null;
  amountDelta: number;
  entryType: MembershipCreditEntryType;
  note?: string | null;
  createdByUserId?: string | null;
  createdAt: string;
  paymentDue?: { id: string; period: string } | null;
  payment?: { id: string; amount: number; paymentDate: string } | null;
  createdBy?: { id: string; email: string } | null;
}

export type PermissionType =
  | "MANAGE_PERSONS"
  | "VIEW_PERSONS"
  | "MANAGE_MEMBERSHIPS"
  | "VIEW_MEMBERSHIPS"
  | "COLLECT_PAYMENTS"
  | "VIEW_PAYMENTS"
  | "MANAGE_ANNOUNCEMENTS"
  | "MANAGE_DISTRIBUTIONS"
  | "VIEW_REPORTS";

export const ALL_PERMISSIONS: PermissionType[] = [
  "MANAGE_PERSONS", "VIEW_PERSONS",
  "MANAGE_MEMBERSHIPS", "VIEW_MEMBERSHIPS",
  "COLLECT_PAYMENTS", "VIEW_PAYMENTS",
  "MANAGE_ANNOUNCEMENTS", "MANAGE_DISTRIBUTIONS", "VIEW_REPORTS",
];

export interface UserBookmark {
  id: string;
  actionKey: string;
  displayOrder: number;
  createdAt: string;
}

export interface AnnouncementGroup {
  id: string;
  name: string;
  description?: string | null;
  organizationId: string;
  createdAt: string;
}

export interface Announcement {
  id: string;
  groupId?: string | null;
  organizationId: string;
  message: string;
  sentAt?: string | null;
  status: "draft" | "sent" | "failed";
  group?: { id: string; name: string } | null;
  createdAt: string;
}

export interface Zone {
  id: string;
  organizationId: string;
  name: string;
  code: number;
  isActive: boolean;
  createdAt: string;
}

export interface FormFieldConfig {
  id: string;
  organizationId: string;
  formType: "Person" | "Membership";
  fieldName: string;
  visibility: "Required" | "Optional" | "Hidden";
  displayOrder: number;
}

export interface OrganizationBilling {
  id: string;
  organizationId: string;
  year: number;
  isPaid: boolean;
  paidAt?: string | null;
  markedBy?: { id: string; email: string } | null;
}

export interface Distribution {
  id: string;
  name: string;
  description?: string | null;
  organizationId: string;
  frequency: "Daily" | "Monthly" | "Yearly";
  filterCriteria?: Record<string, unknown> | null;
  isActive: boolean;
  createdAt: string;
  totalEligible?: number;
  totalDistributed?: number;
  currentCycleDate?: string;
}

export interface DistributionScanResult {
  success: boolean;
  alreadyDistributed?: boolean;
  person: { name: string };
}

export interface DistributionReport {
  distributionId: string;
  name: string;
  totalEligible: number;
  totalDistributed: number;
  totalPending: number;
  completionPercentage: number;
}

export interface MessageQueueItem {
  id: string;
  organizationId: string;
  recipientPhone: string;
  eventType: string;
  messageBody: string;
  status: "pending" | "sent" | "failed";
  createdAt: string;
  sentAt?: string | null;
}

export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}
