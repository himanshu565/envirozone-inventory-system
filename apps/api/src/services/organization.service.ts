import { prisma } from "../lib/db";

const SINGLETON_ID = 1;

export type OrganizationInput = {
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  logoUrl?: string | null;
  currency?: string;
};

export async function getOrganization() {
  return prisma.organization.upsert({
    where: { id: SINGLETON_ID },
    update: {},
    create: { id: SINGLETON_ID, name: "Envirozone" },
  });
}

export async function updateOrganization(data: OrganizationInput) {
  return prisma.organization.upsert({
    where: { id: SINGLETON_ID },
    update: data,
    create: { id: SINGLETON_ID, ...data },
  });
}
