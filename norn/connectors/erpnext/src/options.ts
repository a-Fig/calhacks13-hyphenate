// Everything that differs from one company's ERPNext to the next. The connector code names no
// company; a company supplies these values in its own Norn config (see the ERPNext settings file there).

import type { BuiltUnit, ItemCode, VolumeRow } from './baseline.ts';

/** The four warehouse-backed places in `StockRow`. On order and in the field are derived, not warehouses. */
export type StockLocationKey = 'stores' | 'wip' | 'finishedGoods' | 'supplierFinished';

/**
 * Names of the custom fields a company added to ERPNext doctypes. Each is optional: leave one out and
 * the connector uses the stated default.
 */
export interface CustomFieldNames {
  item?: {
    /** Item revision. Default: empty string. */
    revision?: string;
    /** Item lifecycle status; the value `proposed` marks a proposed item. Default: a disabled item is proposed. */
    status?: string;
    /** Comma-separated program ids the item belongs to. On a top item it names that program. Default: the item code. */
    programs?: string;
  };
  /** On Item Price rows of the supplier price list. */
  quote?: {
    /** Default for each of the six range fields: the row's own rate (price) or lead_time_days / 7. */
    priceP10?: string;
    priceP90?: string;
    leadWeeksP10?: string;
    leadWeeksP90?: string;
    /** Default: qualified. */
    qualified?: string;
    /** Default: the first row per item is primary. */
    primary?: string;
    /** Share of demand, 0-1. Default: 1 for the primary row, 0 for the others. */
    allocation?: string;
  };
  bom?: {
    /** Name of the change order that released this BOM version. History reads, and the change package's tag. */
    changeOrder?: string;
    /** Date the version was released. History reads, and the change package asks for it. Default: its creation date. */
    releasedOn?: string;
    /** Link to the Norn decision that caused the version. Change package only; a BOM has no free-text field to fall back on. */
    decision?: string;
  };
  /** Change package: tags a person enters on the Item Price rows of an ECO. Norn reads them to recognise the entry. */
  itemPrice?: {
    /** Change order that caused the row. Required for a change package: it is how Norn finds the row once it is entered. */
    changeOrder?: string;
    /** Link to the Norn decision (the row's `note` also says it in words). */
    decision?: string;
  };
  /** Change package: tags a person enters on the Journal Entries of an ECO. Norn reads them to recognise the entry. */
  journalEntry?: {
    /** Change order that caused the entry. Required for a change package. */
    changeOrder?: string;
    /** Which of the release's entries this is (its `key`). Required for a change package: with the change order it identifies the entry. */
    entry?: string;
    /** Link to the Norn decision. */
    decision?: string;
  };
  purchaseOrder?: {
    /** The company's own PO number, when ERPNext's differs (history reads only). */
    externalId?: string;
  };
}

/** Where the volume plan and built aircraft come from when ERPNext holds none of them. */
export interface Fallback {
  volumePlan?: VolumeRow[];
  builtAircraft?: BuiltUnit[];
}

/** What the ERP change package needs beyond the read settings. */
export interface PackageSettings {
  /**
   * ERPNext account for each role a release's journal lines name (for example scrapExpense, inventoryReserve,
   * accruedLiability). The roles are the company's to define; the connector only looks them up.
   */
  accounts: Record<string, string>;
  /** Cost center for the profit-and-loss rows. Default: ERPNext fills the company's default. */
  costCenter?: string;
}

export interface ErpnextSettings {
  /** ERPNext Company the baseline is read for. */
  company: string;
  /** Item Price list holding every item's standard cost (make items too). */
  standardCostPriceList: string;
  /** Item Price list holding supplier quotes: one row per item and supplier. */
  supplierPriceList: string;
  /** Warehouse name to the stock location it counts as. Warehouses not listed are ignored. */
  warehouses: Record<string, StockLocationKey>;
  /**
   * True when units in the `supplierFinished` warehouse are also still on their open purchase orders, so
   * they sit in the Bin's ordered quantity too. On order is then ordered minus supplier-finished, so they
   * are not counted twice. Default: false, on order is the ordered quantity.
   */
  supplierFinishedOnOpenOrders?: boolean;
  /** IANA time zone the company dates its records in; decides "today" when no `asOf` is given. Default: this machine's. */
  timeZone?: string;
  /** Item group whose items are a program's top item (the finished product). */
  programItemGroup: string;
  /** Program display name from its top item's name. Default: the item name. */
  programName?: (itemName: string, itemCode: ItemCode) => string;
  /** Serial No to the integer serial the checks use. Default: the trailing digits of the serial number. */
  serialNumber?: (serialNo: string) => number | undefined;
  customFields?: CustomFieldNames;
  /** Only needed to build the ERP change package of a released ECO (package.ts). */
  changePackage?: PackageSettings;
  /**
   * Master Production Schedule to read the volume plan from. Default: the company's most recently
   * modified one.
   */
  productionSchedule?: string;
  /** Used for a part ERPNext returns nothing for (not for a failed read). The result says which source was used. */
  fallback?: Fallback;
}

export interface ErpnextConnection {
  /** Base URL, e.g. https://erp.example.test. */
  url: string;
  apiKey: string;
  apiSecret: string;
  /** Per-request timeout. Default 30 s. */
  timeoutMs?: number;
}

export interface ReadOptions {
  /** Date the baseline is read as of, 'YYYY-MM-DD': decides which price rows are current. Default: today. */
  asOf?: string;
}

export type ErpnextOptions = ErpnextSettings & ErpnextConnection & ReadOptions;
