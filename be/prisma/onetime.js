const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const newEmail = "admin@civica.lk";  // change this
  const newPassword = `_&P[}gc?}&5"a*gA4O<RZ0rd^d<0Haw~pl`;   // change this

  const hash = await bcrypt.hash(newPassword, 10);

  // Find current super user
  const superUser = await prisma.user.findFirst({
    where: { role: "super_user" },
  });

  if (!superUser) {
    console.log("No super user found!");
    return;
  }

  await prisma.user.update({
    where: { id: superUser.id },
    data: {
      email: newEmail.toLowerCase(),
      passwordHash: hash,
    },
  });

  console.log(`Super user updated: ${newEmail}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());