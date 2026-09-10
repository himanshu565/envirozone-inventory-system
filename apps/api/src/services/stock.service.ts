import { prisma } from "../lib/db";

export async function getCurrentStockByItemIds(
  itemIds: number[]
): Promise<Map<number, number>> {
  const stock = new Map<number, number>();
  for (const id of itemIds) stock.set(id, 0);

  if (itemIds.length === 0) return stock;

  const grouped = await prisma.stockTransaction.groupBy({
    by: ["itemId", "type"],
    where: { itemId: { in: itemIds } },
    _sum: { quantity: true },
  });

  for (const row of grouped) {
    const sum = row._sum.quantity ?? 0;
    // INWARD and OUTWARD quantities are always entered positive, so the type
    // decides the sign. ADJUSTMENT quantities carry their own sign (a
    // negative adjustment corrects stock down, a positive one corrects it up).
    const delta = row.type === "INWARD" ? sum : row.type === "OUTWARD" ? -sum : sum;
    stock.set(row.itemId, (stock.get(row.itemId) ?? 0) + delta);
  }

  return stock;
}

export type CategoryStockSummary = {
  categoryId: number;
  categoryName: string;
  itemCount: number;
  totalStock: number;
};

export async function getCategoryStockSummary(): Promise<CategoryStockSummary[]> {
  const items = await prisma.item.findMany({
    select: { id: true, categoryId: true, category: { select: { name: true } } },
  });

  const stockByItem = await getCurrentStockByItemIds(items.map((item) => item.id));

  const byCategory = new Map<number, CategoryStockSummary>();
  for (const item of items) {
    const existing = byCategory.get(item.categoryId) ?? {
      categoryId: item.categoryId,
      categoryName: item.category.name,
      itemCount: 0,
      totalStock: 0,
    };
    existing.itemCount += 1;
    existing.totalStock += stockByItem.get(item.id) ?? 0;
    byCategory.set(item.categoryId, existing);
  }

  return Array.from(byCategory.values()).sort((a, b) =>
    a.categoryName.localeCompare(b.categoryName)
  );
}
