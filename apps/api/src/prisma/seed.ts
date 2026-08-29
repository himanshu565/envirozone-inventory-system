import "dotenv/config";
import { prisma } from "../lib/db";
import { hashPassword } from "../lib/password";

async function main() {
  const email = process.env.ADMIN_EMAIL ?? "admin@envirozone.local";
  const password = process.env.ADMIN_PASSWORD ?? "ChangeMe123!";
  const name = process.env.ADMIN_NAME ?? "Admin";

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin user already exists: ${email}`);
    return;
  }

  const passwordHash = await hashPassword(password);
  const admin = await prisma.user.create({
    data: { name, email, password: passwordHash, role: "ADMIN" },
  });

  console.log(`Created admin user: ${admin.email} (password: ${password})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
