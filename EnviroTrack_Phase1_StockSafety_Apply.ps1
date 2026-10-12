$ErrorActionPreference = "Stop"

# Safe, narrowly-scoped EnviroTrack stock-safety installer.
# Run from the repository root:
#   powershell -ExecutionPolicy Bypass -File .\EnviroTrack_Phase1_StockSafety_Apply.ps1

$root = (Get-Location).Path
$gitRoot = (& git -C $root rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $gitRoot) {
  throw "Current directory is not inside a Git repository. Run this script from the repository root."
}
$gitRoot = [System.IO.Path]::GetFullPath(($gitRoot | Select-Object -First 1).Trim())
if ([System.IO.Path]::GetFullPath($root).TrimEnd('\') -ne $gitRoot.TrimEnd('\')) {
  throw "Run this script from the repository root: $gitRoot"
}

$apiRoot = Join-Path $gitRoot "apps\api"
$routePath = Join-Path $apiRoot "src\routes\stock.routes.ts"
$stockServicePath = Join-Path $apiRoot "src\services\stock.service.ts"
$packagePath = Join-Path $apiRoot "package.json"
$ledgerPath = Join-Path $apiRoot "src\services\stock-ledger.ts"
$testDir = Join-Path $apiRoot "test"
$testPath = Join-Path $testDir "stock-ledger.test.ts"

foreach ($path in @($routePath, $stockServicePath, $packagePath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Expected file not found: $path. No files were changed."
  }
}
foreach ($path in @($ledgerPath, $testPath)) {
  if (Test-Path -LiteralPath $path) {
    throw "Refusing to overwrite existing file: $path. No files were changed."
  }
}

$routeOriginal = [System.IO.File]::ReadAllText($routePath)
$stockServiceOriginal = [System.IO.File]::ReadAllText($stockServicePath)
$packageOriginal = [System.IO.File]::ReadAllText($packagePath)

# Normalize line endings for safe matching; restore the original convention on write.
$routeNewline = if ($routeOriginal.Contains("`r`n")) { "`r`n" } else { "`n" }
$serviceNewline = if ($stockServiceOriginal.Contains("`r`n")) { "`r`n" } else { "`n" }
$packageNewline = if ($packageOriginal.Contains("`r`n")) { "`r`n" } else { "`n" }
$routeText = $routeOriginal.Replace("`r`n", "`n")
$stockServiceText = $stockServiceOriginal.Replace("`r`n", "`n")
$packageText = $packageOriginal.Replace("`r`n", "`n")

$auditImportPattern = '(?m)^import \{ recordAudit \} from "\.\./services/audit\.service";$'
$stockImportPattern = '(?m)^import \{ getCategoryStockSummary \} from "\.\./services/stock\.service";$'
$blockPattern = '(?s)const transaction = await prisma\.stockTransaction\.create\(\{.*?await recordAudit\(\{.*?\}\);\s*res\.status\(201\)\.json\(transaction\);'

if ([regex]::Matches($routeText, $auditImportPattern).Count -ne 1) {
  throw "Could not find exactly one expected recordAudit import in stock.routes.ts. No files were changed."
}
if ([regex]::Matches($routeText, $stockImportPattern).Count -ne 1) {
  throw "Could not find exactly one expected stock.service import in stock.routes.ts. No files were changed."
}
if ([regex]::Matches($routeText, $blockPattern).Count -ne 1) {
  throw "Could not match the current stock-transaction creation and audit block exactly once. No files were changed. Review stock.routes.ts manually."
}

$ledgerImport = @'
import {
  assertNonNegativeStock,
  calculateCurrentStock,
  getSignedStockDelta,
  InsufficientStockError,
} from "../services/stock-ledger";
'@
$ledgerImport = $ledgerImport.Trim()

$routeText = [regex]::Replace($routeText, $auditImportPattern + '\n?', '', 1)
$stockImportRegex = [regex]::new($stockImportPattern)
$routeText = $stockImportRegex.Replace(
  $routeText,
  [System.Text.RegularExpressions.MatchEvaluator]{
    param($match)
    return $match.Value + "`n" + $ledgerImport
  },
  1
)

$replacementBlock = @'
  let transaction:
    | Prisma.StockTransactionGetPayload<{ include: typeof TRANSACTION_INCLUDE }>
    | undefined;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      transaction = await prisma.$transaction(
        async (tx) => {
          const stockTotals = await tx.stockTransaction.groupBy({
            by: ["type"],
            where: { itemId },
            _sum: { quantity: true },
          });
          const currentStock = calculateCurrentStock(stockTotals);
          const stockDelta = getSignedStockDelta(type as TransactionType, quantity);
          assertNonNegativeStock(currentStock, stockDelta);

          const created = await tx.stockTransaction.create({
            data: {
              type: type as TransactionType,
              quantity,
              itemId,
              supplierId,
              fromLocationId,
              toLocationId,
              referenceNumber,
              remarks,
              createdById: req.session!.userId,
            },
            include: TRANSACTION_INCLUDE,
          });

          // Keep the audit record atomic with the stock transaction.
          await tx.auditLog.create({
            data: {
              actorId: req.session!.userId,
              action: "stock.transaction.create",
              entityType: "StockTransaction",
              entityId: created.id,
              after: {
                id: created.id,
                type: created.type,
                quantity: created.quantity,
                itemId: created.itemId,
                supplierId: created.supplierId,
                fromLocationId: created.fromLocationId,
                toLocationId: created.toLocationId,
              },
            },
          });

          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
      break;
    } catch (error) {
      if (error instanceof InsufficientStockError) {
        res.status(409).json({ error: error.message });
        return;
      }

      const isSerializationConflict =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (isSerializationConflict && attempt < 2) continue;
      if (isSerializationConflict) {
        res.status(409).json({
          error: "Stock changed concurrently. Please retry the transaction.",
        });
        return;
      }
      throw error;
    }
  }

  if (!transaction) {
    throw new Error("Stock transaction completed without a result");
  }

  res.status(201).json(transaction);
'@
$blockRegex = [regex]::new($blockPattern)
$routeText = $blockRegex.Replace(
  $routeText,
  [System.Text.RegularExpressions.MatchEvaluator]{
    param($match)
    return $replacementBlock
  },
  1
)

$helperContent = @'
export type StockMovementType = "INWARD" | "OUTWARD" | "ADJUSTMENT";

export type StockAggregate = {
  type: StockMovementType;
  _sum: { quantity: number | null };
};

/** Applies the sign convention used by the existing stock ledger. */
export function getSignedStockDelta(
  type: StockMovementType,
  quantity: number
): number {
  if (type === "INWARD") return quantity;
  if (type === "OUTWARD") return -quantity;
  return quantity;
}

/** Calculates a balance from aggregates scoped to one item. */
export function calculateCurrentStock(
  aggregates: readonly StockAggregate[]
): number {
  return aggregates.reduce(
    (balance, row) =>
      balance + getSignedStockDelta(row.type, row._sum.quantity ?? 0),
    0
  );
}

export class InsufficientStockError extends Error {
  constructor(currentStock: number, change: number) {
    super(
      `Stock change would make inventory negative (current stock: ${currentStock}, change: ${change}).`
    );
    this.name = "InsufficientStockError";
  }
}

/** Reject a subtractive operation that would make an item's stock negative. */
export function assertNonNegativeStock(currentStock: number, change: number): void {
  if (change < 0 && currentStock + change < 0) {
    throw new InsufficientStockError(currentStock, change);
  }
}
'@

$testContent = @'
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNonNegativeStock,
  calculateCurrentStock,
  getSignedStockDelta,
  InsufficientStockError,
} from "../src/services/stock-ledger";

test("stock balance applies inward, outward, and signed adjustments", () => {
  assert.equal(
    calculateCurrentStock([
      { type: "INWARD", _sum: { quantity: 12 } },
      { type: "OUTWARD", _sum: { quantity: 4 } },
      { type: "ADJUSTMENT", _sum: { quantity: -1 } },
    ]),
    7
  );
});

test("outward stock movements use a negative delta", () => {
  assert.equal(getSignedStockDelta("OUTWARD", 3), -3);
});

test("subtractive changes that would make stock negative are rejected", () => {
  assert.throws(
    () => assertNonNegativeStock(2, -3),
    InsufficientStockError
  );
});

test("a subtractive change that leaves exactly zero stock is allowed", () => {
  assert.doesNotThrow(() => assertNonNegativeStock(3, -3));
});

test("inward movements can help repair a previously negative ledger balance", () => {
  assert.doesNotThrow(() => assertNonNegativeStock(-2, 1));
});

test("negative adjustments cannot reduce stock below zero", () => {
  assert.throws(
    () => assertNonNegativeStock(1, getSignedStockDelta("ADJUSTMENT", -2)),
    InsufficientStockError
  );
});
'@

# Keep stock.service.ts using the same sign convention as the guard.
$deltaLinePattern = '(?m)^(\s*)const delta = row\.type === "INWARD" \? sum : row\.type === "OUTWARD" \? -sum : sum;$'
if ([regex]::Matches($stockServiceText, $deltaLinePattern).Count -ne 1) {
  throw "Could not find the expected stock sign calculation in stock.service.ts. No files were changed."
}
$stockServiceText = [regex]::Replace(
  $stockServiceText,
  $deltaLinePattern,
  '$1const delta = getSignedStockDelta(row.type, sum);',
  1
)
$stockServiceImportPattern = '(?m)^import \{ prisma \} from "\.\./lib/db";$'
if ([regex]::Matches($stockServiceText, $stockServiceImportPattern).Count -ne 1) {
  throw "Could not find the expected prisma import in stock.service.ts. No files were changed."
}
$stockServiceText = [regex]::Replace(
  $stockServiceText,
  $stockServiceImportPattern,
  'import { prisma } from "../lib/db";' + "`n" + 'import { getSignedStockDelta } from "./stock-ledger";',
  1
)

# Add a narrowly-scoped script without overwriting a project's existing test script.
$testScriptName = "test:stock-ledger"
if ($packageText -match '(?m)^\s*"test:stock-ledger"\s*:') {
  throw "package.json already defines test:stock-ledger. No files were changed; review that script before continuing."
}
$buildLinePattern = '(?m)^([ \t]*)"build"[ \t]*:[ \t]*"prisma generate && tsc",[ \t]*$'
if ([regex]::Matches($packageText, $buildLinePattern).Count -ne 1) {
  throw "Could not find the expected build script in apps/api/package.json. No files were changed."
}
$packageText = [regex]::Replace(
  $packageText,
  $buildLinePattern,
  [System.Text.RegularExpressions.MatchEvaluator]{
    param($match)
    return $match.Value + "`n" + $match.Groups[1].Value + '"test:stock-ledger": "node --import tsx --test test/stock-ledger.test.ts",'
  },
  1
)

# Validate the updated JSON before touching any files.
$null = $packageText | ConvertFrom-Json

$backupPath = Join-Path (Split-Path $gitRoot -Parent) ("envirotrack-stock-safety-backup-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $backupPath | Out-Null
Copy-Item -LiteralPath $routePath -Destination (Join-Path $backupPath "stock.routes.ts.before")
Copy-Item -LiteralPath $stockServicePath -Destination (Join-Path $backupPath "stock.service.ts.before")
Copy-Item -LiteralPath $packagePath -Destination (Join-Path $backupPath "package.json.before")

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
try {
  [System.IO.File]::WriteAllText($routePath, $routeText.Replace("`n", $routeNewline), $utf8NoBom)
  [System.IO.File]::WriteAllText($stockServicePath, $stockServiceText.Replace("`n", $serviceNewline), $utf8NoBom)
  [System.IO.File]::WriteAllText($packagePath, $packageText.Replace("`n", $packageNewline), $utf8NoBom)
  [System.IO.File]::WriteAllText($ledgerPath, $helperContent.Replace("`n", $routeNewline) + $routeNewline, $utf8NoBom)
  New-Item -ItemType Directory -Path $testDir -Force | Out-Null
  [System.IO.File]::WriteAllText($testPath, $testContent.Replace("`n", $routeNewline) + $routeNewline, $utf8NoBom)

  $null = [System.IO.File]::ReadAllText($packagePath) | ConvertFrom-Json
} catch {
  # Restore the pre-existing files and remove newly created files if this script fails mid-write.
  Copy-Item -LiteralPath (Join-Path $backupPath "stock.routes.ts.before") -Destination $routePath -Force
  Copy-Item -LiteralPath (Join-Path $backupPath "stock.service.ts.before") -Destination $stockServicePath -Force
  Copy-Item -LiteralPath (Join-Path $backupPath "package.json.before") -Destination $packagePath -Force
  Remove-Item -LiteralPath $ledgerPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $testPath -Force -ErrorAction SilentlyContinue
  throw "Changes were rolled back because installation failed. Backup: $backupPath. Error: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "Stock-safety code changes were written."
Write-Host "Backup of original files: $backupPath"
Write-Host "Changed files:"
Write-Host "  apps/api/src/routes/stock.routes.ts"
Write-Host "  apps/api/src/services/stock.service.ts"
Write-Host "  apps/api/src/services/stock-ledger.ts (new)"
Write-Host "  apps/api/test/stock-ledger.test.ts (new)"
Write-Host "  apps/api/package.json"
Write-Host ""
Write-Host "Next, review the diff before running tests:"
Write-Host "  git diff --check"
Write-Host "  git diff -- apps/api"
Write-Host "  npm run test:stock-ledger --workspace=@envirozone/api"
Write-Host "  npm run build --workspace=@envirozone/api"
