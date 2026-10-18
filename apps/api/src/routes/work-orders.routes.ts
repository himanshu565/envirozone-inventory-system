import { Router } from "express";
import { Prisma, type WorkOrderPriority, type WorkOrderStatus, type WorkOrderType } from "@prisma/client";
import { prisma } from "../lib/db";
import { requireAuth, requireAction } from "../middleware/auth.middleware";
import {
  parseListQuery,
  toPaginationMeta,
  toPrismaOrderBy,
  toPrismaPagination,
} from "../lib/list-query";
import { recordAudit } from "../services/audit.service";
import {
  assertStockChangeAllowed,
  calculateCurrentStock,
  getSignedStockDelta,
  InsufficientStockError,
  validateStockQuantity,
} from "../services/stock-ledger";
import { applyLocationStockChanges } from "../services/location-stock.service";

const router = Router();
router.use(requireAuth);

const ALLOWED_SORT_FIELDS = ["woNumber", "createdAt", "dueDate", "priority", "status"];

const WORK_ORDER_INCLUDE = {
  asset: {
    select: {
      id: true,
      assetTag: true,
      serialNumber: true,
      status: true,
      item: { select: { id: true, name: true, itemCode: true } },
    },
  },
  location: { select: { id: true, name: true, type: true } },
  requester: { select: { id: true, name: true, email: true } },
  assignee: { select: { id: true, name: true, email: true } },
  parts: {
    include: {
      item: { select: { id: true, itemCode: true, name: true, unit: true } },
      location: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.WorkOrderInclude;

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function optionalDate(value: unknown): Date | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

// GET /api/work-orders - List work orders
router.get("/", async (req, res) => {
  const query = parseListQuery(
    new URLSearchParams(req.query as Record<string, string>)
  );
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const priority = typeof req.query.priority === "string" ? req.query.priority : undefined;
  const assigneeId = req.query.assigneeId ? Number(req.query.assigneeId) : undefined;

  const where: Prisma.WorkOrderWhereInput = {
    ...(status ? { status: status as WorkOrderStatus } : {}),
    ...(priority ? { priority: priority as WorkOrderPriority } : {}),
    ...(assigneeId && Number.isInteger(assigneeId) ? { assigneeId } : {}),
    ...(query.search
      ? {
          OR: [
            { woNumber: { contains: query.search, mode: "insensitive" } },
            { title: { contains: query.search, mode: "insensitive" } },
            { description: { contains: query.search, mode: "insensitive" } },
            { asset: { assetTag: { contains: query.search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [orders, total] = await Promise.all([
    prisma.workOrder.findMany({
      where,
      include: WORK_ORDER_INCLUDE,
      ...toPrismaPagination(query),
      orderBy: toPrismaOrderBy(query, ALLOWED_SORT_FIELDS, "createdAt"),
    }),
    prisma.workOrder.count({ where }),
  ]);

  res.json({ data: orders, pagination: toPaginationMeta(query, total) });
});

// GET /api/work-orders/:id - Get detail
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid work order id" });
    return;
  }

  const order = await prisma.workOrder.findUnique({
    where: { id },
    include: WORK_ORDER_INCLUDE,
  });

  if (!order) {
    res.status(404).json({ error: "Work order not found" });
    return;
  }

  res.json(order);
});

// POST /api/work-orders - Create work order
router.post("/", requireAction("manageWorkOrders"), async (req, res) => {
  const title = optionalString(req.body?.title);
  const description = optionalString(req.body?.description);
  const priority = (req.body?.priority ?? "MEDIUM") as WorkOrderPriority;
  const type = (req.body?.type ?? "CORRECTIVE") as WorkOrderType;
  const dueDate = optionalDate(req.body?.dueDate);
  const assetId = req.body?.assetId ? Number(req.body.assetId) : null;
  const locationId = req.body?.locationId ? Number(req.body.locationId) : null;
  const assigneeId = req.body?.assigneeId ? Number(req.body.assigneeId) : null;

  if (!title) {
    res.status(400).json({ error: "Title is required" });
    return;
  }
  if (dueDate === undefined) {
    res.status(400).json({ error: "Invalid due date format" });
    return;
  }

  // Generate human-readable WO number: WO-YYYYMMDD-XXXX
  const today = new Date();
  const datePrefix = `WO-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const countToday = await prisma.workOrder.count({
    where: { woNumber: { startsWith: datePrefix } },
  });
  const woNumber = `${datePrefix}-${String(countToday + 1).padStart(3, "0")}`;

  const created = await prisma.$transaction(async (tx) => {
    const wo = await tx.workOrder.create({
      data: {
        woNumber,
        title,
        description,
        priority,
        type,
        status: assigneeId ? "ASSIGNED" : "OPEN",
        dueDate,
        assetId,
        locationId,
        assigneeId,
        requesterId: req.session!.userId,
      },
      include: WORK_ORDER_INCLUDE,
    });

    await recordAudit(
      {
        actorId: req.session!.userId,
        action: "work_order.create",
        entityType: "WorkOrder",
        entityId: wo.id,
        after: { id: wo.id, woNumber: wo.woNumber, title: wo.title, status: wo.status },
      },
      tx
    );

    return wo;
  });

  res.status(201).json(created);
});

// PATCH /api/work-orders/:id/status - Update work order status
router.patch("/:id/status", requireAction("manageWorkOrders"), async (req, res) => {
  const id = Number(req.params.id);
  const nextStatus = req.body?.status as WorkOrderStatus;
  const resolution = optionalString(req.body?.resolution);

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid work order id" });
    return;
  }
  if (!["OPEN", "ASSIGNED", "IN_PROGRESS", "WAITING_FOR_PARTS", "COMPLETED", "CANCELLED"].includes(nextStatus)) {
    res.status(400).json({ error: "Invalid work order status" });
    return;
  }

  const existing = await prisma.workOrder.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: "Work order not found" });
    return;
  }

  const updateData: Prisma.WorkOrderUpdateInput = { status: nextStatus };
  if (nextStatus === "IN_PROGRESS" && !existing.startedAt) {
    updateData.startedAt = new Date();
  }
  if (nextStatus === "COMPLETED") {
    updateData.completedAt = new Date();
    if (resolution) updateData.resolution = resolution;
  }
  if (nextStatus === "CANCELLED" && resolution) {
    updateData.resolution = resolution;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const wo = await tx.workOrder.update({
      where: { id },
      data: updateData,
      include: WORK_ORDER_INCLUDE,
    });

    await recordAudit(
      {
        actorId: req.session!.userId,
        action: "work_order.status_change",
        entityType: "WorkOrder",
        entityId: id,
        before: { status: existing.status },
        after: { status: nextStatus, resolution },
      },
      tx
    );

    return wo;
  });

  res.json(updated);
});

// POST /api/work-orders/:id/parts - Consume spare parts atomically
router.post("/:id/parts", requireAction("manageStock"), async (req, res) => {
  const id = Number(req.params.id);
  const itemId = Number(req.body?.itemId);
  const locationId = req.body?.locationId ? Number(req.body.locationId) : null;
  const quantity = Number(req.body?.quantity);

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid work order id" });
    return;
  }
  if (!Number.isInteger(itemId)) {
    res.status(400).json({ error: "Valid item is required" });
    return;
  }
  if (locationId !== null && !Number.isInteger(locationId)) {
    res.status(400).json({ error: "Location must be an integer if provided" });
    return;
  }

  try {
    validateStockQuantity("OUTWARD", quantity);
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  const workOrder = await prisma.workOrder.findUnique({ where: { id } });
  if (!workOrder) {
    res.status(404).json({ error: "Work order not found" });
    return;
  }
  if (workOrder.status === "COMPLETED" || workOrder.status === "CANCELLED") {
    res.status(400).json({ error: "Cannot add parts to a completed or cancelled work order" });
    return;
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        // 1. Verify global ledger stock
        const stockTotals = await tx.stockTransaction.groupBy({
          by: ["type"],
          where: { itemId },
          _sum: { quantity: true },
        });
        const currentStock = calculateCurrentStock(stockTotals);
        assertStockChangeAllowed(currentStock, "OUTWARD", quantity);

        // 2. Decrement location balance if location is specified
        if (locationId !== null) {
          await applyLocationStockChanges(tx, itemId, [
            { locationId, delta: -quantity },
          ]);
        }

        // 3. Create stock movement row
        const stockTx = await tx.stockTransaction.create({
          data: {
            type: "OUTWARD",
            quantity,
            itemId,
            fromLocationId: locationId,
            referenceNumber: workOrder.woNumber,
            remarks: `Parts consumed for Work Order ${workOrder.woNumber}: ${workOrder.title}`,
            createdById: req.session!.userId,
          },
        });

        // 4. Record work order part line
        const part = await tx.workOrderPart.create({
          data: {
            workOrderId: id,
            itemId,
            locationId,
            quantity,
            stockTransactionId: stockTx.id,
          },
          include: {
            item: { select: { id: true, itemCode: true, name: true, unit: true } },
            location: { select: { id: true, name: true } },
          },
        });

        // 5. Audit record
        await recordAudit(
          {
            actorId: req.session!.userId,
            action: "work_order.part_consumed",
            entityType: "WorkOrderPart",
            entityId: part.id,
            after: {
              workOrderId: id,
              itemId,
              quantity,
              locationId,
              stockTransactionId: stockTx.id,
            },
          },
          tx
        );

        return part;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    res.status(201).json(result);
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      res.status(409).json({ error: error.message });
      return;
    }
    const isSerializationConflict =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
    if (isSerializationConflict) {
      res.status(409).json({ error: "Stock changed concurrently. Please retry." });
      return;
    }
    throw error;
  }
});

export default router;
