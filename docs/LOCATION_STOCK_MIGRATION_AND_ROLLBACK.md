# Location-Aware Stock Model: Balance Semantics, Migration & Rollback Guide

## 1. Exact Balance Semantics

The location-aware stock model operates on the principle that physical stock is distributed across locations while the organization-wide total is derived or conserved:

| Movement Type | Location Balance Impact | Organization Total Impact | Invariant Guards |
| :--- | :--- | :--- | :--- |
| **`INWARD`** (Receiving) | `+quantity` to destination location (`toLocationId`) | `+quantity` | `quantity > 0`, non-zero whole integer. |
| **`OUTWARD`** (Issuing) | `-quantity` from source location (`fromLocationId`) | `-quantity` | `quantity > 0`, source location balance $\ge quantity$, global stock $\ge quantity$. |
| **`TRANSFER`** (Relocation) | Source (`fromLocationId`): `-quantity`<br>Destination (`toLocationId`): `+quantity` | **`0`** (Net zero) | `fromLocationId != toLocationId`, both locations active, source location balance $\ge quantity$. |
| **`ADJUSTMENT`** (Reconciliation) | `+quantity` or `-quantity` to target location (`toLocationId ?? fromLocationId`) | `+quantity` or `-quantity` (signed) | If negative, target location balance $+ \text{quantity} \ge 0$. Rejects mismatched `from` and `to` IDs. |

### Deadlock Prevention
All operations modifying multiple location balances (such as transfers or multi-item purchase-order receipts) acquire row locks using `SELECT ... FOR UPDATE` in strict ascending numerical order (`locationIds.sort((a, b) => a - b)` and `itemIds.sort((a, b) => a - b)`).

---

## 2. Historical Data & Backfill Safety

### Zero-Inference Rule
Historical transactions lacking location IDs (`null`) are **never assigned arbitrary or assumed locations**.
- The backfill script (`apps/api/src/prisma/backfill-location-balances.ts`) flags and skips unallocated transactions.
- If unallocated transactions or negative candidate balances are detected, the backfill automatically halts and refuses to write incomplete data.

---

## 3. Pre-Flight Backup & Execution Procedure

> [!CAUTION]
> Never run the backfill on a production or staging database without a verified snapshot or backup.

### Step 1: Pre-Execution Backup
Take a full backup of the PostgreSQL database before performing any backfill:

```bash
# Full compressed backup
pg_dump -d "$DATABASE_URL" -Fc -f "backup_pre_location_backfill_$(date +%Y%m%d_%H%M%S).dump"

# Or table-specific backup if only stock tables are affected
pg_dump -d "$DATABASE_URL" -t '"LocationStockBalance"' -t '"StockTransaction"' -Fc -f "backup_stock_tables.dump"
```

### Step 2: Dry-Run Assessment
Run the backfill in dry-run mode (default). It will output a JSON summary of candidate balances, skipped transactions, and negative candidates without writing to the database:

```bash
npm run stock:locations:backfill
```

Verify that `negativeCandidates` is `0`. If `skippedTransactions > 0`, review the skipped transaction IDs to confirm they represent intentional historical unallocated movements.

### Step 3: Governed Execution
Once the backup is verified and the dry-run output is reviewed:

```bash
# Requires explicit authorization environment variable and --apply flag
LOCATION_BACKFILL_ALLOW_APPLY=YES npm run stock:locations:backfill -- --apply
```

---

## 4. Rollback and Disaster Recovery Plan

If any issue arises during or after applying the backfill:

### Scenario A: Fast Rollback (Reset Location Balances)
Because `LocationStockBalance` is an additive balance store and `StockTransaction` is append-only, rolling back location balances does not mutate or lose historical transaction records:

```sql
-- Connect to the database and truncate location balances:
TRUNCATE TABLE "LocationStockBalance" RESTART IDENTITY;
```

### Scenario B: Full Database Restore
To restore from the pre-execution dump:

```bash
pg_restore -d "$DATABASE_URL" --clean --if-exists backup_pre_location_backfill_<TIMESTAMP>.dump
```

