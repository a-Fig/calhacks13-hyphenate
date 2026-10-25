// What the checks read: a company's production baseline and one change request (ECR), and the
// trace every output carries. The shapes name only the fields the checks use, so a company's
// dataset with more fields passes as is.

import type { Dist } from './dist.ts';

export type ItemCode = string;
export type SupplierId = string;
export type ProgramId = string;
/** ISO date, 'YYYY-MM-DD'. */
export type DateStr = string;
/** Calendar month, 'YYYY-MM'. */
export type MonthStr = string;
export type FieldValue = string | number | boolean | null;

/** A quantity as quantiles, not hard bounds. */
export interface Range3 {
  p10: number;
  p50: number;
  p90: number;
}

// ---------------------------------------------------------------- the baseline (`main`)

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
 * A supplier-side limit that changes can compete for: a qualification slot or a capacity. Only the
 * fields the checks read are named. The ERP holds none of this, so a baseline carries it only when
 * the company's configuration or its data supplies it; the checks run without it.
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
  /** Supplier limits the supply check looks for conflicts between open changes in. Optional: the ERP does not hold them. */
  supplierConstraints?: SupplierConstraint[];
}

// ---------------------------------------------------------------- one change request (an ECR)

export interface FieldChange {
  field: string;
  from: FieldValue;
  to: FieldValue;
}

/** One redline on one item. `from` values are what the author saw on the baseline. */
export interface ItemChange {
  item: ItemCode;
  op: 'revise' | 'add' | 'remove';
  fromRev?: string;
  toRev?: string;
  changes: FieldChange[];
}

export interface BomChange {
  op: 'add' | 'remove' | 'set_qty';
  parent: ItemCode;
  child: ItemCode;
  qtyFrom?: number;
  qtyTo?: number;
}

export interface QuoteLine {
  description: string;
  unitPrice?: number;
  qty?: number;
  oneTime?: number;
}

export interface SupplierQuote {
  id: string;
  supplier: SupplierId;
  item: ItemCode;
  lines: QuoteLine[];
  leadTimeWeeks?: number;
  /** A budgetary quote moves more than a firm one. Unset: read from `note`, else firm. */
  firmness?: 'firm' | 'budgetary';
  note?: string;
}

export type CostBasis = 'supplier_quote' | 'engineer_estimate' | 'not_provided';

/** One row of the ECP cost page as the originator filled it. Savings are negative. */
export interface CostPageRow {
  /** A stable id for the row, from the PLM. Unset: a slug of the label. Assumptions find a row by it. */
  id?: string;
  label: string;
  /** Explicit factor linkage, e.g. qualification, so unrelated rows cannot stand for its estimate. */
  factor?: string;
  oneTime?: number;
  /**
   * Unit cost. On a production row, per part, with `quantity` the parts per finished unit (34.60 x 12
   * brackets per aircraft); on the other blocks, per kit or unit, with `quantity` the kits or units.
   */
  unitCost?: number;
  quantity?: number;
  basis: CostBasis;
  note?: string;
}

export const COST_BLOCKS = ['production', 'retrofit', 'logisticsSupport', 'other'] as const;
export type CostBlock = (typeof COST_BLOCKS)[number];
export type CostPage = Record<CostBlock, CostPageRow[]>;

export interface EffectivityPoint {
  basis: 'serial' | 'date' | 'lot' | 'tbd';
  /** Serial number, ISO date or lot, depending on basis. */
  from: string;
  /** Last serial, for a retrofit range. */
  to?: string;
  note?: string;
}

export type StockLocation = 'stores' | 'wip' | 'finished_goods' | 'supplier_finished' | 'on_order' | 'in_field';
export type Disposition = 'use_until_depleted' | 'mandatory_install' | 'rework' | 'scrap' | 'cancel' | 'tbd';

export interface InventoryProposal {
  item: ItemCode;
  location: StockLocation;
  disposition: Disposition;
  note?: string;
}

export interface ChangeRequest {
  id: string;
  program: ProgramId;
  filedOn: DateStr;
  /** `urgent` changes are decided faster than `routine` ones. Unset: routine. */
  priority?: string;
  /** Prose is retained so an unmodeled qualification is reported, never silently assumed complete. */
  testAndQualification?: string;
  implementationPlan?: ImplementationPlan;
  costFactors?: import('./completeness.ts').CostFactorDeclaration[];
  itemChanges: ItemChange[];
  bomChanges: BomChange[];
  supplierQuotes: SupplierQuote[];
  effectivity: { production: EffectivityPoint; retrofit?: EffectivityPoint; interchangeable: boolean };
  inventoryProposal: InventoryProposal[];
  costPage: CostPage;
}

/** Explicit release prerequisites. Durations are weeks; dependencies name tasks or `decision`/`parts`. */
export interface ImplementationTask {
  id: string;
  label: string;
  kind: 'qualification' | 'certification' | 'release' | 'installation' | 'test';
  appliesTo: 'production' | 'retrofit' | 'both';
  owner: string;
  status: 'planned' | 'complete' | 'not_applicable' | 'unknown';
  durationWeeks?: number | Range3;
  after?: string[];
  completedOn?: DateStr;
  evidence?: string;
  /** Aircraft unavailability per retrofit unit; independent of elapsed program duration. */
  downtimeHoursPerUnit?: number;
}

export interface ImplementationPlan {
  /** A person has confirmed that every applicable prerequisite is represented. */
  complete: boolean;
  tasks: ImplementationTask[];
}

// ---------------------------------------------------------------- traces

/** Where an input came from (ARCHITECTURE.md §3). */
export type Source = 'given' | 'default' | 'agent_estimated';

/** An input or assumption a check used. Its id is what traces point at. */
export interface InputRecord {
  id: string;
  label: string;
  source: Source;
  /** A fixed value (a count, a price, a month) or, for an uncertain input, its stated value. */
  value?: number | string;
  /** The distribution, for an uncertain input. */
  dist?: Dist;
  /** Correlation groups of an uncertain input. */
  groups?: string[];
  /** Where in the inputs it came from, e.g. 'ECR-0417 costPage.production[1]'. */
  ref?: string;
  rationale?: string;
  /** A default standing in for a number nobody has given yet: an agent or a person should estimate it. */
  needsEstimate?: boolean;
}

export interface TraceUse {
  id: string;
  source: Source;
}

/** How one output number was made. Code computed it, so its evidence class is 'computation'. */
export interface Trace {
  formula: string;
  uses: TraceUse[];
  evidence: 'computation';
}

/** An assumption set on the ECR or the baseline that replaces a default: an agent's estimate or a person's edit. */
export interface AssumptionOverride {
  id: string;
  source: Source;
  rationale: string;
  /** For an uncertain input. */
  dist?: Dist;
  /** For a fixed input such as an effectivity serial (number) or month ('YYYY-MM'). */
  value?: number | string;
  /** Needed to replace a number someone stated (a quote, an engineer's estimate). Defaults can always be replaced. */
  replacesGiven?: boolean;
  by?: string;
}

/** Something a reader should look at: a default standing in for a number, a cross-check, a conflict. */
export interface Flag {
  kind: string;
  severity: 'info' | 'warn';
  message: string;
  ref?: string;
}

export const CHECKS_CODE_VERSION = 'checks-0.4.0';
