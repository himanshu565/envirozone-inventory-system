-- Additive location balances. Existing ledger rows are intentionally not backfilled
-- by this migration because rows with null locations are not attributable safely.
CREATE TYPE "TransactionType_new" AS ENUM ('INWARD', 'OUTWARD', 'ADJUSTMENT', 'TRANSFER');

ALTER TABLE "StockTransaction"
  ALTER COLUMN "type" TYPE "TransactionType_new"
  USING ("type"::text::"TransactionType_new");

DROP TYPE "TransactionType";
ALTER TYPE "TransactionType_new" RENAME TO "TransactionType";

CREATE TABLE "LocationStockBalance" (
  "id" SERIAL NOT NULL,
  "itemId" INTEGER NOT NULL,
  "locationId" INTEGER NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LocationStockBalance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LocationStockBalance_itemId_locationId_key"
  ON "LocationStockBalance"("itemId", "locationId");
CREATE INDEX "LocationStockBalance_locationId_idx"
  ON "LocationStockBalance"("locationId");

ALTER TABLE "LocationStockBalance"
  ADD CONSTRAINT "LocationStockBalance_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LocationStockBalance"
  ADD CONSTRAINT "LocationStockBalance_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
