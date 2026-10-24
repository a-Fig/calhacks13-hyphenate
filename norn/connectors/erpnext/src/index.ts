// Norn's ERPNext connector (read side). Everything company-specific is in the options; see options.ts.
import type { ItemCode } from './baseline.ts';
import type { ErpnextOptions } from './options.ts';
import { bomVersions, openOrders, priceHistory, realisedLeadTimes } from './history.ts';
import { readBaseline } from './read.ts';
import { applyEcoRelease, planEcoRelease } from './write.ts';
import type { EcoPlan, EcoRelease } from './write.ts';

export type * from './baseline.ts';
export type { ErpnextOptions, ErpnextSettings, ErpnextConnection, ReadOptions, CustomFieldNames, Fallback, StockLocationKey, WriteSettings } from './options.ts';
export type { ReadResult, PartSource } from './read.ts';
export type { ApplyOptions, ApplyResult, BomLineChange, EcoJournal, EcoPlan, EcoRelease, PlanEffect, PlanStep, StepKind, Written } from './write.ts';
export type { BomVersion, DocRef, LeadTime, OpenOrder, PricePoint } from './history.ts';
export { ErpnextError } from './client.ts';
export { connectionFromEnv, loadEnvFile } from './env.ts';
export { canonicalJson, explodeQty, hashOf, readBaseline, validOn } from './read.ts';
export { bomVersions, openOrders, priceHistory, realisedLeadTimes } from './history.ts';
export { EcoApplyError, EcoPlanError, applyEcoRelease, formatPlan, planEcoRelease } from './write.ts';

/** The five reads, and the ECO write-back, bound to one set of options. */
export function connect(opts: ErpnextOptions) {
  return {
    readBaseline: () => readBaseline(opts),
    priceHistory: (item: ItemCode, priceList?: string) => priceHistory(opts, item, priceList),
    realisedLeadTimes: (item: ItemCode) => realisedLeadTimes(opts, item),
    openOrders: (item: ItemCode) => openOrders(opts, item),
    bomVersions: (item: ItemCode) => bomVersions(opts, item),
    planEcoRelease: (release: EcoRelease) => planEcoRelease(opts, opts, release),
    applyEcoRelease: (plan: EcoPlan) => applyEcoRelease(opts, opts, plan),
  };
}
