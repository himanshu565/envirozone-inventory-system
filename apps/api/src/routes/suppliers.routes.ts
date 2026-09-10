import { Router } from "express";
import { prisma } from "../lib/db";
import { requireAuth, requireAction } from "../middleware/auth.middleware";
import { recordAudit } from "../services/audit.service";

const router = Router();

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function supplierSnapshot(supplier: {
  id: number;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  isActive: boolean;
}) {
  return {
    id: supplier.id,
    name: supplier.name,
    contactPerson: supplier.contactPerson,
    phone: supplier.phone,
    email: supplier.email,
    address: supplier.address,
    isActive: supplier.isActive,
  };
}

router.use(requireAuth);

router.get("/", async (_req, res) => {
  const suppliers = await prisma.supplier.findMany({ orderBy: { name: "asc" } });
  res.json(suppliers);
});

router.post("/", requireAction("manageMasterData"), async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "Name is required" });
    return;
  }

  const existing = await prisma.supplier.findUnique({ where: { name } });
  if (existing) {
    res.status(409).json({ error: "A supplier with this name already exists" });
    return;
  }

  const supplier = await prisma.supplier.create({
    data: {
      name,
      contactPerson: optionalString(req.body?.contactPerson),
      phone: optionalString(req.body?.phone),
      email: optionalString(req.body?.email),
      address: optionalString(req.body?.address),
    },
  });

  await recordAudit({
    actorId: req.session!.userId,
    action: "supplier.create",
    entityType: "Supplier",
    entityId: supplier.id,
    after: supplierSnapshot(supplier),
  });

  res.status(201).json(supplier);
});

router.patch("/:id", requireAction("manageMasterData"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid supplier id" });
    return;
  }

  const before = await prisma.supplier.findUnique({ where: { id } });
  if (!before) {
    res.status(404).json({ error: "Supplier not found" });
    return;
  }

  const data: {
    name?: string;
    contactPerson?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    isActive?: boolean;
  } = {};

  if (typeof req.body?.name === "string" && req.body.name.trim()) {
    data.name = req.body.name.trim();
  }
  if (req.body?.contactPerson !== undefined) {
    data.contactPerson = optionalString(req.body.contactPerson);
  }
  if (req.body?.phone !== undefined) {
    data.phone = optionalString(req.body.phone);
  }
  if (req.body?.email !== undefined) {
    data.email = optionalString(req.body.email);
  }
  if (req.body?.address !== undefined) {
    data.address = optionalString(req.body.address);
  }
  if (typeof req.body?.isActive === "boolean") {
    data.isActive = req.body.isActive;
  }

  const supplier = await prisma.supplier.update({ where: { id }, data });

  await recordAudit({
    actorId: req.session!.userId,
    action: "supplier.update",
    entityType: "Supplier",
    entityId: supplier.id,
    before: supplierSnapshot(before),
    after: supplierSnapshot(supplier),
  });

  res.json(supplier);
});

export default router;
