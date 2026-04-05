const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const newEmail = "admin@civica.lk"; // change this
  const newPassword = `_&P[}gc?}&5"a*gA4O<RZ0rd^d<0Haw~pl` // change this
  const role = "super_user"; // super_user | admin | user
  // const organizationSlug = "al-noor"; // required for admin/user, ignored for super_user
  const phoneNumber = null; // optional
  const locale = "en"; // optional

  const normalizedEmail = newEmail.trim().toLowerCase();
  if (!normalizedEmail) throw new Error("Email is required");
  if (!newPassword.trim()) throw new Error("Password is required");
  if (!["super_user", "admin", "user"].includes(role)) {
    throw new Error(`Invalid role: ${role}`);
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, email: true },
  });
  if (existingUser) {
    throw new Error(`User already exists: ${existingUser.email}`);
  }

  let organizationId = null;
  if (role !== "super_user") {
    if (!organizationSlug?.trim()) {
      throw new Error("organizationSlug is required for admin/user");
    }

    const organization = await prisma.organization.findUnique({
      where: { slug: organizationSlug.trim() },
      select: { id: true, name: true, slug: true },
    });

    if (!organization) {
      throw new Error(`Organization not found for slug: ${organizationSlug}`);
    }

    organizationId = organization.id;
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);

  const created = await prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash,
      role,
      organizationId,
      phoneNumber,
      locale,
    },
    select: {
      id: true,
      email: true,
      role: true,
      organizationId: true,
    },
  });

  console.log("User created:");
  console.log(created);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
