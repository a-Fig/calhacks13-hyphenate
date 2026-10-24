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

export interface Baseline {
  programs: Program[];
  workCenters: WorkCenter[];
  items: Item[];
  bom: BomLine[];
  sourcing: Sourcing[];
  stock: StockRow[];
  volumePlan: VolumeRow[];
  builtAircraft: BuiltUnit[];
}
