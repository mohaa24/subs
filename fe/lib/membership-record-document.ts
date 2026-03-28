import { RELATION_TO_HOH_OPTIONS } from "@/lib/constants";
import type { Membership, Person, Zone } from "@/lib/api";

type DocumentOptions = {
  membership: Membership;
  zones: Zone[];
  logoUrl: string;
  verificationUrl?: string;
  qrDataUrl?: string;
  systemSignature?: string;
  autoPrint?: boolean;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "&nbsp;";
  return escapeHtml(String(value));
}

function formatDate(value: string | null | undefined) {
  if (!value) return "&nbsp;";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "&nbsp;";
  return escapeHtml(date.toLocaleDateString());
}

function getAge(value: string | null | undefined): number | null {
  if (!value) return null;
  const birth = new Date(value);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age;
}

function isCountableMember(
  person: (Person & { isArchived?: boolean | null; livingStatus?: string | null }) | null | undefined
) {
  if (!person) return false;
  if (person.isArchived) return false;
  return !person.livingStatus || person.livingStatus === "Active";
}

function buildZoneLabel(areaCode: number | null | undefined, zones: Zone[]) {
  if (!areaCode) return "";
  const zone = zones.find((item) => item.code === areaCode);
  return zone ? `${zone.code} - ${zone.name}` : String(areaCode);
}

function qualificationLabel(person: (Person & { highestQualificationType?: string | null; highestQualificationTitle?: string | null }) | null | undefined) {
  if (!person) return "";
  const parts = [person.highestQualificationType, person.highestQualificationTitle].filter(Boolean);
  return parts.join(" - ");
}

function relationLabel(value: string | null | undefined) {
  if (!value) return "";
  return RELATION_TO_HOH_OPTIONS.find((item) => item.value === value)?.label ?? value;
}

function nicLabel(person: (Person & { nicNumber?: string | null; idNumber?: string | null }) | null | undefined) {
  if (!person) return "";
  return person.nicNumber || person.idNumber || "";
}

function buildDetailRows(rows: Array<{ label: string; value: string }>) {
  return rows
    .map(
      (row) => `
        <tr>
          <td class="detail-label">${escapeHtml(row.label)}</td>
          <td class="detail-value">${formatValue(row.value)}</td>
        </tr>
      `
    )
    .join("");
}

function buildMemberRows(
  items: Array<{
    name?: string | null;
    dateOfBirth?: string | null;
    gender?: string | null;
    nicNumber?: string | null;
    idNumber?: string | null;
    occupation?: string | null;
    relationToHOH?: string | null;
  }>,
  includeRelationship: boolean
) {
  const rowCount = Math.max(4, items.length);
  return Array.from({ length: rowCount }, (_, index) => {
    const item = items[index];
    const cells = [
      `<td class="cell center">${index + 1}</td>`,
      `<td class="cell">${formatValue(item?.name ?? "")}</td>`,
      `<td class="cell">${formatDate(item?.dateOfBirth ?? null)}</td>`,
      `<td class="cell">${formatValue(item?.gender ?? "")}</td>`,
      `<td class="cell">${formatValue((item?.nicNumber || item?.idNumber || ""))}</td>`,
      `<td class="cell">${formatValue(item?.occupation ?? "")}</td>`,
    ];
    if (includeRelationship) {
      cells.push(`<td class="cell">${formatValue(relationLabel(item?.relationToHOH ?? ""))}</td>`);
    }
    return `<tr>${cells.join("")}</tr>`;
  }).join("");
}

export function buildMembershipRecordHtml({
  membership,
  zones,
  logoUrl,
  verificationUrl,
  qrDataUrl,
  systemSignature,
  autoPrint = false,
}: DocumentOptions) {
  const allMembers = [
    ...(membership.hod ? [membership.hod] : []),
    ...(membership.spouse ? [membership.spouse] : []),
    ...(membership.dependents?.map((dep) => dep.person) ?? []),
  ];
  const countableMembers = allMembers.filter(isCountableMember);

  const adults = countableMembers.filter((person) => {
    const age = getAge(person.dateOfBirth);
    return age === null || age >= 18;
  }).length;
  const youth = countableMembers.filter((person) => {
    const age = getAge(person.dateOfBirth);
    return age !== null && age >= 13 && age <= 17;
  }).length;
  const children = countableMembers.filter((person) => {
    const age = getAge(person.dateOfBirth);
    return age !== null && age >= 0 && age <= 12;
  }).length;

  const childDependents = membership.dependents?.filter((dep) => (dep.group ?? "other") === "children") ?? [];
  const otherDependents = membership.dependents?.filter((dep) => (dep.group ?? "other") === "other") ?? [];

  const mosqueName = membership.organization?.name || "MASJIDUL HUDHA JUMMAH MASJID";
  const mosqueAddress = membership.organization?.address || "KOTTAMBAPITIYA, HETTIPOLA";

  const summaryRows = buildDetailRows([
    { label: "Membership Number", value: membership.membershipNo },
    { label: "Total Members Recorded", value: String(countableMembers.length) },
    { label: "Number of Adults (Age 18+)", value: String(adults) },
    { label: "Number of Youth (Age 13-17)", value: String(youth) },
    { label: "Number of Children (Age 0-12)", value: String(children) },
  ]);

  const headRows = buildDetailRows([
    { label: "Full Name", value: membership.hod?.fullName || "" },
    { label: "Name with Initials", value: membership.hod?.nameWithInitials || "" },
    { label: "NIC Number", value: nicLabel(membership.hod) },
    { label: "Date of Birth", value: membership.hod?.dateOfBirth ? new Date(membership.hod.dateOfBirth).toLocaleDateString() : "" },
    { label: "Address", value: membership.hod?.address || "" },
    { label: "Mobile Number", value: membership.hod?.mobileNumber || "" },
    { label: "WhatsApp Number", value: membership.hod?.whatsAppNumber || "" },
    { label: "Occupation", value: membership.hod?.occupation || "" },
    { label: "Educational Qualification", value: qualificationLabel(membership.hod) },
    { label: "Area Code / Village Service Division", value: buildZoneLabel(membership.hod?.areaCode ?? membership.areaCode, zones) },
  ]);

  const spouseRows = buildDetailRows([
    { label: "Full Name", value: membership.spouse?.fullName || "" },
    { label: "Name with Initials", value: membership.spouse?.nameWithInitials || "" },
    { label: "NIC Number", value: nicLabel(membership.spouse) },
    { label: "Date of Birth", value: membership.spouse?.dateOfBirth ? new Date(membership.spouse.dateOfBirth).toLocaleDateString() : "" },
    { label: "Occupation", value: membership.spouse?.occupation || "" },
    { label: "Educational Qualification", value: qualificationLabel(membership.spouse) },
    { label: "Area Code / Village Service Division", value: buildZoneLabel(membership.spouse?.areaCode ?? membership.areaCode, zones) },
  ]);

  const childrenRows = buildMemberRows(
    childDependents.map((dep) => dep.person),
    false
  );
  const otherRows = buildMemberRows(
    otherDependents.map((dep) => dep.person),
    true
  );

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Membership Record - ${escapeHtml(membership.membershipNo)}</title>
    <style>
      :root {
        color-scheme: light;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        font-family: "Times New Roman", Georgia, serif;
        color: #111827;
        background: #ffffff;
      }
      .page {
        width: 210mm;
        margin: 0 auto;
        padding: 16mm 14mm 18mm;
      }
      .header {
        position: relative;
        text-align: center;
        margin-bottom: 12mm;
      }
      .logo {
        display: block;
        max-width: 165mm;
        max-height: 32mm;
        margin: 0 auto 6mm;
        object-fit: contain;
      }
      .org-name {
        font-size: 18px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        margin: 0;
      }
      .org-address {
        margin: 2mm 0 0;
        font-size: 13px;
        text-transform: uppercase;
      }
      .title {
        margin: 6mm 0 0;
        font-size: 18px;
        font-weight: 700;
        text-transform: uppercase;
      }
      .verify-box {
        position: absolute;
        top: 0;
        right: 0;
        width: 24mm;
        text-align: center;
      }
      .verify-qr {
        width: 22mm;
        height: 22mm;
        border: 1px solid #9ca3af;
        padding: 1.2mm;
        background: #fff;
      }
      .verify-label {
        margin-top: 1.5mm;
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .section {
        margin-top: 8mm;
        page-break-inside: avoid;
      }
      .section-title {
        font-size: 15px;
        font-weight: 700;
        margin: 0 0 3mm;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      .details-table td {
        border: 1px solid #4b5563;
        padding: 3mm 3.2mm;
        vertical-align: top;
        font-size: 13px;
      }
      .detail-label {
        width: 40%;
        font-weight: 700;
        background: #f8fafc;
      }
      .detail-value {
        width: 60%;
      }
      .grid-2 {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6mm;
      }
      .members-table th,
      .members-table td {
        border: 1px solid #4b5563;
        padding: 2.8mm 2.4mm;
        font-size: 12px;
      }
      .members-table th {
        background: #f8fafc;
        font-weight: 700;
        text-align: left;
      }
      .cell {
        min-height: 12mm;
        height: 12mm;
      }
      .center {
        text-align: center;
      }
      .declaration {
        margin-top: 8mm;
        font-size: 13px;
        line-height: 1.65;
      }
      .signature-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10mm;
        margin-top: 8mm;
      }
      .signature-grid.three {
        grid-template-columns: 1fr 1fr 1fr;
      }
      .signature-block {
        padding-top: 12mm;
        border-top: 1px solid #111827;
        text-align: center;
        font-size: 12px;
        min-height: 18mm;
      }
      .system-signature {
        margin-top: 10mm;
        border-top: 1px dashed #6b7280;
        padding-top: 4mm;
        font-size: 10px;
        line-height: 1.6;
        color: #374151;
        word-break: break-word;
      }
      @page {
        size: A4;
        margin: 10mm;
      }
      @media print {
        body {
          print-color-adjust: exact;
          -webkit-print-color-adjust: exact;
        }
        .page {
          width: auto;
          margin: 0;
          padding: 0;
        }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <header class="header">
        ${qrDataUrl ? `
          <div class="verify-box">
            <img class="verify-qr" src="${escapeHtml(qrDataUrl)}" alt="Verification QR code" />
            <div class="verify-label">Verify</div>
          </div>
        ` : ""}
        <img class="logo" src="${escapeHtml(logoUrl)}" alt="Mosque header" />
        <p class="org-name">${escapeHtml(mosqueName)}</p>
        <p class="org-address">${escapeHtml(mosqueAddress)}</p>
        <p class="title">Mosque Membership Record</p>
      </header>

      <section class="section">
        <table class="details-table">
          <tbody>
            ${summaryRows}
          </tbody>
        </table>
      </section>

      <section class="section">
        <h2 class="section-title">Head of Household Details</h2>
        <table class="details-table">
          <tbody>
            ${headRows}
          </tbody>
        </table>
      </section>

      <section class="section">
        <h2 class="section-title">Spouse Details</h2>
        <table class="details-table">
          <tbody>
            ${spouseRows}
          </tbody>
        </table>
      </section>

      <section class="section">
        <h2 class="section-title">Children Details</h2>
        <table class="members-table">
          <thead>
            <tr>
              <th style="width: 7%;">No</th>
              <th style="width: 33%;">Name</th>
              <th style="width: 18%;">Date of Birth</th>
              <th style="width: 12%;">Gender</th>
              <th style="width: 16%;">NIC</th>
              <th style="width: 14%;">Occupation</th>
            </tr>
          </thead>
          <tbody>
            ${childrenRows}
          </tbody>
        </table>
      </section>

      <section class="section">
        <h2 class="section-title">Other Dependents / Relatives Living in the House</h2>
        <table class="members-table">
          <thead>
            <tr>
              <th style="width: 6%;">No</th>
              <th style="width: 23%;">Name</th>
              <th style="width: 14%;">Date of Birth</th>
              <th style="width: 10%;">Gender</th>
              <th style="width: 14%;">NIC</th>
              <th style="width: 13%;">Occupation</th>
              <th style="width: 20%;">Relationship</th>
            </tr>
          </thead>
          <tbody>
            ${otherRows}
          </tbody>
        </table>
      </section>

      <section class="section">
        <h2 class="section-title">Member Declaration</h2>
        <p class="declaration">
          I confirm that the information provided above is true and correct. I agree to abide by the rules and regulations of the mosque and to cooperate with the mosque administration.
        </p>
        <div class="signature-grid">
          <div class="signature-block">Member Signature</div>
          <div class="signature-block">Date</div>
        </div>
      </section>

      <section class="section">
        <h2 class="section-title">Mosque Declaration</h2>
        <p class="declaration">
          This membership record is issued by the mosque following the approval of the member's application.
        </p>
        <div class="signature-grid three">
          <div class="signature-block">Chairman Signature</div>
          <div class="signature-block">Secretary Signature</div>
          <div class="signature-block">Official Seal</div>
        </div>
        <div class="system-signature">
          <strong>System Signature:</strong> ${formatValue(systemSignature ?? "")}<br />
          ${verificationUrl ? `<strong>Verification URL:</strong> ${formatValue(verificationUrl)}` : ""}
        </div>
      </section>
    </main>
    ${autoPrint ? `
      <script>
        window.addEventListener("load", function () {
          window.print();
        });
      </script>
    ` : ""}
  </body>
</html>`;
}

export function openMembershipRecordDocument(options: DocumentOptions) {
  const popup = window.open("", "_blank", "width=1024,height=1400");
  if (!popup) return false;

  popup.document.open();
  popup.document.write(buildMembershipRecordHtml(options));
  popup.document.close();
  popup.focus();
  popup.addEventListener("load", () => {
    popup.print();
  });
  return true;
}
