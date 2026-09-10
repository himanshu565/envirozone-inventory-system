import { Router } from "express";
import type { LocationType } from "@prisma/client";
import { prisma } from "../lib/db";
import { requireAuth, requireAction } from "../middleware/auth.middleware";
import { recordAudit } from "../services/audit.service";

const router = Router();

const LOCATION_TYPES: LocationType[] = ["OFFICE", "WAREHOUSE", "SITE", "OTHER"];

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function locationSnapshot(location: {
  id: number;
  name: string;
  type: LocationType;
  address: string | null;
  isActive: boolean;
}) {
  return {
    id: location.id,
    name: location.name,
    type: location.type,
    address: location.address,
    isActive: location.isActive,
  };
}

router.use(requireAuth);

router.get("/", async (_req, res) => {
  const locations = await prisma.location.findMany({ orderBy: { name: "asc" } });
  res.json(locations);
});

router.post("/", requireAction("manageMasterData"), async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "Name is required" });
    return;
  }

  const type =
    typeof req.body?.type === "string" && req.body.type ? req.body.type : "OFFICE";
  if (!LOCATION_TYPES.includes(type as LocationType)) {
    res.status(400).json({ error: `Type must be one of: ${LOCATION_TYPES.join(", ")}` });
    return;
  }

  const existing = await prisma.location.findUnique({ where: { name } });
  if (existing) {
    res.status(409).json({ error: "A location with this name already exists" });
    return;
  }

  const location = await prisma.location.create({
    data: {
      name,
      type: type as LocationType,
      address: optionalString(req.body?.address),
    },
  });

  await recordAudit({
    actorId: req.session!.userId,
    action: "location.create",
    entityType: "Location",
    entityId: location.id,
    after: locationSnapshot(location),
  });

  res.status(201).json(location);
});

router.patch("/:id", requireAction("manageMasterData"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid location id" });
    return;
  }

  const before = await prisma.location.findUnique({ where: { id } });
  if (!before) {
    res.status(404).json({ error: "Location not found" });
    return;
  }

  const data: {
    name?: string;
    type?: LocationType;
    address?: string | null;
    isActive?: boolean;
  } = {};

  if (typeof req.body?.name === "string" && req.body.name.trim()) {
    data.name = req.body.name.trim();
  }
  if (req.body?.type !== undefined) {
    if (!LOCATION_TYPES.includes(req.body.type as LocationType)) {
      res.status(400).json({ error: `Type must be one of: ${LOCATION_TYPES.join(", ")}` });
      return;
    }
    data.type = req.body.type as LocationType;
  }
  if (req.body?.address !== undefined) {
    data.address = optionalString(req.body.address);
  }
  if (typeof req.body?.isActive === "boolean") {
    data.isActive = req.body.isActive;
  }

  const location = await prisma.location.update({ where: { id }, data });

  await recordAudit({
    actorId: req.session!.userId,
    action: "location.update",
    entityType: "Location",
    entityId: location.id,
    before: locationSnapshot(before),
    after: locationSnapshot(location),
  });

  res.json(location);
});

export default router;
