"use client";

import { useState } from "react";
import { CategoryStockSummary } from "./category-stock-summary";
import { SuppliersManager } from "./suppliers-manager";
import { LocationsManager } from "./locations-manager";
import { StockMovements } from "./stock-movements";

export function StockManager({
  canManageStock,
  canManageMasterData,
}: {
  canManageStock: boolean;
  canManageMasterData: boolean;
}) {
  const [summaryVersion, setSummaryVersion] = useState(0);
  const [optionsVersion, setOptionsVersion] = useState(0);

  return (
    <div className="flex flex-col gap-6">
      <CategoryStockSummary key={summaryVersion} />

      <StockMovements
        canManage={canManageStock}
        optionsVersion={optionsVersion}
        onRecorded={() => setSummaryVersion((v) => v + 1)}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <SuppliersManager
          canManage={canManageMasterData}
          onChange={() => setOptionsVersion((v) => v + 1)}
        />
        <LocationsManager
          canManage={canManageMasterData}
          onChange={() => setOptionsVersion((v) => v + 1)}
        />
      </div>
    </div>
  );
}
