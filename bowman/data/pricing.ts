// Price paths: contract price by effective date for the items whose history matters. Everything in
// the purchase-order history is generated from these. The last point of each path is today's
// price. Paths marked with an ECO reproduce the unit-price movement in history.ts.

export type PricePoint = [date: string, price: number];

export const PRICE_PATHS: Record<string, PricePoint[]> = {
  // ECO-0231: ceramic bearings
  'BW-3140-100': [['2025-01-01', 935], ['2025-10-20', 1120]],
  'BW-3240-100': [['2025-01-01', 685], ['2025-10-20', 860]],
  // ECO-0244: busbar, first lot premium then yield improvement
  'BW-6122-100': [['2025-01-01', 1712], ['2026-01-05', 1505], ['2026-03-15', 1430]],
  // ECO-0256: tilt actuator second sensor
  'BW-8110-100': [['2025-01-01', 17990], ['2026-01-20', 19400]],
  // ECO-0271: bracket Rev A to Rev B. Lot 1 and lot 2 premiums, then steady state at the new standard.
  'BW-5120-210': [['2025-01-01', 175.2], ['2026-01-10', 201.5], ['2026-02-10', 188.9], ['2026-03-20', 186.4]],
  // ECO-0285: display
  'BW-7110-100': [['2025-01-01', 32400], ['2026-02-15', 33000]],
  // ECO-0297: sleeve
  'BW-3126-100': [['2025-01-01', 590], ['2026-06-20', 710]],
  // ECO-0309: cell screening, plus the general cell price
  'BW-6110-100': [['2025-01-01', 10.27], ['2026-07-10', 11.1]],
  // ECO-0318: keyed connector
  'BW-3190-100': [['2025-01-01', 400.6], ['2026-07-25', 420]],
  // ECO-0326: pump
  'BW-8210-110': [['2025-01-01', 3188], ['2026-09-30', 3400]],
  // ECO-0314: fastener kit
  'BW-9610-100': [['2025-01-01', 11738], ['2026-06-15', 11700]],
  // Commodity-driven paths
  'BW-1910-100': [['2025-01-01', 84.5], ['2025-07-01', 87], ['2026-01-01', 90], ['2026-07-01', 92]],
  'BW-3120-340': [['2025-01-01', 7120], ['2025-07-01', 7350], ['2026-01-01', 7800], ['2026-07-01', 8000]],
  'BW-3220-340': [['2025-01-01', 4260], ['2025-07-01', 4400], ['2026-01-01', 4620], ['2026-07-01', 4800]],
  'BW-5110-100': [['2025-01-01', 2780], ['2025-07-01', 2650], ['2026-01-01', 2600], ['2026-07-01', 2550]],
  'BW-5210-100': [['2025-01-01', 2090], ['2025-07-01', 2000], ['2026-01-01', 1960], ['2026-07-01', 1920]],
};

/** Items that get a purchase-order history (the rest carry only today's quote). */
export const KEY_ITEMS: string[] = [
  'BW-3120-340', 'BW-3220-340', 'BW-6110-100', 'BW-1910-100', 'BW-5110-100', 'BW-5210-100', 'BW-5120-210',
  'BW-7200-100', 'BW-7110-100', 'BW-7210-100', 'BW-8110-100', 'BW-3140-100', 'BW-3240-100', 'BW-6122-100',
  'BW-3126-100', 'BW-3190-100', 'BW-8210-110', 'BW-9610-100', 'BW-1110-100', 'BW-1120-100', 'BW-4110-100',
  'BW-4120-100', 'BW-3110-100', 'BW-3210-100', 'BW-6140-100', 'BW-9110-100', 'BW-2100-100', 'BW-8230-100',
  'BW-8280-100', 'BW-9420-100', 'BW-1215-100', 'BW-4220-100', 'BW-4230-100', 'BW-9440-030', 'BW-8220-110',
];
