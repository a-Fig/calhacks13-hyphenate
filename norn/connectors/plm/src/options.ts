// Everything that differs from one company's PLM to the next. The connector code names no company; a
// company supplies these values in its own Norn config (see the PLM settings file there).
//
// The PLM is a Frappe site whose ECR, ECO and Comment records are reached over REST. The spelled-out
// values its people read ("Urgent", "Class I", "Set quantity") are mapped back here to the values the
// checks library uses.

import type { BomChange, CostBasis, Disposition, EffectivityPoint, ItemChange, ProgramId, StockLocation, SupplierId } from '../../../checks/src/types.ts';

export type Priority = 'emergency' | 'urgent' | 'routine';
export type CompanyClass = 'I' | 'II';
export type FaaClass = 'minor' | 'major';

export interface PlmSettings {
  /** The integration user's login. Change requests it last modified are its own writes, which the poller skips. */
  nornUser: string;
  /** PLM program label to the checks' program id. */
  programs: Record<string, ProgramId>;
  priorities: Record<string, Priority>;
  companyClasses: Record<string, CompanyClass>;
  faaClasses: Record<string, FaaClass>;
  /** Affected-item change type. */
  itemOps: Record<string, ItemChange['op']>;
  bomOps: Record<string, BomChange['op']>;
  /** Effectivity basis, for production and retrofit. */
  effectivityBasis: Record<string, EffectivityPoint['basis']>;
  /** Inventory location, as the form's pick list spells it. */
  locations: Record<string, StockLocation>;
  dispositions: Record<string, Disposition>;
  /** Who stands behind a cost-page number. */
  costBasis: Record<string, CostBasis>;
  /** A supplier quote's firmness, as the form's pick list spells it. Optional: a PLM without the field leaves it unset and the checks read the quote's note. */
  firmness?: Record<string, 'firm' | 'budgetary'>;
  /** Review function the CM analyst routed the request to, to the company's own id. Default: the PLM's label. */
  reviewFunctions?: Record<string, string>;
  /**
   * Supplier as the PLM names it on a quote, to the id the checks use. The ERP connector identifies a
   * supplier by its ERP name, so this is the ERP's name for it. Default: the PLM's name as is.
   */
  supplier?: Record<string, SupplierId> | ((plmName: string) => SupplierId);
  webhook?: {
    /** Header that names the event. The body names it too; when both are present they must agree. */
    eventHeader?: string;
  };
}

export interface PlmConnection {
  /** Base URL, e.g. https://plm.example.test. */
  url: string;
  apiKey: string;
  apiSecret: string;
  /** Per-request timeout. Default 30 s. */
  timeoutMs?: number;
}

export type PlmOptions = PlmSettings & PlmConnection;
