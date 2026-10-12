-- Additive migration: existing stock transactions and requests without an
-- Idempotency-Key are unchanged. No backfill is required.
CREATE TABLE "StockTransactionIdempotencyKey" (
    "id" SERIAL NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "operation" VARCHAR(100) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "actorId" INTEGER NOT NULL,
    "stockTransactionId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTransactionIdempotencyKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StockTransactionIdempotencyKey_stockTransactionId_key"
ON "StockTransactionIdempotencyKey"("stockTransactionId");

CREATE UNIQUE INDEX "StockTransactionIdempotencyKey_actorId_operation_key_key"
ON "StockTransactionIdempotencyKey"("actorId", "operation", "key");

CREATE INDEX "StockTransactionIdempotencyKey_createdAt_idx"
ON "StockTransactionIdempotencyKey"("createdAt");

ALTER TABLE "StockTransactionIdempotencyKey"
ADD CONSTRAINT "StockTransactionIdempotencyKey_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockTransactionIdempotencyKey"
ADD CONSTRAINT "StockTransactionIdempotencyKey_stockTransactionId_fkey"
FOREIGN KEY ("stockTransactionId") REFERENCES "StockTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
