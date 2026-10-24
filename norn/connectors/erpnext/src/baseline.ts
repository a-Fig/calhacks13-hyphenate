// Mirror of norn/checks/src/types.ts until #41 lands; replace with an import.
// Only the baseline types are copied (what the checks read from a company's ERP and PLM), so this
// connector's output type is the checks library's input type. Keep the shapes identical.

export type ItemCode = string;
export type SupplierId = string;
export type ProgramId = string;
/** ISO date, 'YYYY-MM-DD'. */
export type DateStr = string;
/** Calendar month, 'YYYY-MM'. */
export type MonthStr = string;

/** A quantity as quantiles, not hard bounds. */
export interface Range3 {
  p10: number;
  p50: number;
  p90: number;
}

export interface Item {
  code: ItemCode;
  name: string;
  rev: string;
  makeBuy: 'make' | 'buy';
  /** `proposed`: quoted for an open change, in no released BOM yet. */
  status: 'released' | 'proposed';
  defaultSupplier?: SupplierId;
  workCenter?: string;
  /** Make items: hours to build this item itself, excluding children. */
  laborHours?: number;
  /** Standard cost per unit. For a buy item, its purchase price. */
  standardCost: number;
}

export interface BomLine {
  parent: ItemCode;
  child: ItemCode;
  /** Quantity of child per one parent. */
  qty: number;
  seq?: number;
}

export interface Sourcing {
  item: ItemCode;
  supplier: SupplierId;
  primary: boolean;
  /** Share of demand, 0-1. */
  allocation: number;
  /** Unit price: today's contract price (p50) and the range the next 12 months could take. */
  unitPrice: Range3;
  leadTimeWeeks: Range3;
  qualified: boolean;
}

/** Where the units are: the five places a change form asks about, plus supplier side. */
export interface StockRow {
  item: ItemCode;
  stores: number;
  wip: number;
  finishedGoods: number;
  supplierFinished: number;
  onOrder: number;
  inField: number;
}

export interface Program {
  id: ProgramId;
  name: string;
  topItem: ItemCode;
}

export interface WorkCenter {
  id: string;
  laborRatePerHour: number;
}

export interface VolumeRow {
  month: MonthStr;
  program: ProgramId;
  /** Units completed in the month. */
  units: number;
}

export interface BuiltUnit {
  program: ProgramId;
  serial: number;
  completed: DateStr;
}

/**
 * A supplier-side limit that two open changes can compete for. Mirrors `SupplierConstraint` in
 * norn/checks/src/types.ts (branch claude/timeline-supply-checks, not on main yet). `supplier` is the ERPNext
 * supplier name, the same string `Sourcing.supplier` carries.
 */
export interface SupplierConstraint {
  id: string;
  supplier: SupplierId;
  kind: 'qualification_slot' | 'capacity';
  items: ItemCode[];
  /** Capacity per year in the items' unit, for a capacity constraint. */
  capacityPerYear?: number;
  /** When it applies. For a qualification slot, the first slot opens at `from` and the last opens by `to`. */
  window?: { from: DateStr; to: DateStr };
  description?: string;
  /** Qualification slot: months between slot openings, one lot per slot. Unset: read from the description, else 3. */
  slotCadenceMonths?: number;
  /**
   * Qualification slot: a second part number qualified within this many weeks of the first costs this share
   * less, and ordering two part numbers inside the window earns this price break on the raw material.
   * Unset: read from the description when it states them.
   */
  bundle?: { withinWeeks: number; secondQualificationDiscount?: number; priceBreak?: number };
}

export interface Baseline {
  programs: Program[];
  workCenters: WorkCenter[];
  items: Item[];
  bom: BomLine[];
  sourcing: Sourcing[];
  stock: StockRow[];
  volumePlan: VolumeRow[];
  builtAircraft: BuiltUnit[];
  /** Supplier limits the supply check looks for conflicts between open changes in. Optional: only a company that keeps them in its ERP has them here. */
  supplierConstraints?: SupplierConstraint[];
}
