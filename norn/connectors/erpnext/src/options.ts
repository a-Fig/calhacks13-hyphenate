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
    /** Name of the change order that released this BOM version (history reads only). */
    changeOrder?: string;
    /** Date the version was released (history reads only). Default: its creation date. */
    releasedOn?: string;
  };
  purchaseOrder?: {
    /** The company's own PO number, when ERPNext's differs (history reads only). */
    externalId?: string;
  };
  /** Ids other systems use for work centers, held on the Workstation. A workstation without a value keeps its name. */
  workCenter?: {
    externalId?: string;
  };
}

/** Where the volume plan and built aircraft come from when ERPNext holds none of them. */
export interface Fallback {
  volumePlan?: VolumeRow[];
  builtAircraft?: BuiltUnit[];
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
