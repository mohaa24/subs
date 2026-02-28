export const TITLES = [
  { value: "Mr", label: "Mr" },
  { value: "Master", label: "Master" },
  { value: "Miss", label: "Miss" },
  { value: "Mrs", label: "Mrs" },
  { value: "Ms", label: "Ms" },
  { value: "Dr", label: "Dr" },
] as const;

export const GENDER_OPTIONS = [
  { value: "Male", label: "Male" },
  { value: "Female", label: "Female" },
] as const;

export const IDENTITY_TYPES = [
  { value: "NIC", label: "NIC" },
  { value: "Passport", label: "Passport" },
  { value: "DrivingLicense", label: "Driving License" },
] as const;

export const BLOOD_GROUPS = [
  { value: "A_pos", label: "A+" },
  { value: "A_neg", label: "A-" },
  { value: "B_pos", label: "B+" },
  { value: "B_neg", label: "B-" },
  { value: "AB_pos", label: "AB+" },
  { value: "AB_neg", label: "AB-" },
  { value: "O_pos", label: "O+" },
  { value: "O_neg", label: "O-" },
] as const;

export const HIGHEST_QUALIFICATION_TYPES = [
  { value: "O/L", label: "O/L" },
  { value: "A/L", label: "A/L" },
  { value: "Degree", label: "Degree" },
  { value: "Masters", label: "Masters" },
  { value: "Phd", label: "Phd" },
  { value: "Diploma", label: "Diploma" },
  { value: "None", label: "None" },
  { value: "In School", label: "In School" },
] as const;

export const WORK_LOCATIONS = [
  { value: "Within Local Area", label: "Within Local Area" },
  { value: "Outside Local Area", label: "Outside Local Area" },
  { value: "Overseas", label: "Overseas" },
] as const;

export const PERMANENT_DISABILITY_OPTIONS = [
  { value: "No disability", label: "No disability" },
  {
    value: "Physical disability, problem walking or moving",
    label: "Physical disability, problem walking or moving",
  },
  { value: "Vision problem, difficulty seeing", label: "Vision problem, difficulty seeing" },
  { value: "Hearing problem, difficulty hearing", label: "Hearing problem, difficulty hearing" },
  { value: "Mental health problem", label: "Mental health problem" },
  { value: "Long-term illness", label: "Long-term illness" },
  { value: "More than one disability", label: "More than one disability" },
  { value: "Other", label: "Other" },
] as const;

export const RESIDENT_TYPES = [
  { value: "ResidentSinceBirth", label: "Resident since Birth" },
  { value: "ResidentByMarriage", label: "Resident by Marriage" },
  { value: "BusinessResidency", label: "Business Residency" },
  { value: "EmploymentResidency", label: "Employment Residency" },
  { value: "EducationalResidency", label: "Educational Residency" },
  { value: "FamilyMemberOfResident", label: "Family member of a resident" },
  { value: "NonResidentPerson", label: "Non-resident Person" },
] as const;

export const LIVING_STATUSES = [
  { value: "Active", label: "Active" },
  { value: "Deceased", label: "Deceased" },
  { value: "PermanentlyRelocated", label: "Permanently Relocated" },
] as const;

export const RELATION_TO_HOH_OPTIONS = [
  { value: "Husband", label: "Husband" },
  { value: "Wife", label: "Wife" },
  { value: "Son", label: "Son" },
  { value: "Daughter", label: "Daughter" },
  { value: "AdoptedSon", label: "Adopted Son" },
  { value: "AdoptedDaughter", label: "Adopted Daughter" },
  { value: "Father", label: "Father" },
  { value: "Mother", label: "Mother" },
  { value: "StepFather", label: "Step-father" },
  { value: "StepMother", label: "Step-mother" },
  { value: "Brother", label: "Brother" },
  { value: "Sister", label: "Sister" },
  { value: "Grandfather", label: "Grandfather" },
  { value: "Grandmother", label: "Grandmother" },
  { value: "Grandson", label: "Grandson" },
  { value: "Granddaughter", label: "Granddaughter" },
  { value: "SonInLaw", label: "Son-in-law" },
  { value: "DaughterInLaw", label: "Daughter-in-law" },
  { value: "Uncle", label: "Uncle" },
  { value: "Aunt", label: "Aunt" },
  { value: "Nephew", label: "Nephew" },
  { value: "Niece", label: "Niece" },
  { value: "Cousin", label: "Cousin" },
  { value: "FatherInLaw", label: "Father-in-law" },
  { value: "MotherInLaw", label: "Mother-in-law" },
] as const;

export const SPOUSE_RELATION_OPTIONS = RELATION_TO_HOH_OPTIONS.filter(
  (opt) => opt.value === "Husband" || opt.value === "Wife"
);

export const CHILD_RELATION_OPTIONS = RELATION_TO_HOH_OPTIONS.filter((opt) =>
  ["Son", "Daughter", "AdoptedSon", "AdoptedDaughter", "Grandson", "Granddaughter"].includes(
    opt.value
  )
);

export const OTHER_DEPENDENT_RELATION_OPTIONS = RELATION_TO_HOH_OPTIONS.filter(
  (opt) => !["Husband", "Wife", "Son", "Daughter", "AdoptedSon", "AdoptedDaughter", "Grandson", "Granddaughter"].includes(opt.value)
);

export const OCCUPATIONS = [
  "Accountant / Finance Professional",
  "Bakery Worker / Pastry Chef",
  "Bank Staff",
  "Barber / Hairdresser",
  "Beautician / Salon Worker",
  "Businessman / Entrepreneur",
  "Carpenter",
  "Chef / Cook",
  "Cleaner / Janitorial Worker",
  "Construction Worker / Mason",
  "Customer Service / Call Center",
  "Delivery Rider / Courier",
  "Doctor",
  "Domestic Helper / Maid",
  "Driver / Transport Worker",
  "Electrician",
  "Engineer",
  "Factory Worker / Machine Operator",
  "Farmer",
  "Fisher Market / Vegetable Vendor",
  "Fisherman",
  "Government Employee",
  "Graphic Designer / Digital Media",
  "Hospital Support Worker",
  "Hospitality & Tourism Worker",
  "Housewife / Homemaker",
  "Insurance Agent",
  "IT / Technology Professional",
  "Laboratory Technician",
  "Labourer / Daily Wage Worker",
  "Livestock & Poultry Worker",
  "Mechanic / Vehicle Technician",
  "NGO / Social Service Worker",
  "Nurse / Midwife",
  "Office Worker / Clerical Staff",
  "Other",
  "Pavement Seller / Street Vendor",
  "Pharmacist / Medical Dispenser",
  "Photographer / Videographer",
  "Pilot",
  "Plumber",
  "Real Estate / Property Agent",
  "Religious Worker",
  "Sales & Marketing Staff",
  "Seamen",
  "Security Officer",
  "Shop Owner / Retail Shop Keeper",
  "Social Media Content Creator",
  "Student",
  "Tailor / Garment Worker",
  "Teacher / Lecturer / Instructor",
  "Unemployed / Looking for Work",
  "Video Editor",
  "Welder / Fabricator",
] as const;
