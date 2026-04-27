// ═════════════════════════════════════════════════════════════════════
// Module: Inventory + Lot/Heat Tracking
//
// Live count of raw material, hardware, consumables. Supports lot +
// heat-number traceability required for aerospace/medical/code work.
//
// Core model:
//   InventoryItem   — a SKU (what it is)
//   InventoryLot    — a received batch of that SKU with cert + heat
//   InventoryTxn    — a movement (receive / issue / adjust / scrap)
//
// Every time-log or job can reference the lot(s) consumed so traceability
// survives from raw stock → finished part → shipped cert.
//
// Phase: dormant. Types only.
// ═════════════════════════════════════════════════════════════════════

export type InventoryCategory =
  | 'raw-material'      // bar, sheet, plate
  | 'hardware'          // fasteners, inserts
  | 'consumable'        // abrasives, media, coolant
  | 'chemical'          // plating salts, anodizing acids
  | 'tooling'           // inserts, endmills
  | 'finished-goods'    // completed assemblies ready to ship
  | 'other';

export type InventoryUnit =
  | 'ea' | 'in' | 'ft' | 'lb' | 'kg' | 'oz'
  | 'gal' | 'L' | 'sqft' | 'sqin' | 'sheet' | 'bar' | 'lot';

export interface InventoryItem {
  id: string;                       // stable SKU id
  tenantId: string;
  partNumber?: string;              // internal or manufacturer part number
  description: string;              // "1/4\" 6061-T6 Aluminum Plate"
  category: InventoryCategory;
  unit: InventoryUnit;
  /** Optional: customer-provided material vs. shop-owned stock. */
  ownedByCustomer?: string;         // customer name if consigned
  /** Reorder point — trigger "low stock" warning when onHand drops below. */
  reorderPoint?: number;
  /** Default supplier for re-orders (links to vendor). */
  defaultVendorId?: string;
  /** Shelf life in days — surfaces "expiring soon" alerts. */
  shelfLifeDays?: number;
  /** Shop-wide UOM cost used when the specific lot cost isn't known. */
  standardCostPerUnit?: number;
  archived?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** A received batch with its own cert + heat number. */
export interface InventoryLot {
  id: string;
  tenantId: string;
  itemId: string;                   // → InventoryItem
  lotNumber: string;                // shop-assigned or supplier-provided
  heatNumber?: string;              // required for code/aerospace work
  vendorId?: string;
  vendorName?: string;              // denormalized
  poNumber?: string;                // incoming PO linked
  receivedDate: number;
  receivedQty: number;              // in the item's unit
  onHandQty: number;                // decreases as txns consume it
  /** Per-unit cost at receipt — used for job costing. */
  costPerUnit?: number;
  /** Material + quality documents attached to this lot. */
  attachments?: Array<{
    id: string;
    name: string;
    kind: 'mat-cert' | 'coc' | 'msds' | 'mill-cert' | 'inspection' | 'other';
    url: string;
    uploadedAt: number;
  }>;
  /** Expiration date (shelf life or cure date). */
  expiresAt?: number;
  /** Whether this lot passed incoming inspection. */
  inspectionStatus?: 'pending' | 'accepted' | 'rejected' | 'quarantined';
  inspectedBy?: string;
  inspectedAt?: number;
  inspectionNotes?: string;
  archived?: boolean;
}

/** A movement in/out of a lot. Sum of txns = current onHandQty. */
export interface InventoryTxn {
  id: string;
  tenantId: string;
  lotId: string;
  itemId: string;                   // denormalized for queries
  kind: 'receive' | 'issue' | 'adjust' | 'scrap' | 'return' | 'transfer';
  qty: number;                      // positive for receive/return, negative otherwise
  /** When `kind === 'issue'`, which job consumed this lot. */
  jobId?: string;
  jobDisplay?: string;
  /** When `kind === 'transfer'`, the destination lot/location. */
  destinationLotId?: string;
  note?: string;
  userId: string;
  userName: string;
  at: number;
}

/** Low-stock + expiring-soon alerts, computed periodically. */
export interface InventoryAlert {
  id: string;
  tenantId: string;
  itemId: string;
  kind: 'low-stock' | 'expiring' | 'expired' | 'quarantined' | 'no-onhand-but-needed';
  createdAt: number;
  resolvedAt?: number;
  message: string;
}
