import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import { recordAudit } from "../services/audit.service";
import {
  getOrganization,
  updateOrganization,
  type OrganizationInput,
} from "../services/organization.service";

const router = Router();

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function organizationSnapshot(org: {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  currency: string;
}) {
  return {
    name: org.name,
    address: org.address,
    phone: org.phone,
    email: org.email,
    logoUrl: org.logoUrl,
    currency: org.currency,
  };
}

router.use(requireAuth);

router.get("/", async (_req, res) => {
  const organization = await getOrganization();
  res.json(organization);
});

router.patch("/", requireRole("ADMIN"), async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "Name is required" });
    return;
  }

  const currency =
    typeof req.body?.currency === "string" && req.body.currency.trim()
      ? req.body.currency.trim().toUpperCase()
      : "INR";
  if (!CURRENCY_PATTERN.test(currency)) {
    res.status(400).json({ error: "Currency must be a 3-letter code (e.g. INR, USD)" });
    return;
  }

  const email = optionalString(req.body?.email);
  if (email && !email.includes("@")) {
    res.status(400).json({ error: "Invalid email address" });
    return;
  }

  const before = await getOrganization();

  const input: OrganizationInput = {
    name,
    address: optionalString(req.body?.address),
    phone: optionalString(req.body?.phone),
    email,
    logoUrl: optionalString(req.body?.logoUrl),
    currency,
  };

  const organization = await updateOrganization(input);

  await recordAudit({
    actorId: req.session!.userId,
    action: "organization.update",
    entityType: "Organization",
    entityId: organization.id,
    before: organizationSnapshot(before),
    after: organizationSnapshot(organization),
  });

  res.json(organization);
});

export default router;
