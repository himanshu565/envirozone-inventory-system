import "dotenv/config";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";

type Allocation = { itemId: number; locationId: number; delta: number };

function getAllocation(transaction: {
  type: "INWARD" | "OUTWARD" | "ADJUSTMENT" | "TRANSFER";
  quantity: number;
  itemId: number;
  fromLocationId: number | null;
  toLocationId: number | null;
}): Allocation[] | null {
  const {
    type,
    quantity,
    itemId,
    fromLocationId: from,
    toLocationId: to,
  } = transaction;

  if (type === "INWARD" && to !== null && from === null) {
    return [{ itemId, locationId: to, delta: quantity }];
  }
  if (type === "OUTWARD" && from !== null && to === null) {
    return [{ itemId, locationId: from, delta: -quantity }];
  }
  if (type === "ADJUSTMENT") {
    if (from !== null && to !== null && from !== to) return null;
    const target = to ?? from;
    if (target !== null) {
      return [{ itemId, locationId: target, delta: quantity }];
    }
  }
  if (type === "TRANSFER" && from !== null && to !== null && from !== to) {
    return [
      { itemId, locationId: from, delta: -quantity },
      { itemId, locationId: to, delta: quantity },
    ];
  }
  return null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (apply && process.env.LOCATION_BACKFILL_ALLOW_APPLY !== "YES") {
    throw new Error(
      "Refusing to apply location backfill. Set LOCATION_BACKFILL_ALLOW_APPLY=YES after backup and restore review."
    );
  }

  const transactions = await prisma.stockTransaction.findMany({
  orderBy: [{ itemId: "asc" }, { id: "asc" }],
  select: {
    id: true,
    type: true,
    quantity: true,
    itemId: true,
    fromLocationId: true,
    toLocationId: true,
  },
  });

const balances = new Map<string, number>();
const skipped: number[] = [];
const negative: { itemId: number; locationId: number; transactionId: number }[] = [];

for (const transaction of transactions) {
  const allocations = getAllocation(transaction);
  if (!allocations) {
    skipped.push(transaction.id);
    continue;
  }
  for (const allocation of allocations) {
    const key = `${allocation.itemId}:${allocation.locationId}`;
    const next = (balances.get(key) ?? 0) + allocation.delta;
    if (next < 0) {
      negative.push({
        itemId: allocation.itemId,
        locationId: allocation.locationId,
        transactionId: transaction.id,
      });
    }
    balances.set(key, next);
  }
}

  console.log(
  JSON.stringify(
    {
      mode: apply ? "apply" : "dry-run",
      transactions: transactions.length,
      candidateBalances: balances.size,
      skippedTransactions: skipped.length,
      negativeCandidates: negative.length,
      skippedTransactionIds: skipped,
      negative,
    },
    null,
    2
  )
  );

  if (!apply || skipped.length > 0 || negative.length > 0) {
    await prisma.$disconnect();
    process.exit(negative.length > 0 ? 2 : 0);
  }

  const existingBalanceCount = await prisma.locationStockBalance.count();
  if (existingBalanceCount > 0) {
    throw new Error(
      "Location balances already exist; refusing to apply a non-idempotent historical backfill."
    );
  }

  await prisma.$transaction(
  async (tx) => {
    for (const [key, quantity] of balances) {
      const [itemId, locationId] = key.split(":").map(Number);
      await tx.locationStockBalance.create({
        data: { itemId, locationId, quantity },
      });
    }
  },
  { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : "Location backfill failed");
  await prisma.$disconnect();
  process.exit(1);
});
