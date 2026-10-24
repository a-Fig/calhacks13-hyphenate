// Schema for the Bowman Aviation dataset. This is the single source of truth that both stand-in
// systems are seeded from: the PLM (parts, revisions, engineering BOMs, change records) and
// ERPNext (items, BOMs, suppliers, prices, standard costs, stock, purchase orders, history).
// Item codes are identical in both systems.
//
// Plain types only (erasable syntax): Node 24 strips them, so `node file.ts` works.

// ---------------------------------------------------------------- shared

/** ISO date, 'YYYY-MM-DD'. */
export type DateStr = string;
/** Calendar month, 'YYYY-MM'. */
export type MonthStr = string;

export type ProgramId = 'vesper' | 'meridian';
export type ItemCode = string; // 'BW-5120-210'
export type SupplierId = string; // 'SUP-ORRIN'
export type PersonId = string; // 'EMP-04'

/**
 * Where a fact came from. `sourced` means it traces to the research docs and `ref` points at
 * doc and section. `invented` is everything else: the dataset is fictional, so most records are.
 */
export interface Provenance {
  basis: 'sourced' | 'invented';
  ref?: string;
  note?: string;
}

/** A forecastable quantity as quantiles (not hard bounds). Units are named by the field. */
export interface Range3 {
  p10: number;
  p50: number;
  p90: number;
}

// ---------------------------------------------------------------- company

/** How changes are approved at Bowman. Dollar tiers and the never-fast-track list follow the published examples. */
export interface ChangeControlPolicy {
  ccbCadence: string;
  ccbMeetings: DateStr[];
  /** Approval tiers by net cost of the change, USD. Configurable in Norn; defaults from the WSR-88D CCB charter. */
  approvalTiers: { upToUsd: number; approver: string }[];
  fastTrackApprover: string;
  fastTrackCriteria: string[];
  neverFastTrack: string[];
  /** Target days from filing to decision. */
  targetDays: { emergency: number; urgent: number; routine: number };
  prov: Provenance;
}

export interface Company {
  changeControl: ChangeControlPolicy;
  name: string;
  short: string;
  description: string;
  vocabulary: string;
  plm: string;
  erp: string;
  currency: 'USD';
  /** Fiscal and dataset reference date. */
  asOf: DateStr;
  prov: Provenance;
}

export interface Site {
  id: string; // 'CA' | 'GA'
  name: string;
  location: string;
  role: string;
  prov: Provenance;
}

export interface Program {
  id: ProgramId;
  name: string; // 'Vesper V4'
  stage: 'production' | 'development';
  description: string;
  topItem: ItemCode;
  seats: string;
  mtowLb: number;
  payloadLb: number;
  rangeMi?: number;
  cruiseMph?: number;
  listPriceUsd?: number;
  targetPriceUsd?: number;
  /** Standard cost today (Vesper) or at launch (Meridian). */
  standardCostUsd: number;
  /** Standard cost target at design rate. */
  targetStandardCostAtRateUsd?: number;
  certification: string;
  /** Plain-language summary of the sourcing link between the programs. */
  note?: string;
  prov: Provenance;
}

export interface WorkCenter {
  id: string; // 'WC-LAYUP'
  name: string;
  site: string;
  /** Loaded labor rate, USD per hour. */
  laborRatePerHour: number;
  /** Wright learning slope on hours (0.90 means 10% fewer hours per doubling). */
  learningSlope: number;
  prov: Provenance;
}

export type Seat =
  | 'design_engineer'
  | 'cm_analyst'
  | 'ccb_chair'
  | 'cost_engineer'
  | 'buyer'
  | 'production_planner'
  | 'cost_accountant'
  | 'quality'
  | 'certification'
  | 'manufacturing_engineer'
  | 'program_manager'
  | 'engineering_director'
  | 'operations_vp'
  | 'cfo';

export interface Person {
  id: PersonId;
  name: string;
  title: string;
  department: string;
  seat: Seat;
  site: string;
  email: string; // fictional, on the reserved .example domain
  reportsTo?: PersonId;
  ccbRole?: 'chair' | 'secretary' | 'member';
  /** What this person owns or answers for, in a line. */
  responsibilities: string;
  prov: Provenance;
}

// ---------------------------------------------------------------- suppliers

export interface Supplier {
  id: SupplierId;
  name: string; // fictional
  region: string;
  country: string;
  supplies: string;
  /** Strategic single-source: the only qualified source of a part whose requalification exceeds six months. */
  singleSource: boolean;
  programs: ProgramId[];
  paymentTerms: string;
  /** Real-world analog, for the record only. Never shown in the product. */
  analog: string;
  onTimeDeliveryPct: number;
  qualityPpm: number;
  prov: Provenance;
}

/** A supplier-side limit that two changes can compete for. */
export interface SupplierConstraint {
  id: string;
  supplier: SupplierId;
  kind: 'qualification_slot' | 'capacity';
  description: string;
  items: ItemCode[];
  /** Annual capacity in the item's unit, where the constraint is a capacity. */
  capacityPerYear?: number;
  window?: { from: DateStr; to: DateStr };
  prov: Provenance;
}

// ---------------------------------------------------------------- items and BOMs

export type CostGroup =
  | 'airframe'
  | 'powertrain' // motors, inverters, propellers
  | 'battery'
  | 'avionics'
  | 'actuation_thermal'
  | 'other';

export type ItemKind = 'aircraft' | 'assembly' | 'part' | 'material';
export type ItemStatus = 'released' | 'proposed';

export interface RevEntry {
  rev: string;
  date: DateStr;
  eco?: string;
  note: string;
}

export interface Item {
  code: ItemCode;
  name: string;
  /** ERPNext item group. */
  itemGroup: string;
  costGroup: CostGroup;
  kind: ItemKind;
  uom: string;
  makeBuy: 'make' | 'buy';
  rev: string;
  status: ItemStatus;
  defaultSupplier?: SupplierId;
  /** Make items: hours to build this item itself (excluding children), and where. */
  workCenter?: string;
  laborHours?: number;
  /** Flight-safety item: never fast-tracked, per the published "never fast-track" list. */
  safetyCritical: boolean;
  programs: ProgramId[];
  /** Standard cost per unit: purchase price for buy items, rolled up for make items. */
  standardCost: number;
  /** Of which material (buy purchase price plus rolled-up children) and labor. */
  standardCostMaterial: number;
  standardCostLabor: number;
  revHistory: RevEntry[];
  prov: Provenance;
}

export interface BomLine {
  parent: ItemCode;
  child: ItemCode;
  /** Quantity of child per one parent. */
  qty: number;
  seq: number;
}

/** A buy item's quote from one supplier. */
export interface Sourcing {
  item: ItemCode;
  supplier: SupplierId;
  primary: boolean;
  /** Share of demand, 0-1. */
  allocation: number;
  /** Unit price in USD: current contract price (p50) and the range the next 12 months could take. */
  unitPrice: Range3;
  leadTimeWeeks: Range3;
  moq: number;
  /** False for a quote on an item no released BOM uses yet (proposed by an open ECR). */
  qualified: boolean;
  /** Only one qualified source for this item. Normal for aerospace part numbers: severity is `requalMonths`. */
  soleSource: boolean;
  /** Months to qualify an alternate source (first article, test, approval). The loss-severity signal for single-sourced items. */
  requalMonths: number;
  capacityPerYear?: number;
  priceValidUntil: DateStr;
  prov: Provenance;
}

/** Price at annual volume, for the move from today's price toward the at-rate price. */
export interface RateFactor {
  costGroup: CostGroup;
  /** Multiplier on today's unit cost at design rate (650 aircraft per year), material and labor. */
  atDesignRate: number;
  prov: Provenance;
}

// ---------------------------------------------------------------- stock and orders

/** Where the units are, in the five places a change form asks about (Crane 104-209), plus supplier side. */
export interface StockRow {
  item: ItemCode;
  /** Bowman stores (ERPNext Bin actual_qty). */
  stores: number;
  /** Work in progress: kitted or issued to open work orders. */
  wip: number;
  /** Finished goods: completed sub-assemblies on hand (make items). */
  finishedGoods: number;
  /** At the supplier, finished and awaiting shipment. */
  supplierFinished: number;
  /** On open purchase orders, not yet started or not yet shipped by the supplier. */
  onOrder: number;
  /** Installed on aircraft already built (in field, in the hangar or on test). */
  inField: number;
  uom: string;
  /** Typical monthly use at the current rate. */
  monthlyUse: number;
  prov: Provenance;
}

export interface PurchaseOrderLine {
  item: ItemCode;
  qty: number;
  unitPrice: number;
  requiredDate: DateStr;
  receivedDate?: DateStr;
  receivedQty: number;
}

export interface PurchaseOrder {
  id: string; // 'PO-25-0114'
  supplier: SupplierId;
  orderDate: DateStr;
  status: 'received' | 'open' | 'cancelled';
  buyer: PersonId;
  lines: PurchaseOrderLine[];
  prov: Provenance;
}

// ---------------------------------------------------------------- volume

export interface VolumeRow {
  month: MonthStr;
  program: ProgramId;
  /** Aircraft completed (final acceptance) in the month. */
  units: number;
  kind: 'production' | 'development';
  site: string;
}

export interface BuiltAircraft {
  program: ProgramId;
  serial: number;
  completed: DateStr;
  kind: 'test' | 'production';
  site: string;
  note: string;
}

export interface StdCostPoint {
  asOf: DateStr;
  program: ProgramId;
  standardCostUsd: number;
  note: string;
}

// ---------------------------------------------------------------- changes: NCR, ECR, ECO

export type JustificationCode = 'B' | 'C' | 'D' | 'O' | 'P' | 'R' | 'S' | 'V';
export type EcrPriority = 'emergency' | 'urgent' | 'routine';
export type CompanyClass = 'I' | 'II';
export type FaaClass = 'minor' | 'major';

export interface Ncr {
  id: string; // 'NCR-0119'
  openedOn: DateStr;
  openedBy: PersonId;
  item: ItemCode;
  rev: string;
  where: string;
  quantityAffected: number;
  /** What the person who found it wrote. */
  description: string;
  /** Material Review Board disposition, if made. */
  mrbDisposition?: string;
  status: 'open' | 'closed_to_ecr' | 'closed';
  linkedEcr?: string;
  prov: Provenance;
}

export type FieldValue = string | number | boolean | null;

export interface FieldChange {
  field: string;
  from: FieldValue;
  to: FieldValue;
}

/** One redline on one item: the (entity, field) overlay the architecture calls a Change. */
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

export interface SupplierQuote {
  id: string;
  supplier: SupplierId;
  item: ItemCode;
  receivedOn: DateStr;
  validUntil?: DateStr;
  /** Free-form pricing lines as the supplier wrote them. */
  lines: { description: string; unitPrice?: number; qty?: number; oneTime?: number }[];
  leadTimeWeeks?: number;
  note?: string;
}

/** One row of the ECP cost page: one-time and recurring (unit cost x quantity). Savings are negative. */
export interface CostLine {
  label: string;
  oneTime?: number;
  unitCost?: number;
  quantity?: number;
  /** Who stands behind the number. `not_provided` rows are what Norn has to fill. */
  basis: 'supplier_quote' | 'engineer_estimate' | 'not_provided';
  note?: string;
}

export interface EcpCostPage {
  production: CostLine[];
  retrofit: CostLine[];
  logisticsSupport: CostLine[];
  other: CostLine[];
}

export interface EffectivityPoint {
  basis: 'serial' | 'date' | 'lot' | 'tbd';
  /** Serial number, ISO date or lot, depending on basis. */
  from: string;
  /** Serial range for retrofit, e.g. 1-10. */
  to?: string;
  note: string;
}

export interface InventoryProposal {
  item: ItemCode;
  location: 'stores' | 'wip' | 'finished_goods' | 'supplier_finished' | 'on_order' | 'in_field';
  disposition: 'use_until_depleted' | 'mandatory_install' | 'rework' | 'scrap' | 'cancel' | 'tbd';
  note?: string;
}

export interface Ecr {
  id: string; // 'ECR-0417'
  rev: string; // ECP revision letter
  title: string;
  status: 'draft' | 'submitted' | 'in_review';
  program: ProgramId;
  originator: PersonId;
  filedOn: DateStr;
  neededBy?: DateStr;
  originatingNcr?: string;
  // Identification block (DD 1692 / MIL-HDBK-61A Table 6-6)
  priority: EcrPriority;
  justificationCode: JustificationCode;
  companyClass: CompanyClass;
  faaClass: FaaClass;
  faaRationale: string;
  classificationNote?: string;
  /** Prose the way the engineer wrote it. */
  description: string;
  need: string;
  consequencesIfDisapproved: string;
  alternativesConsidered: string;
  failureData?: string;
  /** Testing or requalification the originator expects. */
  testAndQualification: string;
  /** Overlay on the baseline. */
  itemChanges: ItemChange[];
  bomChanges: BomChange[];
  supplierQuotes: SupplierQuote[];
  effectivity: { production: EffectivityPoint; retrofit?: EffectivityPoint; interchangeable: boolean };
  inventoryProposal: InventoryProposal[];
  /** What the originator filled in on the cost page. Blank rows are for the impact assessment. */
  costPage: EcpCostPage;
  /** Names of functions the CM analyst routed it to. */
  routedTo: Seat[];
  /** How clean the filing is: Norn's extraction has to cope with all three. */
  clarity: 'detailed' | 'typical' | 'terse';
  prov: Provenance;
}

/** What was forecast when the CCB approved, and what happened. */
export interface EcoForecast {
  unitCostDeltaUsd: number;
  oneTimeCostUsd: number;
  cutInDate: DateStr;
  cutInSerial?: number;
  notes?: string;
}

export interface EcoActual {
  unitCostDeltaUsd: number;
  oneTimeCostUsd: number;
  cutInDate: DateStr;
  cutInSerial?: number;
  /** Why actuals differ, in the words the post-release review used. */
  variance: string;
}

export interface Eco {
  id: string; // 'ECO-0231'
  ecr: string; // the past ECR it released (not in the open set)
  title: string;
  originator: PersonId;
  fileDate: DateStr;
  approvedOn: DateStr;
  releasedOn: DateStr;
  decidedBy: 'ccb' | 'fast_track';
  justificationCode: JustificationCode;
  companyClass: CompanyClass;
  faaClass: FaaClass;
  program: ProgramId[];
  itemChanges: ItemChange[];
  summary: string;
  forecast: EcoForecast;
  actual: EcoActual;
  prov: Provenance;
}

// ---------------------------------------------------------------- demo answer key

/** Answer key for a planted scenario. Not an input to Norn: it is what a reviewer or test checks Norn against. */
export interface Scenario {
  id: string;
  title: string;
  ecrs: string[];
  kind: 'worked_example' | 'big_change' | 'fast_track' | 'conflict' | 'shared_supplier' | 'background';
  /** What a correct run should find, in plain language. */
  expect: string[];
  /** Reference arithmetic by the dataset author. Indicative, not a number Norn must match to the cent. */
  reference?: Record<string, number>;
  prov: Provenance;
}

// ---------------------------------------------------------------- dataset

export interface Dataset {
  /** Provenance for sections whose records carry none of their own. */
  sectionProvenance: Record<string, Provenance>;
  company: Company;
  sites: Site[];
  programs: Program[];
  workCenters: WorkCenter[];
  people: Person[];
  suppliers: Supplier[];
  supplierConstraints: SupplierConstraint[];
  items: Item[];
  bom: BomLine[];
  sourcing: Sourcing[];
  rateFactors: RateFactor[];
  stock: StockRow[];
  purchaseOrders: PurchaseOrder[];
  volumePlan: VolumeRow[];
  builtAircraft: BuiltAircraft[];
  standardCostHistory: StdCostPoint[];
  history: Eco[];
  ncrs: Ncr[];
  ecrs: Ecr[];
  demoScenarios: Scenario[];
}
