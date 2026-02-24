"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcrypt = __importStar(require("bcryptjs"));
const library_1 = require("@prisma/client/runtime/library");
const prisma = new client_1.PrismaClient();
async function main() {
    const hash = async (pw) => bcrypt.hash(pw, 10);
    // ── Super user ─────────────────────────────────────────────────────────────
    await prisma.user.upsert({
        where: { email: "super@example.com" },
        create: {
            email: "super@example.com",
            passwordHash: await hash("admin123"),
            role: client_1.UserRole.super_user,
        },
        update: { passwordHash: await hash("admin123") },
    });
    console.log("✓ super@example.com / admin123");
    // ── Organizations ──────────────────────────────────────────────────────────
    const alnoor = await prisma.organization.upsert({
        where: { slug: "al-noor" },
        create: { name: "Al-Noor Mosque", slug: "al-noor" },
        update: {},
    });
    const altaqwa = await prisma.organization.upsert({
        where: { slug: "al-taqwa" },
        create: { name: "Al-Taqwa Mosque", slug: "al-taqwa" },
        update: {},
    });
    console.log("✓ Organizations: Al-Noor Mosque, Al-Taqwa Mosque");
    // ── Users per org ──────────────────────────────────────────────────────────
    await prisma.user.upsert({
        where: { email: "admin@alnoor.com" },
        create: {
            email: "admin@alnoor.com",
            passwordHash: await hash("admin123"),
            role: client_1.UserRole.admin,
            organizationId: alnoor.id,
        },
        update: { passwordHash: await hash("admin123"), organizationId: alnoor.id },
    });
    await prisma.user.upsert({
        where: { email: "user@alnoor.com" },
        create: {
            email: "user@alnoor.com",
            passwordHash: await hash("user1234"),
            role: client_1.UserRole.user,
            organizationId: alnoor.id,
        },
        update: { passwordHash: await hash("user1234"), organizationId: alnoor.id },
    });
    await prisma.user.upsert({
        where: { email: "admin@altaqwa.com" },
        create: {
            email: "admin@altaqwa.com",
            passwordHash: await hash("admin123"),
            role: client_1.UserRole.admin,
            organizationId: altaqwa.id,
        },
        update: { passwordHash: await hash("admin123"), organizationId: altaqwa.id },
    });
    await prisma.user.upsert({
        where: { email: "user@altaqwa.com" },
        create: {
            email: "user@altaqwa.com",
            passwordHash: await hash("user1234"),
            role: client_1.UserRole.user,
            organizationId: altaqwa.id,
        },
        update: { passwordHash: await hash("user1234"), organizationId: altaqwa.id },
    });
    console.log("✓ Users: admin@alnoor.com, user@alnoor.com, admin@altaqwa.com, user@altaqwa.com");
    // ── Helper: upsert a person by NIC (or name if no NIC) ────────────────────
    async function upsertPerson(orgId, data) {
        const existing = await prisma.person.findFirst({
            where: { organizationId: orgId, fullName: data.fullName },
        });
        if (existing)
            return existing;
        return prisma.person.create({ data: { ...data, organizationId: orgId } });
    }
    // ── Helper: membershipNo ───────────────────────────────────────────────────
    async function nextMembershipNo(orgId, slug) {
        const year = new Date().getFullYear();
        const count = await prisma.membership.count({
            where: { organizationId: orgId, membershipNo: { startsWith: `${slug}-${year}-` } },
        });
        return `${slug}-${year}-${String(count + 1).padStart(5, "0")}`;
    }
    // ── Al-Noor Mosque — People ────────────────────────────────────────────────
    const [anHod1, anSpouse1, anChild1, anHod2, anSpouse2, anHod3] = await Promise.all([
        upsertPerson(alnoor.id, {
            nameWithInitials: "M.A. Rahman",
            fullName: "Mohamed Abdul Rahman",
            gender: "Male",
            nicNumber: "199012345678",
            dateOfBirth: new Date("1990-03-14"),
            maritalStatus: "married",
            mobileNumber: "0771234567",
            address: "12 Noor Lane, Colombo 05",
            occupation: "Teacher",
        }),
        upsertPerson(alnoor.id, {
            nameWithInitials: "F. Rahman",
            fullName: "Fathima Rahman",
            gender: "Female",
            nicNumber: "199256781234",
            dateOfBirth: new Date("1992-07-22"),
            maritalStatus: "married",
            mobileNumber: "0779876543",
            address: "12 Noor Lane, Colombo 05",
            occupation: "Homemaker",
        }),
        upsertPerson(alnoor.id, {
            nameWithInitials: "A. Rahman",
            fullName: "Ahmed Rahman",
            gender: "Male",
            dateOfBirth: new Date("2015-01-10"),
            maritalStatus: "single",
            address: "12 Noor Lane, Colombo 05",
        }),
        upsertPerson(alnoor.id, {
            nameWithInitials: "I. Farooq",
            fullName: "Ibrahim Farooq",
            gender: "Male",
            nicNumber: "198534561230",
            dateOfBirth: new Date("1985-09-05"),
            maritalStatus: "married",
            mobileNumber: "0762345678",
            address: "34 Salam Street, Colombo 10",
            occupation: "Accountant",
        }),
        upsertPerson(alnoor.id, {
            nameWithInitials: "Z. Farooq",
            fullName: "Zainab Farooq",
            gender: "Female",
            nicNumber: "198890123456",
            dateOfBirth: new Date("1988-11-30"),
            maritalStatus: "married",
            mobileNumber: "0763456789",
            address: "34 Salam Street, Colombo 10",
            occupation: "Nurse",
        }),
        upsertPerson(alnoor.id, {
            nameWithInitials: "H. Siddiq",
            fullName: "Hassan Siddiq",
            gender: "Male",
            nicNumber: "197812309870",
            dateOfBirth: new Date("1978-06-18"),
            maritalStatus: "married",
            mobileNumber: "0754321098",
            address: "78 Huda Road, Colombo 07",
            occupation: "Engineer",
        }),
    ]);
    // ── Al-Noor Mosque — Memberships ───────────────────────────────────────────
    const existing1 = await prisma.membership.findFirst({ where: { organizationId: alnoor.id, hodPersonId: anHod1.id } });
    if (!existing1) {
        await prisma.membership.create({
            data: {
                membershipNo: await nextMembershipNo(alnoor.id, "al-noor"),
                organizationId: alnoor.id,
                dateOfRegistration: new Date("2023-01-15"),
                membershipType: client_1.MembershipType.Resident,
                membershipStatus: "Active",
                hodPersonId: anHod1.id,
                spousePersonId: anSpouse1.id,
                land: true,
                houseOwnership: true,
                toiletFacility: true,
                waterAccessibility: true,
                electricity: true,
                paymentPeriod: client_1.PaymentPeriod.Monthly,
                membershipFee: new library_1.Decimal(500),
                additionalVoluntaryContributions: new library_1.Decimal(100),
                membershipFeeDiscount: new library_1.Decimal(0),
                totalContribution: new library_1.Decimal(600),
                dependents: { create: [{ personId: anChild1.id, order: 1 }] },
            },
        });
        console.log("✓ Al-Noor membership 1: Mohamed Abdul Rahman (Family)");
    }
    const existing2 = await prisma.membership.findFirst({ where: { organizationId: alnoor.id, hodPersonId: anHod2.id } });
    if (!existing2) {
        await prisma.membership.create({
            data: {
                membershipNo: await nextMembershipNo(alnoor.id, "al-noor"),
                organizationId: alnoor.id,
                dateOfRegistration: new Date("2023-04-01"),
                membershipType: client_1.MembershipType.Resident,
                membershipStatus: "Active",
                hodPersonId: anHod2.id,
                spousePersonId: anSpouse2.id,
                houseOwnership: true,
                toiletFacility: true,
                electricity: true,
                paymentPeriod: client_1.PaymentPeriod.Quarterly,
                membershipFee: new library_1.Decimal(1500),
                additionalVoluntaryContributions: new library_1.Decimal(0),
                membershipFeeDiscount: new library_1.Decimal(0),
                totalContribution: new library_1.Decimal(1500),
            },
        });
        console.log("✓ Al-Noor membership 2: Ibrahim Farooq (Family)");
    }
    const existing3 = await prisma.membership.findFirst({ where: { organizationId: alnoor.id, hodPersonId: anHod3.id } });
    if (!existing3) {
        await prisma.membership.create({
            data: {
                membershipNo: await nextMembershipNo(alnoor.id, "al-noor"),
                organizationId: alnoor.id,
                dateOfRegistration: new Date("2024-02-20"),
                membershipType: client_1.MembershipType.NonResident,
                membershipStatus: "Active",
                hodPersonId: anHod3.id,
                land: false,
                houseOwnership: false,
                vehicleOwnership: true,
                electricity: true,
                paymentPeriod: client_1.PaymentPeriod.Annually,
                membershipFee: new library_1.Decimal(6000),
                additionalVoluntaryContributions: new library_1.Decimal(500),
                membershipFeeDiscount: new library_1.Decimal(500),
                totalContribution: new library_1.Decimal(6000),
            },
        });
        console.log("✓ Al-Noor membership 3: Hassan Siddiq (Individual)");
    }
    // ── Al-Taqwa Mosque — People ───────────────────────────────────────────────
    const [atHod1, atSpouse1, atChild1, atChild2, atHod2, atSpouse2, atHod3] = await Promise.all([
        upsertPerson(altaqwa.id, {
            nameWithInitials: "Y. Al-Amin",
            fullName: "Yusuf Al-Amin",
            gender: "Male",
            nicNumber: "198845670123",
            dateOfBirth: new Date("1988-05-12"),
            maritalStatus: "married",
            mobileNumber: "0712345678",
            address: "22 Taqwa Avenue, Kandy",
            occupation: "Doctor",
        }),
        upsertPerson(altaqwa.id, {
            nameWithInitials: "M. Al-Amin",
            fullName: "Mariam Al-Amin",
            gender: "Female",
            nicNumber: "199012349876",
            dateOfBirth: new Date("1990-02-28"),
            maritalStatus: "married",
            mobileNumber: "0713456789",
            address: "22 Taqwa Avenue, Kandy",
            occupation: "Pharmacist",
        }),
        upsertPerson(altaqwa.id, {
            nameWithInitials: "O. Al-Amin",
            fullName: "Omar Al-Amin",
            gender: "Male",
            dateOfBirth: new Date("2013-08-15"),
            maritalStatus: "single",
            address: "22 Taqwa Avenue, Kandy",
        }),
        upsertPerson(altaqwa.id, {
            nameWithInitials: "S. Al-Amin",
            fullName: "Safiya Al-Amin",
            gender: "Female",
            dateOfBirth: new Date("2016-04-03"),
            maritalStatus: "single",
            address: "22 Taqwa Avenue, Kandy",
        }),
        upsertPerson(altaqwa.id, {
            nameWithInitials: "A. Malik",
            fullName: "Abdullah Malik",
            gender: "Male",
            nicNumber: "198012367890",
            dateOfBirth: new Date("1980-12-01"),
            maritalStatus: "married",
            mobileNumber: "0776543210",
            address: "5 Hidaya Road, Kandy",
            occupation: "Business Owner",
        }),
        upsertPerson(altaqwa.id, {
            nameWithInitials: "K. Malik",
            fullName: "Khadija Malik",
            gender: "Female",
            nicNumber: "198212300987",
            dateOfBirth: new Date("1982-03-19"),
            maritalStatus: "married",
            mobileNumber: "0777654321",
            address: "5 Hidaya Road, Kandy",
            occupation: "Homemaker",
        }),
        upsertPerson(altaqwa.id, {
            nameWithInitials: "S. Umar",
            fullName: "Salman Umar",
            gender: "Male",
            nicNumber: "199512398760",
            dateOfBirth: new Date("1995-10-10"),
            maritalStatus: "single",
            mobileNumber: "0752109876",
            address: "90 Iman Street, Kandy",
            occupation: "Software Developer",
        }),
    ]);
    // ── Al-Taqwa Mosque — Memberships ──────────────────────────────────────────
    const existing4 = await prisma.membership.findFirst({ where: { organizationId: altaqwa.id, hodPersonId: atHod1.id } });
    if (!existing4) {
        await prisma.membership.create({
            data: {
                membershipNo: await nextMembershipNo(altaqwa.id, "al-taqwa"),
                organizationId: altaqwa.id,
                dateOfRegistration: new Date("2022-08-10"),
                membershipType: client_1.MembershipType.Resident,
                membershipStatus: "Active",
                hodPersonId: atHod1.id,
                spousePersonId: atSpouse1.id,
                land: true,
                houseOwnership: true,
                commercialProperties: false,
                toiletFacility: true,
                vehicleOwnership: true,
                waterAccessibility: true,
                electricity: true,
                paymentPeriod: client_1.PaymentPeriod.Monthly,
                membershipFee: new library_1.Decimal(750),
                additionalVoluntaryContributions: new library_1.Decimal(250),
                membershipFeeDiscount: new library_1.Decimal(0),
                totalContribution: new library_1.Decimal(1000),
                dependents: {
                    create: [
                        { personId: atChild1.id, order: 1 },
                        { personId: atChild2.id, order: 2 },
                    ],
                },
            },
        });
        console.log("✓ Al-Taqwa membership 1: Yusuf Al-Amin (Family)");
    }
    const existing5 = await prisma.membership.findFirst({ where: { organizationId: altaqwa.id, hodPersonId: atHod2.id } });
    if (!existing5) {
        await prisma.membership.create({
            data: {
                membershipNo: await nextMembershipNo(altaqwa.id, "al-taqwa"),
                organizationId: altaqwa.id,
                dateOfRegistration: new Date("2023-06-01"),
                membershipType: client_1.MembershipType.Resident,
                membershipStatus: "Active",
                hodPersonId: atHod2.id,
                spousePersonId: atSpouse2.id,
                land: true,
                houseOwnership: true,
                commercialProperties: true,
                toiletFacility: true,
                vehicleOwnership: true,
                waterAccessibility: true,
                electricity: true,
                paymentPeriod: client_1.PaymentPeriod.Quarterly,
                membershipFee: new library_1.Decimal(2000),
                additionalVoluntaryContributions: new library_1.Decimal(500),
                membershipFeeDiscount: new library_1.Decimal(200),
                totalContribution: new library_1.Decimal(2300),
                disability: false,
            },
        });
        console.log("✓ Al-Taqwa membership 2: Abdullah Malik (Family)");
    }
    const existing6 = await prisma.membership.findFirst({ where: { organizationId: altaqwa.id, hodPersonId: atHod3.id } });
    if (!existing6) {
        await prisma.membership.create({
            data: {
                membershipNo: await nextMembershipNo(altaqwa.id, "al-taqwa"),
                organizationId: altaqwa.id,
                dateOfRegistration: new Date("2024-01-05"),
                membershipType: client_1.MembershipType.NonResident,
                membershipStatus: "Active",
                hodPersonId: atHod3.id,
                houseOwnership: false,
                toiletFacility: true,
                electricity: true,
                paymentPeriod: client_1.PaymentPeriod.Monthly,
                membershipFee: new library_1.Decimal(400),
                additionalVoluntaryContributions: new library_1.Decimal(0),
                membershipFeeDiscount: new library_1.Decimal(0),
                totalContribution: new library_1.Decimal(400),
            },
        });
        console.log("✓ Al-Taqwa membership 3: Salman Umar (Individual)");
    }
    console.log("\n── Seed complete ──────────────────────────────────────────────");
    console.log("Al-Noor Mosque   → admin@alnoor.com / admin123 | user@alnoor.com / user1234");
    console.log("Al-Taqwa Mosque  → admin@altaqwa.com / admin123 | user@altaqwa.com / user1234");
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
