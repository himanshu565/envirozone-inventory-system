import { Router } from "express";
import { prisma } from "../lib/db";
import { requireAuth } from "../middleware/auth.middleware";
import { getCurrentStockByItemIds } from "../services/stock.service";

const router = Router();
router.use(requireAuth);

// GET /api/notifications - List user's notifications
router.get("/", async (req, res) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.session!.userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const unreadCount = await prisma.notification.count({
    where: { userId: req.session!.userId, read: false },
  });

  res.json({ notifications, unreadCount });
});

// PATCH /api/notifications/:id/read - Mark notification as read
router.patch("/:id/read", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid notification id" });
    return;
  }

  const notification = await prisma.notification.findFirst({
    where: { id, userId: req.session!.userId },
  });
  if (!notification) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }

  const updated = await prisma.notification.update({
    where: { id },
    data: { read: true },
  });

  res.json(updated);
});

// POST /api/notifications/scan - Scans conditions (low stock, calibration due) and generates notifications
router.post("/scan", async (req, res) => {
  const userId = req.session!.userId;

  // 1. Scan for low stock
  const items = await prisma.item.findMany({
    select: { id: true, name: true, itemCode: true, minimumStock: true },
  });
  const stockMap = await getCurrentStockByItemIds(items.map((i) => i.id));
  const lowStockItems = items.filter(
    (item) => (stockMap.get(item.id) ?? 0) <= item.minimumStock
  );

  // 2. Scan for calibrations due within 30 days or overdue
  const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const dueCalibrations = await prisma.calibrationRecord.findMany({
    where: {
      nextDueDate: { lte: thirtyDaysFromNow },
      asset: { status: { notIn: ["RETIRED", "LOST"] } },
    },
    include: { asset: { select: { assetTag: true } } },
    take: 20,
  });

  let createdCount = 0;

  for (const item of lowStockItems) {
    const existing = await prisma.notification.findFirst({
      where: {
        userId,
        type: "LOW_STOCK",
        link: `/inventory?search=${encodeURIComponent(item.itemCode)}`,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // 24h dedupe
      },
    });

    if (!existing) {
      const current = stockMap.get(item.id) ?? 0;
      await prisma.notification.create({
        data: {
          userId,
          type: "LOW_STOCK",
          title: `Low Stock Alert: ${item.name}`,
          message: `Item ${item.itemCode} is at ${current} units (minimum threshold: ${item.minimumStock}).`,
          link: `/inventory?search=${encodeURIComponent(item.itemCode)}`,
        },
      });
      createdCount++;
    }
  }

  for (const cal of dueCalibrations) {
    const isOverdue = new Date(cal.nextDueDate) < new Date();
    const existing = await prisma.notification.findFirst({
      where: {
        userId,
        type: "CALIBRATION_DUE",
        link: `/calibrations`,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });

    if (!existing) {
      await prisma.notification.create({
        data: {
          userId,
          type: "CALIBRATION_DUE",
          title: isOverdue ? `Overdue Calibration: ${cal.asset.assetTag}` : `Calibration Due Soon: ${cal.asset.assetTag}`,
          message: `Asset ${cal.asset.assetTag} calibration is ${isOverdue ? "overdue" : "due on"} ${new Date(cal.nextDueDate).toLocaleDateString()}.`,
          link: `/calibrations`,
        },
      });
      createdCount++;
    }
  }

  res.json({ message: "Scan complete", createdCount });
});

export default router;

