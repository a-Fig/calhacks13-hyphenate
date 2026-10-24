import type { CostGroup, ItemCode, ItemKind, Provenance, Range3, SupplierId } from './types.ts';
import { INV } from './prov.ts';

// Authoring helpers for the item catalog. A catalog is a list of rows; derive.ts expands them into
// Item, BomLine and Sourcing records. Buy rows carry the supplier's quote; make rows carry the BOM.

/** Lead-time classes, in weeks as p10 / p50 / p90. Cells, magnets, prepreg and avionics follow
 *  archer-public-data.md "Suggested basis for Bowman" (cells 16-24, magnets 20-30, prepreg 12-20,
 *  avionics 26-40). The rest are invented. */
export const LEAD: Record<string, Range3> = {
  cells: { p10: 16, p50: 20, p90: 24 },
  magnets: { p10: 20, p50: 25, p90: 30 },
  prepreg: { p10: 12, p50: 16, p90: 20 },
  avionics: { p10: 26, p50: 33, p90: 40 },
  tier1: { p10: 18, p50: 24, p90: 32 },
  machined: { p10: 6, p50: 9, p90: 14 },
  powersemi: { p10: 22, p50: 28, p90: 40 },
  electronics: { p10: 14, p50: 18, p90: 26 },
  windings: { p10: 12, p50: 16, p90: 22 },
  props: { p10: 14, p50: 20, p90: 28 },
  actuators: { p10: 20, p50: 26, p90: 34 },
  thermal: { p10: 10, p50: 14, p90: 20 },
  harness: { p10: 8, p50: 11, p90: 16 },
  interior: { p10: 12, p50: 16, p90: 22 },
  gear: { p10: 16, p50: 22, p90: 30 },
  hardware: { p10: 2, p50: 4, p90: 8 },
  bearings: { p10: 10, p50: 14, p90: 20 },
  rawsmall: { p10: 3, p50: 5, p90: 8 },
  turbogen: { p10: 60, p50: 68, p90: 78 },
};
export type LeadClass = keyof typeof LEAD;

/** Forward price range as multipliers on today's price (p10, p90) over the next 12 months. */
export const PRICE_VOL: Record<string, [number, number]> = {
  stable: [0.98, 1.04],
  normal: [0.96, 1.07],
  volatile: [0.92, 1.16],
  cells: [0.93, 1.11],
  custom: [0.95, 1.08],
};
export type VolClass = keyof typeof PRICE_VOL;

export interface BuyRow {
  type: 'buy';
  code: ItemCode;
  name: string;
  group: CostGroup;
  itemGroup: string;
  supplier: SupplierId;
  price: number;
  lead: LeadClass;
  moq: number;
  vol: VolClass;
  uom: string;
  rev: string;
  kind: ItemKind;
  safety: boolean;
  /** A second qualified source: supplier, price multiplier against the primary, allocation share. */
  alt?: { supplier: SupplierId; priceFactor: number; share: number };
  status?: 'released' | 'proposed';
  /** Items that are not in any BOM yet (proposed by an open ECR). */
  prov: Provenance;
}

export interface MakeRow {
  type: 'make';
  code: ItemCode;
  name: string;
  group: CostGroup;
  itemGroup: string;
  workCenter?: string;
  hours: number;
  children: [ItemCode, number][];
  uom: string;
  rev: string;
  kind: ItemKind;
  safety: boolean;
  prov: Provenance;
}

export type Row = BuyRow | MakeRow;

interface BuyOpts {
  vol?: VolClass;
  uom?: string;
  rev?: string;
  kind?: ItemKind;
  safety?: boolean;
  alt?: BuyRow['alt'];
  status?: 'released' | 'proposed';
  prov?: Provenance;
}

export function buy(
  code: ItemCode, name: string, group: CostGroup, itemGroup: string, supplier: SupplierId,
  price: number, lead: LeadClass, moq = 1, o: BuyOpts = {},
): BuyRow {
  return {
    type: 'buy', code, name, group, itemGroup, supplier, price, lead, moq,
    vol: o.vol ?? 'normal', uom: o.uom ?? 'Nos', rev: o.rev ?? 'A',
    kind: o.kind ?? 'part', safety: o.safety ?? false, alt: o.alt, status: o.status, prov: o.prov ?? INV,
  };
}

interface MakeOpts {
  uom?: string;
  rev?: string;
  kind?: ItemKind;
  safety?: boolean;
  prov?: Provenance;
}

export function make(
  code: ItemCode, name: string, group: CostGroup, itemGroup: string,
  workCenter: string | undefined, hours: number, children: [ItemCode, number][], o: MakeOpts = {},
): MakeRow {
  return {
    type: 'make', code, name, group, itemGroup, workCenter, hours, children,
    uom: o.uom ?? 'Nos', rev: o.rev ?? 'A', kind: o.kind ?? 'assembly', safety: o.safety ?? false, prov: o.prov ?? INV,
  };
}
