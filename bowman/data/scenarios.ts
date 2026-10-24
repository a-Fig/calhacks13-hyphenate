import type { Scenario } from './types.ts';
import { INV, PRACTICE, inv, src } from './prov.ts';
import { stock } from './derive.ts';

// Answer key for the five demo scenarios. Nothing here is an input to Norn.

const bracket = stock.find((s) => s.item === 'BW-5120-210')!;
const PERF = 12; // brackets per aircraft
const NEW = 221.0;
const OLD = 186.4;
const SALVAGE = 2.85; // per scrapped bracket ($718 on 252 pieces in the source example)
const scrapQty = bracket.stores + bracket.wip + bracket.supplierFinished + bracket.inField;
const scrapCost = scrapQty * OLD - scrapQty * SALVAGE;
const cancelCost = bracket.onOrder * OLD * 0.1;
const oneTimeNre = 6800 + 4200 + 2600 + 15370 + 18500;
const retrofitParts = 120 * NEW;
const retrofitLabor = 10 * 12 * 110;
const r2 = (x: number) => Math.round(x * 100) / 100;

export const demoScenarios: Scenario[] = [
  {
    id: 'S1', title: 'Bracket Rev B to Rev C after a fatigue crack (ECR-0417)', ecrs: ['ECR-0417'], kind: 'worked_example',
    expect: [
      'Company Class I (cost and retrofit of built aircraft), FAA minor, set separately; urgent; justification D.',
      'The Halden quote is a given input; should-cost ($185.31 to $218.42 in the source) and the 90% learning curve are cross-checks only.',
      'Single source (Halden), plate lead time 6 weeks, first lot of 25 at $239.50 gives a purchase price variance of $18.50 per bracket against the new standard.',
      'Inventory: Rev B failed fatigue, so no use-up. Scrap stores, WIP, supplier-finished and every installed bracket; cancel the 60 not started at 10%. Use-up versus scrap is the biggest swing.',
      'Retrofit covers S/N 001-010 (120 brackets), not only the four test aircraft. Production cut-in S/N 011; S/N 011-014 wait at the controller-install station for about 14 weeks.',
      'Aircraft are held, so the delay cost of S/N 011-014 is a real line that the originator left blank.',
      'The bracket is also in eight Meridian aft lift controllers; Meridian has no hardware yet, so the change only moves its baseline cost by $34.60 x 8 per aircraft. A shared item, a second program, no retrofit.',
    ],
    reference: {
      steadyStateDeltaPerAircraftUsd: r2(PERF * (NEW - OLD)),
      oneTimeNreUsd: oneTimeNre,
      retrofitPartsUsd: retrofitParts,
      retrofitLaborUsd: retrofitLabor,
      brackets_scrapped: scrapQty,
      scrapNetOfSalvageUsd: r2(scrapCost),
      cancellationChargeUsd: r2(cancelCost),
      oneTimeTotalUsd: r2(oneTimeNre + retrofitParts + retrofitLabor + scrapCost + cancelCost),
    },
    prov: src(`${PRACTICE} §1`, 'Worked example, with retrofit scope and inventory adjusted to the dataset (10 built aircraft instead of 4).'),
  },
  {
    id: 'S2', title: 'Aft propellers from 2 to 4 blades (ECR-0409)', ecrs: ['ECR-0409'], kind: 'big_change',
    expect: [
      'Company Class I, FAA major (set separately), routine, justification O. Reopens 23 of 797 means-of-compliance items and issue paper IP-07.',
      'Per-propeller material change is +$1,440 (+$8,640 per aircraft, +0.3% of standard cost), tiny against $500k of tooling and about $650k of engineering: one-time cost dominates.',
      'The cut-in date is driven by certification, 6 to 12 months, not by the 34-week blade tooling alone. Earliest realistic cut-in S/N 034 (December 2027). Meridian is unaffected: it has its own lift rotors.',
      'Retrofit of built aircraft is unscoped and is the largest unknown. Inventory of 2-blade parts has no disposition.',
      'Hidden coupling (not detectable from shared entities): four blades change the aft-boom vibration spectrum that ECR-0417\'s bracket sits in. Interaction flags are best effort.',
    ],
    reference: { unitCostDeltaPerPropellerUsd: 1440, unitCostDeltaPerAircraftUsd: 8640, toolingUsd: 500000, engineeringUsd: 650000 },
    prov: inv('Anchored to the Archer 2-blade to 4-blade change (archer-public-data.md §1).'),
  },
  {
    id: 'S3', title: 'Internal panel colour change (ECR-0423)', ecrs: ['ECR-0423'], kind: 'fast_track',
    expect: [
      'Qualifies for fast track: Class II, FAA minor, not a safety-critical item, interchangeable, same supplier, no tooling, no first article, no retrofit.',
      'Saves $1.90 per panel, $11.40 per aircraft; about $274 a year at 24 aircraft and $7,400 a year at 650. Use up existing stock; no disposition cost.',
      'No CCB. The cost of convening a board would exceed the saving.',
    ],
    reference: { savingPerAircraftUsd: 11.4, savingYear2027Usd: r2(11.4 * 24), savingAtRateUsd: r2(11.4 * 650) },
    prov: inv('Planted trivial change.'),
  },
  {
    id: 'S4', title: 'Two ECRs that conflict on the same pump (ECR-0412 and ECR-0415)', ecrs: ['ECR-0412', 'ECR-0415'], kind: 'conflict',
    expect: [
      'Textual conflict: both revise BW-8210-110 from Rev B to Rev C, and set rated_flow_lpm (14.2 against 11.0), motor_power_w (240 against 150) and unit_price_usd (3,820 against 3,015) differently.',
      'The two directions are opposed: +$420 per pump for margin against -$385 per pump for cost. Merging both is meaningless; someone chooses.',
      'The cost-reduction ECR rests on TS-8210 rev 3 (10.5 L/min), which NCR-0112 shows is out of date (12.5 L/min needed in hot-and-high climb).',
      'The pump is shared with Meridian (two per aircraft), so the decision moves both programs.',
    ],
    reference: { deltaA_perAircraftUsd: 840, deltaB_perAircraftUsd: -770 },
    prov: inv('Planted same-item, same-field conflict.'),
  },
  {
    id: 'S5', title: 'Different parts, one supplier (ECR-0419 and ECR-0421)', ecrs: ['ECR-0419', 'ECR-0421'], kind: 'shared_supplier',
    expect: [
      'No shared entity: BW-3120-340 (Vesper forward magnets) and BW-M512-340 (Meridian cruise magnets) are different items in different programs. Both are bought from Orrin Magnetics, the single source for both.',
      'Both need the same new grade (UH) qualified in the same 2027-Q2 slot. Orrin runs one qualification lot per quarter, so one part number slips about 13 weeks to the 2027-Q3 slot unless sequenced.',
      'UH capacity is 1,200 sets per year on one furnace until 2028-Q3. Combined demand and the 24% extra furnace time per UH set matter.',
      'Combined effects differ from the sum: ordering both within 26 weeks earns a 6% UH raw-material price break and a 40% cheaper second qualification; a missed slot moves Vesper cut-in from S/N 030 (October 2027) to about S/N 037 (January 2028), or the Meridian rotor build and first flight (September 2027) back by a quarter.',
      'ECO-0297 (March 2026) already showed the same pattern: a seven-week wait for an Orrin qualification slot moved a cut-in by two aircraft.',
    ],
    reference: { vesperQualificationUsd: 96000, meridianQualificationUsd: 142000, secondQualificationDiscount: 0.4, rawMaterialPriceBreak: 0.06 },
    prov: inv('Planted shared-supplier interaction.'),
  },
  {
    id: 'B1', title: 'Lighting set filed as Class II (ECR-0406)', ecrs: ['ECR-0406'], kind: 'background',
    expect: [
      'Not eligible for fast track despite the Class II filing: the lighting set includes the emergency egress lighting (flight-safety item) and the connector changes from 6-pin to 8-pin, an interface change.',
      'Reclassify to Class I; saving is only $210 per aircraft, about $5,000 a year at 24 aircraft.',
    ],
    reference: { savingPerAircraftUsd: 210 },
    prov: inv('Background trap: a change that looks like ECR-0423 but is not.'),
  },
  {
    id: 'B2', title: 'Prepreg resin system change (ECR-0407)', ecrs: ['ECR-0407'], kind: 'background',
    expect: [
      'The originator\'s FAA-minor proposal is doubtful: a new resin system in primary composite structure needs new material allowables, so likely FAA major and 6 to 12 months of qualification across wing, tail and booms.',
      'Saving is -$2,096 per aircraft (524 kg at -$4.00), about $50k a year at 24 aircraft and $1.4M a year at 650; the qualification cost and the delay are not on the cost page.',
      'Meridian is unaffected: its structure is bought from Tarn, not laid up in-house.',
    ],
    reference: { savingPerAircraftUsd: 2096, savingYear2027Usd: 2096 * 24, savingAtRateUsd: 2096 * 650 },
    prov: inv('Background trap: a small unit saving with a large hidden qualification effort.'),
  },
  {
    id: 'B3', title: 'Remove the second DC-DC converter (ECR-0410)', ecrs: ['ECR-0410'], kind: 'background',
    expect: [
      'A pure saving on the cost page ($5,150 per aircraft, $3.3M a year at 650) but it removes redundancy on the 28 V flight-essential bus: system-safety change, FAA major, never fast-track.',
      'A single converter failure leaves only the backup batteries. Norn should flag the safety effect as a judgment, not net it into the saving.',
    ],
    reference: { savingPerAircraftUsd: 5150, savingAtRateUsd: 5150 * 650 },
    prov: inv('Background trap: cost reduction that cuts redundancy.'),
  },
];

export const scenarioProv = INV;
