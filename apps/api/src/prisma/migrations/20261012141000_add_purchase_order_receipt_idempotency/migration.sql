-- Additive migration for durable duplicate-receipt protection.
CREATE TABLE "PurchaseOrderReceiptIdempotencyKey" (
    "id" SERIAL NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "operation" VARCHAR(100) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "actorId" INTEGER NOT NULL,
    "purchaseOrderId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderReceiptIdempotencyKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseOrderReceiptIdempotencyKey_actorId_operation_key_key"
ON "PurchaseOrderReceiptIdempotencyKey"("actorId", "operation", "key");

CREATE INDEX "PurchaseOrderReceiptIdempotencyKey_purchaseOrderId_idx"
ON "PurchaseOrderReceiptIdempotencyKey"("purchaseOrderId");

CREATE INDEX "PurchaseOrderReceiptIdempotencyKey_createdAt_idx"
ON "PurchaseOrderReceiptIdempotencyKey"("createdAt");

ALTER TABLE "PurchaseOrderReceiptIdempotencyKey"
ADD CONSTRAINT "PurchaseOrderReceiptIdempotencyKey_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrderReceiptIdempotencyKey"
ADD CONSTRAINT "PurchaseOrderReceiptIdempotencyKey_purchaseOrderId_fkey"
FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
