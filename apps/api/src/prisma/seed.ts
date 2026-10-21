import "dotenv/config";
import { prisma } from "../lib/db";
import { hashPassword } from "../lib/password";

async function main() {
  if (process.env.NODE_ENV === "production") {
    if (process.env.ALLOW_PRODUCTION_SEED !== "YES") {
      throw new Error(
        "Refusing to run seed in production without ALLOW_PRODUCTION_SEED=YES"
      );
    }
    if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
      throw new Error(
        "Production seeding requires explicit ADMIN_EMAIL and ADMIN_PASSWORD"
      );
    }
  }

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

  console.log(`Created admin user: ${admin.email}`);
  console.log("Store the configured ADMIN_PASSWORD securely; it is not printed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
