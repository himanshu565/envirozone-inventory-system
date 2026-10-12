-- Additive serialized-asset lifecycle foundation.
CREATE TYPE "TrackingMode" AS ENUM ('QUANTITY', 'SERIALIZED');
CREATE TYPE "AssetStatus" AS ENUM (
    'IN_STOCK',
    'DEPLOYED',
    'UNDER_MAINTENANCE',
    'IN_CALIBRATION',
    'QUARANTINED',
    'RETIRED',
    'LOST'
);

ALTER TABLE "Item"
ADD COLUMN "trackingMode" "TrackingMode" NOT NULL DEFAULT 'QUANTITY';

CREATE TABLE "SerializedAsset" (
    "id" SERIAL NOT NULL,
    "assetTag" TEXT NOT NULL,
    "serialNumber" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'IN_STOCK',
    "purchaseDate" TIMESTAMP(3),
    "warrantyExpires" TIMESTAMP(3),
    "notes" TEXT,
    "itemId" INTEGER NOT NULL,
    "currentLocationId" INTEGER,
    "assignedUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SerializedAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SerializedAsset_assetTag_key" ON "SerializedAsset"("assetTag");
CREATE UNIQUE INDEX "SerializedAsset_serialNumber_key" ON "SerializedAsset"("serialNumber");
CREATE INDEX "SerializedAsset_itemId_idx" ON "SerializedAsset"("itemId");
CREATE INDEX "SerializedAsset_currentLocationId_idx" ON "SerializedAsset"("currentLocationId");
CREATE INDEX "SerializedAsset_status_idx" ON "SerializedAsset"("status");

ALTER TABLE "SerializedAsset"
ADD CONSTRAINT "SerializedAsset_itemId_fkey"
FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SerializedAsset"
ADD CONSTRAINT "SerializedAsset_currentLocationId_fkey"
FOREIGN KEY ("currentLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SerializedAsset"
ADD CONSTRAINT "SerializedAsset_assignedUserId_fkey"
FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
