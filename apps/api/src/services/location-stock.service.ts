import { Prisma } from "@prisma/client";
import type { StockMovementType } from "./stock-ledger";
import { InsufficientStockError } from "./stock-ledger";

type TransactionClient = Prisma.TransactionClient;

type LocationChange = {
  locationId: number;
  delta: number;
};

/**
 * Locks all affected balance rows in ascending location order. Upserting first
 * makes the row lockable even when a location has not received this item yet.
 */
export async function applyLocationStockChanges(
  tx: TransactionClient,
  itemId: number,
  changes: LocationChange[]
): Promise<void> {
  const combined = new Map<number, number>();
  for (const change of changes) {
    combined.set(
      change.locationId,
      (combined.get(change.locationId) ?? 0) + change.delta
    );
  }

  const locationIds = [...combined.keys()].sort((a, b) => a - b);
  const balances = new Map<number, number>();
  for (const locationId of locationIds) {
    await tx.locationStockBalance.upsert({
      where: { itemId_locationId: { itemId, locationId } },
      create: { itemId, locationId, quantity: 0 },
      update: {},
    });
    const rows = await tx.$queryRaw<Array<{ quantity: number }>>`
      SELECT "quantity"
      FROM "LocationStockBalance"
      WHERE "itemId" = ${itemId} AND "locationId" = ${locationId}
      FOR UPDATE
    `;
    balances.set(locationId, rows[0]?.quantity ?? 0);
  }

  for (const locationId of locationIds) {
    const delta = combined.get(locationId) ?? 0;
    const current = balances.get(locationId) ?? 0;
    if (delta < 0 && current + delta < 0) {
      throw new InsufficientStockError(current, delta);
    }
  }

  for (const locationId of locationIds) {
    await tx.locationStockBalance.update({
      where: { itemId_locationId: { itemId, locationId } },
      data: { quantity: { increment: combined.get(locationId) ?? 0 } },
    });
  }
}

export function getLocationChanges(
  type: StockMovementType,
  quantity: number,
  fromLocationId: number | null,
  toLocationId: number | null
): LocationChange[] {
  if (type === "TRANSFER") {
    if (fromLocationId === null || toLocationId === null) {
      throw new Error("Transfers require both source and destination locations");
    }
    if (fromLocationId === toLocationId) {
      throw new Error("Transfer source and destination must be different");
    }
    return [
      { locationId: fromLocationId, delta: -quantity },
      { locationId: toLocationId, delta: quantity },
    ];
  }

  if (type === "INWARD" && toLocationId !== null) {
    return [{ locationId: toLocationId, delta: quantity }];
  }
  if (type === "OUTWARD" && fromLocationId !== null) {
    return [{ locationId: fromLocationId, delta: -quantity }];
  }
  if (type === "ADJUSTMENT" && toLocationId !== null) {
    return [{ locationId: toLocationId, delta: quantity }];
  }
  return [];
}
