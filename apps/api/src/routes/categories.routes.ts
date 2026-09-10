import { Router } from "express";
import { prisma } from "../lib/db";
import { requireAuth, requireAction } from "../middleware/auth.middleware";
import { recordAudit } from "../services/audit.service";

const router = Router();

router.use(requireAuth);

router.get("/", async (_req, res) => {
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
  });

  res.json(categories);
});

router.post("/", requireAction("manageMasterData"), async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";

  if (!name) {
    res.status(400).json({ error: "Name is required" });
    return;
  }

  const existing = await prisma.category.findUnique({ where: { name } });
  if (existing) {
    res.status(409).json({ error: "A category with this name already exists" });
    return;
  }

  const category = await prisma.category.create({ data: { name } });

  await recordAudit({
    actorId: req.session!.userId,
    action: "category.create",
    entityType: "Category",
    entityId: category.id,
    after: { id: category.id, name: category.name },
  });

  res.status(201).json(category);
});

export default router;
