# EnviroTrack stock-location decision

## Current decision status

**Decision required before implementation.** The current product requirements do not define
whether a location is only movement metadata or the owner of an item's stock balance.

## Current semantics

- `StockTransaction` is an append-only item-level ledger. Current stock is calculated by
  summing all transactions for an `itemId`: `INWARD` adds, `OUTWARD` subtracts, and signed
  `ADJUSTMENT` values are applied as-is.
- `fromLocationId` and `toLocationId` are nullable foreign keys on
  [`StockTransaction`](../apps/api/src/prisma/schema.prisma). They do not participate in
  [`getCurrentStockByItemIds`](../apps/api/src/services/stock.service.ts), category summaries,
  negative-stock checks, or item low-stock calculations.
- The manual stock endpoint validates the two location IDs, stores them, and returns their
  names in the ledger. It does not infer a transfer or change a location balance:
  [`stock.routes.ts`](../apps/api/src/routes/stock.routes.ts).
- Purchase-order receiving accepts only `toLocationId` and stores it on each generated
  `INWARD` transaction. It is also metadata today:
  [`purchase-orders.routes.ts`](../apps/api/src/routes/purchase-orders.routes.ts).
- The stock UI exposes optional “From location” and “To location” selectors and displays
  them in movement details, but shows one `currentStock` total per item:
  [`stock-movements.tsx`](../apps/web/src/components/stock/stock-movements.tsx),
  [`inventory-manager.tsx`](../apps/web/src/components/inventory-manager.tsx).
- The purchase-order UI exposes an optional “Receive into location” selector, but it does not
  display or query balances by location:
  [`purchase-order-detail.tsx`](../apps/web/src/components/purchase-orders/purchase-order-detail.tsx).

## What an inter-location transfer should mean

Under a location-owned inventory model, transferring `N` units of item `X` from location `A`
to location `B` must be one atomic business operation:

1. Verify `A` and `B` are distinct active locations.
2. Verify location `A` has at least `N` units of `X`.
3. Decrease `X` at `A` by `N`.
4. Increase `X` at `B` by `N`.
5. Preserve one actor, reference, timestamp, and audit event for the transfer.
6. Leave the global item total unchanged.

The current single-row `StockTransaction` shape cannot express both legs as a reliable
location balance by itself. A transfer would need either two linked ledger rows or a dedicated
transfer operation/event with an immutable correlation identifier.

## Alternatives

### A. Keep one total per item

- `fromLocationId`/`toLocationId` remain descriptive metadata.
- An inter-location movement may be displayed as “from A to B”, but does not affect a
  location balance.
- No location-level stock availability or transfer validation is possible.
- Lowest migration and implementation risk; matches the current API and UI.

### B. Make stock location-aware (recommended for the stated EnviroTrack direction)

- Maintain balances per `(itemId, locationId)` and derive the item total as the sum of all
  locations.
- Receiving adds stock to the selected destination location.
- A transfer subtracts from the source and adds to the destination atomically.
- Manual adjustments and outward movements must identify the location whose stock changes.
- The UI must show location balances and require a location for operations where ownership
  matters.

This better matches the product brief's stated need to track spare-part quantities and item
locations, but it is a business-model change rather than a reporting enhancement.

## Migration and backfill risks

Introducing location balances is not a safe additive interpretation of existing rows without
a policy for historical null locations:

- Existing transactions with null locations cannot be assigned accurately to a location.
- Existing `fromLocationId`/`toLocationId` pairs do not prove the opening balance at either
  location because the current system never enforced location stock.
- A naive backfill could make per-location totals disagree with the already trusted item total.
- Existing `OUTWARD` and negative `ADJUSTMENT` rows need a source location to validate.
- Introducing a new balance table or transfer linkage requires a migration, indexes, and a
  cutover/backfill plan; it must not reset or rewrite the append-only ledger.

The safe migration sequence would be: choose a null-location policy (unknown holding area,
manual reconciliation, or historical totals excluded), snapshot/reconcile current item
totals, add the location-aware model or ledger linkage, backfill only according to that
policy, then require locations for new location-owned movements. No such migration should be
created until the policy is approved.

## API and UI changes required if location-aware stock is approved

### API

- Add an explicit transfer operation or linked transfer identity; do not treat arbitrary
  `fromLocationId`/`toLocationId` metadata as a transfer.
- Add location-scoped stock queries and include per-location availability in item/summary
  responses.
- Require and validate source/destination locations for transfers; reject same-location
  transfers and source overdraws.
- Define location requirements for `INWARD`, `OUTWARD`, and `ADJUSTMENT`.
- Keep the item-level total as a derived compatibility value.
- Preserve serializable transaction and audit/idempotency behavior for the complete operation.

### UI

- Add a per-item location balance view and location filters to stock/inventory screens.
- Turn the current optional selectors into operation-specific required fields.
- Add a dedicated transfer form showing source availability and destination.
- Show location balances and transfer history, not only movement metadata.
- Update low-stock alerts to state whether the threshold is global or per location.
- Update purchase-order receiving to show the destination location's resulting balance.

## Requested product decision

For EnviroTrack, should inventory be **location-owned** with atomic inter-location transfers and
per-location balances (Option B), or should locations remain **metadata only** while the
authoritative balance stays one total per item (Option A)?
