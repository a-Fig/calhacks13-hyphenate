// Fern's ERPNext connector. It reads the production baseline, the history and the ERP change package of a released ECO
// (what a person enters in ERPNext, checked against what is there). Its one write is draft.ts: since Tyler's call of
// 2026-10-25 (reversing #71) it saves the package's BOM versions and journal entries as unsubmitted drafts, which a person
// submits. Everything company-specific is in the options; see options.ts.
import type { ItemCode } from './baseline.ts';
import type { ErpnextOptions } from './options.ts';
import { bomVersions, openOrders, priceHistory, realisedLeadTimes } from './history.ts';
import { buildErpChangePackage } from './package.ts';
import type { EcoRelease } from './package.ts';
import { readBaseline } from './read.ts';

export type * from './baseline.ts';
export type { ErpnextOptions, ErpnextSettings, ErpnextConnection, ReadOptions, CustomFieldNames, Fallback, StockLocationKey, PackageSettings, SupplierConstraintSource } from './options.ts';
export type { ReadResult, PartSource } from './read.ts';
export type {
  BomLineChange, ChangeLine, EcoJournal, EcoRelease, ErpChangePackage, ErpField, ErpTable, LineKind, LineMode, LineStatus, LineTrace, ProgramEffect,
} from './package.ts';
export type { BomVersion, DocRef, LeadTime, OpenOrder, PricePoint } from './history.ts';
export { ErpnextError } from './client.ts';
export { connectionFromEnv, loadEnvFile } from './env.ts';
export { canonicalJson, explodeQty, hashOf, mapSupplierConstraints, readBaseline, today, validOn } from './read.ts';
export { diffSupplierConstraints, expectedSupplierConstraints } from './compare.ts';
export type { ReferenceConstraint } from './compare.ts';
export { bomVersions, openOrders, priceHistory, realisedLeadTimes } from './history.ts';
export { buildErpChangePackage, formatErpChangePackage } from './package.ts';
export { deskUrl, draftErpChangePackage, planDrafts } from './draft.ts';
export type { DraftPlan, DraftResult, PlannedDraft } from './draft.ts';

/** The five reads and the ERP change package, bound to one set of options. */
export function connect(opts: ErpnextOptions) {
  return {
    readBaseline: () => readBaseline(opts),
    priceHistory: (item: ItemCode, priceList?: string) => priceHistory(opts, item, priceList),
    realisedLeadTimes: (item: ItemCode) => realisedLeadTimes(opts, item),
    openOrders: (item: ItemCode) => openOrders(opts, item),
    bomVersions: (item: ItemCode) => bomVersions(opts, item),
    erpChangePackage: (release: EcoRelease) => buildErpChangePackage(opts, opts, release),
  };
}
