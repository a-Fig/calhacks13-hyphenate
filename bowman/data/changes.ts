import type { CostLine, Ecr, Ncr } from './types.ts';
import { IMPACT, INV, PRACTICE, inv, src } from './prov.ts';

// Open NCRs and ECRs for the demo, written the way engineers write them, plus the structured
// ECP fields (DD Form 1692 / MIL-HDBK-61A Table 6-6). Today is 2026-10-24; the next CCB sits on
// 2026-11-12. Five scenarios, answer key in scenarios.ts:
//   1 ECR-0417  bracket Rev B to Rev C after NCR-0119 (the worked example)
//   2 ECR-0409  aft propellers from 2 blades to 4 (big, Class I, FAA major)
//   3 ECR-0423  internal panel colour change, same supplier, slightly cheaper (fast-track)
//   4 ECR-0412 + ECR-0415  conflicting changes to the same pump (same item, same fields)
//   5 ECR-0419 + ECR-0421  different parts (Vesper forward magnets, Meridian cruise magnets), one supplier (Orrin)

export const ncrs: Ncr[] = [
  {
    id: 'NCR-0112', openedOn: '2026-09-28', openedBy: 'EMP-06', item: 'BW-8210-110', rev: 'B',
    where: 'Hot-and-high climb test, S/N 004, battery loop',
    quantityAffected: 2,
    description:
      'Hot-and-high climb profile (45 C ambient, 6,000 ft, 24 kW per pack) on S/N 004. Battery loop flow measured 11.4 L/min on both pumps against 12.5 L/min needed to hold the module spread under 8 K. ' +
      'Hottest module reached 58 C at the end of climb against a 60 C limit, with the pump motors at 94% duty. We have no margin left for a 10 C hotter day. The pumps meet their own datasheet (12.0 L/min at 0.9 bar), so this is a requirement and sizing problem, not a pump defect. ' +
      'Test report TR-8210-14 attached.',
    mrbDisposition: 'Use as is. Restrict hot-day climb to 40 C ambient until the flow margin is fixed. Design to propose a change.',
    status: 'closed_to_ecr', linkedEcr: 'ECR-0412', prov: INV,
  },
  {
    id: 'NCR-0113', openedOn: '2026-09-30', openedBy: 'EMP-12', item: 'BW-4230-100', rev: 'A',
    where: 'Aft propeller teardown after 38 h hover time, S/N 003',
    quantityAffected: 12,
    description:
      'Aft propeller blade dampers show elastomer fretting at the blade-root interface after 38 h of hover time, on all six aft propellers of S/N 003. Wear depth 0.15 to 0.25 mm. The damper life is 25 h inspect, so this is inside the interval, but the trend says the elastomer will not make 100 h. ' +
      'Separately, the hover noise run on the same aircraft measured 2.1 dB over the community noise target at the 500 ft hover point. Each aft propeller carries two dampers weighing 0.21 kg, 2.5 kg per aircraft for all six.',
    mrbDisposition: 'Use as is with a 25 h inspection. Propulsion to propose a design change.',
    status: 'closed_to_ecr', linkedEcr: 'ECR-0409', prov: INV,
  },
  {
    id: 'NCR-0115', openedOn: '2026-10-02', openedBy: 'EMP-12', item: 'BW-3120-340', rev: 'A',
    where: 'Forward motor hot-day transition test, S/N 004 left forward motor',
    quantityAffected: 6,
    description:
      'After three hot-day transition cycles the left forward motor showed 0.8% irreversible flux loss. Magnet surface temperature peaked at 163 C during the transition (high torque, low airflow over the nacelle). ' +
      'SH grade is rated to 150 C continuous with the knee around 165 C at our operating field, so we are running too close. A second motor on the same aircraft saw 159 C and no loss. We cannot leave the margin this thin on a motor whose loss of torque trips the redundancy logic.',
    mrbDisposition: 'Use as is with a transition-thrust limit above 38 C ambient (software limit TL-212). Design to propose a magnet change.',
    status: 'closed_to_ecr', linkedEcr: 'ECR-0419', prov: INV,
  },
  {
    id: 'NCR-0119', openedOn: '2026-10-06', openedBy: 'EMP-12', item: 'BW-5120-210', rev: 'B',
    where: 'Aft motor-controller endurance rig, building 3, test cell 2',
    quantityAffected: 384,
    description:
      'Endurance profile EP-3 (20 h hover, transition and cruise duty cycle) on the aft motor-controller rig. At 8.2 h the vibration monitor on controller position 4 tripped. Teardown found a 14 mm crack at the lower fillet of the mounting bracket, from the flange edge into the web. ' +
      'Dye penetrant confirms. At the full 20 h, positions 1 and 5 also show crack indications at 10x, so 3 of 12 brackets on the rig have initiated. Fractography shows fatigue initiation at the fillet tangent with beach marks, no material or machining defect. ' +
      'The bracket failed the profile that its own Rev B change was supposed to fix: the 212 Hz mode moved to 241 Hz, but that now sits on the sixth electrical order of the aft motor at hover speed.',
    mrbDisposition:
      'MRB 2026-10-09: Rev B is not acceptable for flight. Rev B stock in stores, WIP kits and at the supplier is quarantined. S/N 001-004: flight restricted to 5 h between fillet inspections until retrofit. ' +
      'S/N 005-010: no flight. Controller installation is held on every aircraft that has not yet received controllers. Design to file an ECR for a replacement revision.',
    status: 'closed_to_ecr', linkedEcr: 'ECR-0417',
    prov: src(`${PRACTICE} §1`, 'Failure at 8.2 h of a 20 h endurance profile is the worked example. The quantity, rig positions and mode frequencies are invented.'),
  },
  {
    id: 'NCR-0124', openedOn: '2026-10-20', openedBy: 'EMP-12', item: 'BW-1160-100', rev: 'A',
    where: 'Water ingress test, S/N 009, cabin door',
    quantityAffected: 2,
    description:
      'Water-spray test (heavy rain, 20 min) on S/N 009 left door: weeping at the lower hinge corner, about 30 ml collected under the door sill. Right door dry. Seal compression measured at the lower corner is 1.1 mm against 1.8 mm nominal. ' +
      'Looks like a corner gap in the door frame bond rather than the seal itself. Photos and measurement sheet attached.',
    mrbDisposition: 'Pending. Rework of the sill bond is being evaluated; no ECR yet.',
    status: 'open', prov: inv('Background open NCR with no ECR yet; shows the NCR to ECR pipeline.'),
  },
];

// ---------------------------------------------------------------- helpers

const line = (label: string, basis: CostLine['basis'], o: Partial<CostLine> = {}): CostLine => ({ label, basis, ...o });
const blank = (label: string, note?: string): CostLine => line(label, 'not_provided', note ? { note } : {});

const FULL_ROUTE: Ecr['routedTo'] = ['cost_engineer', 'buyer', 'production_planner', 'cost_accountant', 'quality', 'certification', 'manufacturing_engineer'];

// ---------------------------------------------------------------- ECRs

export const ecrs: Ecr[] = [
  // ---------------------------------------------------------------- scenario 1: the worked example
  {
    id: 'ECR-0417', rev: 'A',
    title: 'Motor-controller mounting bracket BW-5120-210, Rev B to Rev C: fillet fatigue crack',
    status: 'submitted', program: 'vesper', originator: 'EMP-03', filedOn: '2026-10-19', neededBy: '2026-11-12', originatingNcr: 'NCR-0119',
    priority: 'urgent', justificationCode: 'D', companyClass: 'I', faaClass: 'minor',
    faaRationale:
      'Secondary structure that supports the controller only. Rev C is strictly stiffer with the same envelope and interfaces, mass up 0.12 kg per bracket, so no appreciable effect on weight, balance, strength, reliability or operating characteristics. ' +
      'Proposed minor under 14 CFR 21.93(a); the classification is Bowman\'s call as design approval holder and is pending Gideon\'s sign-off.',
    classificationNote: 'Class I because of cost and retrofit of aircraft already built. FAA minor. The two classifications are separate and disagree here.',
    description:
      'Replace the machined 7075 mounting bracket BW-5120-210 Rev B with Rev C on all twelve motor controllers (six forward, six aft). Rev C changes: plate stock 1.0 in to 1.25 in, web 5 mm to 8 mm, lower fillet radius 3 mm to 6 mm. ' +
      'Outer envelope, the four mounting holes and the isolator pattern do not change, so Rev C is interchangeable with Rev B at the controller and the harness. Mass goes from 0.41 kg to 0.53 kg per bracket (+1.4 kg per aircraft). ' +
      'Halden has quoted Rev C at $221.00 steady state, $239.50 for the first lot of 25, plus fixture and programming costs. Rev B has been the production revision since S/N 005 and is installed on S/N 001-010.',
    need:
      'NCR-0119: crack at the lower fillet at 8.2 h of the 20 h endurance profile; three of twelve rig brackets have initiated by 20 h. The Rev B stress check used a 212 Hz forcing line that Rev B did move, but the sixth electrical order of the aft motor at hover speed sits at 241 Hz, right on the new mode. ' +
      'Rev C moves the mode to 318 Hz, clear of every forcing line up to the 9th order, and the stress report supplement shows a fatigue margin of +14% at the fillet against -31% for Rev B.',
    consequencesIfDisapproved:
      'No aircraft can fly beyond the 5 h inspection interval with Rev B. S/N 001-004 are the certification flight-test aircraft, so the flight-test campaign stops. S/N 005-010 cannot be delivered, and controller installation stays held on every aircraft still in build.',
    alternativesConsidered:
      '(1) Shot-peen the Rev B fillets: analysis gives +9% fatigue margin, not enough. (2) Add a doubler plate: adds a part and a bond, interferes with the cold-plate hose, and needs its own qualification. ' +
      '(3) Change the isolator durometer to move the mode: it moves the mode below the forcing line at hover but onto the 4th order at transition. (4) Do nothing and inspect every 5 h: not viable for a production aircraft.',
    failureData:
      'Rig EP-3, controller position 4: crack at 8.2 h, 14 mm from flange edge into web. Positions 1 and 5: indications at 20 h. Fractography: fatigue initiation at fillet tangent, beach marks, no defect. Rev A to Rev B (ECO-0271) addressed a different mode at 212 Hz.',
    testAndQualification:
      'Vibration re-qualification on the endurance rig: 20 h EP-3 profile plus a 2x margin run. Delta first-article inspection at Halden. Stress report supplement already drafted. No FAA project if classified minor.',
    itemChanges: [
      {
        item: 'BW-5120-210', op: 'revise', fromRev: 'B', toRev: 'C',
        changes: [
          { field: 'plate_thickness_in', from: 1.0, to: 1.25 },
          { field: 'web_thickness_mm', from: 5, to: 8 },
          { field: 'fillet_radius_mm', from: 3, to: 6 },
          { field: 'mass_kg', from: 0.41, to: 0.53 },
          { field: 'unit_price_usd', from: 186.4, to: 221.0 },
        ],
      },
    ],
    bomChanges: [],
    supplierQuotes: [
      {
        id: 'Q-HAL-26-1187', supplier: 'SUP-HALDEN', item: 'BW-5120-210', receivedOn: '2026-10-16', validUntil: '2027-01-15',
        lines: [
          { description: 'Rev C bracket, steady state, lots of 100 and above', unitPrice: 221.0 },
          { description: 'Rev C bracket, first lot of 25 pieces', unitPrice: 239.5, qty: 25 },
          { description: 'Fixture and CMM programs', oneTime: 6800 },
          { description: 'NC programming', oneTime: 4200 },
          { description: 'Delta first-article inspection (AS9102)', oneTime: 2600 },
          { description: 'Open PO 120 pieces Rev B: cancellation charge for pieces not started, 10% of price', unitPrice: 18.64, qty: 60 },
        ],
        leadTimeWeeks: 14,
        note: 'Plate stock lead time 6 weeks, in parallel with fixture build of 8 weeks; 4 weeks of machining and inspection after both. First lot ships about 14 weeks after PO.',
      },
    ],
    effectivity: {
      production: {
        basis: 'serial', from: '11',
        note: 'S/N 011 and subsequent. Controller installation is the last station before ground power-up, so S/N 011-014 are built to that station and held until Rev C arrives.',
      },
      retrofit: {
        basis: 'serial', from: '1', to: '10',
        note: 'Remove Rev B and install Rev C on S/N 001-004 (flight test) and S/N 005-010 (in hangar, undelivered). 12 brackets per aircraft, 12 h labor per aircraft.',
      },
      interchangeable: true,
    },
    inventoryProposal: [
      { item: 'BW-5120-210', location: 'stores', disposition: 'scrap', note: 'Quarantined by MRB. Failed fatigue, so no use-up.' },
      { item: 'BW-5120-210', location: 'wip', disposition: 'scrap', note: 'Kits staged for S/N 011-014.' },
      { item: 'BW-5120-210', location: 'supplier_finished', disposition: 'scrap', note: '60 finished at Halden, not shipped.' },
      { item: 'BW-5120-210', location: 'on_order', disposition: 'cancel', note: '60 not started; Halden quotes a 10% cancellation charge.' },
      { item: 'BW-5120-210', location: 'in_field', disposition: 'mandatory_install', note: 'Replace Rev B on S/N 001-010 with Rev C; returned Rev B is scrapped.' },
    ],
    costPage: {
      production: [
        line('Bracket unit cost, Rev C steady state vs Rev B', 'supplier_quote', { unitCost: 34.6, note: '$221.00 vs $186.40 per bracket, 12 per aircraft. First lot of 25 at $239.50.' }),
        line('Special tooling and fixtures (Halden fixture and CMM programs)', 'supplier_quote', { oneTime: 6800 }),
        line('NC programming (Halden)', 'supplier_quote', { oneTime: 4200 }),
        line('Delta first-article inspection (Halden)', 'supplier_quote', { oneTime: 2600 }),
        line('Engineering and data revision: 106 h (stress 60, drawing 12, other 34)', 'engineer_estimate', { oneTime: 15370, note: '106 h at $145.' }),
        line('Qualification: vibration re-test on the endurance rig', 'engineer_estimate', { oneTime: 18500 }),
        blank('Scrap and write-off of Rev B inventory'),
      ],
      retrofit: [
        line('Rev C brackets for retrofit, S/N 001-010', 'supplier_quote', { unitCost: 221, quantity: 120 }),
        line('Installation labor, 12 h per aircraft at $110', 'engineer_estimate', { unitCost: 1320, quantity: 10 }),
        blank('Re-inspection and test after retrofit'),
      ],
      logisticsSupport: [blank('Spares, maintenance manual task update, training', 'Maintenance manual task 24-31 changes the torque table; nothing else assessed.')],
      other: [blank('Delay cost of holding S/N 011-014 at the controller-install station', 'Planner to estimate.')],
    },
    routedTo: FULL_ROUTE, clarity: 'detailed',
    prov: src(`${PRACTICE} §1; ${IMPACT} §6`, 'Part, prices, quote, tooling, qualification and engineering hours are the illustrative worked example. Volumes and scope adjusted to the volume plan: retrofit covers 10 built aircraft (not 4), production cut-in S/N 011.'),
  },

  // ---------------------------------------------------------------- scenario 2: aft propellers 2 to 4 blades
  {
    id: 'ECR-0409', rev: 'A',
    title: 'Aft lift propellers: 2 blades with dampers to 4 blades without',
    status: 'submitted', program: 'vesper', originator: 'EMP-04', filedOn: '2026-10-05', neededBy: '2026-12-10', originatingNcr: 'NCR-0113',
    priority: 'routine', justificationCode: 'O', companyClass: 'I', faaClass: 'major',
    faaRationale:
      'Changes the propeller type design, its vibration and flutter characteristics, noise, and lift-system performance. Reopens 23 of the 797 means-of-compliance items and issue paper IP-07 (propeller and rotor). Needs an FAA project; major under 14 CFR 21.93(a).',
    classificationNote: 'Not interchangeable with the 2-blade assembly. Gideon to confirm the issue-paper impact; the 23-item figure is engineering\'s count.',
    description:
      'Replace the six 2-blade aft propellers (BW-4200-000) with 4-blade fixed-pitch propellers and remove the two blade dampers on each. New parts: 4-blade hub BW-4210-200, blade BW-4220-200 (four per propeller), spinner cap BW-4240-200. Removed from the assembly: 2-blade hub BW-4210-100, blade BW-4220-100, damper BW-4230-100, spinner BW-4240-100. ' +
      'The lock actuator BW-4250-100 stays. Tip speed drops 6% at the same hover thrust, so the aft motor runs at lower speed and higher torque; no hardware change to the aft motor, but the controller current limit and the hover software table need a new calibration. ' +
      'Net mass change -1.7 kg per aircraft (dampers out 2.5 kg, hubs and extra blades in 0.8 kg).',
    need:
      'NCR-0113: damper elastomer fretting after 38 h, trend says it will not reach 100 h, and the 2.1 dB hover noise exceedance at the 500 ft point. Four blades at lower tip speed gives an estimated 3.4 dB reduction and 3.1% better hover efficiency from lower disk loading per blade, and removes the dampers entirely. ' +
      'Launch customers have community noise commitments that depend on closing the 2.1 dB gap.',
    consequencesIfDisapproved:
      'The dampers stay as a 25 h inspect item with a life of perhaps 60 h, the noise gap stays open, and two launch customers\' noise requirements are at risk. We would need a redesigned damper (6 months) just to stand still.',
    alternativesConsidered:
      '3-blade: 1.1 dB gain only and still needs dampers. 2-blade with a new damper: no noise gain. 4-blade chosen. The aft propellers are locked and faired in cruise so the extra blades add no cruise drag, but the lock position and fairing cap need re-design for four blades. ' +
      'Not re-assessed: the aft-boom vibration spectrum changes with four blades (blade-pass content moves), so the structures group should re-run the aft-boom and controller-bracket vibration survey.',
    failureData: 'See NCR-0113. Damper wear 0.15 to 0.25 mm after 38 h on S/N 003, all six aft propellers; hover noise 2.1 dB over target on the same aircraft.',
    testAndQualification:
      'New blade mould set, whirl-tower and flutter test of the 4-blade rotor, noise measurement campaign, hover performance flight test (about 12 sorties), reopen compliance for the listed means-of-compliance items. Engineering estimate 6 to 12 months from approval to FAA acceptance.',
    itemChanges: [
      { item: 'BW-4200-000', op: 'revise', fromRev: 'A', toRev: 'B', changes: [{ field: 'blade_count', from: 2, to: 4 }, { field: 'dampers', from: 2, to: 0 }, { field: 'mass_kg', from: 9.8, to: 8.1 }] },
      { item: 'BW-4210-200', op: 'add', toRev: 'A', changes: [{ field: 'name', from: null, to: 'Propeller hub, 4-blade fixed pitch' }, { field: 'unit_price_usd', from: null, to: 3950 }] },
      { item: 'BW-4220-200', op: 'add', toRev: 'A', changes: [{ field: 'name', from: null, to: 'Propeller blade, aft 4-blade, carbon' }, { field: 'unit_price_usd', from: null, to: 930 }] },
      { item: 'BW-4240-200', op: 'add', toRev: 'A', changes: [{ field: 'name', from: null, to: 'Spinner and fairing cap (aft, 4-blade)' }, { field: 'unit_price_usd', from: null, to: 330 }] },
    ],
    bomChanges: [
      { op: 'remove', parent: 'BW-4200-000', child: 'BW-4210-100', qtyFrom: 1 },
      { op: 'remove', parent: 'BW-4200-000', child: 'BW-4220-100', qtyFrom: 2 },
      { op: 'remove', parent: 'BW-4200-000', child: 'BW-4230-100', qtyFrom: 2 },
      { op: 'remove', parent: 'BW-4200-000', child: 'BW-4240-100', qtyFrom: 1 },
      { op: 'add', parent: 'BW-4200-000', child: 'BW-4210-200', qtyTo: 1 },
      { op: 'add', parent: 'BW-4200-000', child: 'BW-4220-200', qtyTo: 4 },
      { op: 'add', parent: 'BW-4200-000', child: 'BW-4240-200', qtyTo: 1 },
    ],
    supplierQuotes: [
      {
        id: 'Q-HV-4417', supplier: 'SUP-HALVORSEN', item: 'BW-4220-200', receivedOn: '2026-10-02', validUntil: '2026-12-31',
        lines: [
          { description: 'Hub, 4-blade fixed pitch (BW-4210-200)', unitPrice: 3950 },
          { description: 'Blade, 4-blade, carbon (BW-4220-200), minimum 8', unitPrice: 930 },
          { description: 'Spinner cap (BW-4240-200)', unitPrice: 330 },
          { description: 'New blade mould set', oneTime: 410000 },
          { description: 'Hub forging tooling', oneTime: 90000 },
        ],
        leadTimeWeeks: 34,
        note: 'Budgetary, plus or minus 20%. 34 weeks to first articles. Production lead time 20 weeks after approval of first articles.',
      },
    ],
    effectivity: {
      production: { basis: 'tbd', from: 'tbd', note: 'After FAA acceptance of the major change. Engineering suggests S/N 031 (about November 2027) if certification testing goes to plan.' },
      retrofit: { basis: 'tbd', from: 'tbd', note: 'Engineering recommends a retrofit kit for built aircraft S/N 005-030 before entry into service. Test aircraft S/N 001-004 excluded. Not assessed.' },
      interchangeable: false,
    },
    inventoryProposal: [
      { item: 'BW-4210-100', location: 'stores', disposition: 'tbd', note: 'Use until cut-in, then decide.' },
      { item: 'BW-4220-100', location: 'stores', disposition: 'tbd' },
      { item: 'BW-4230-100', location: 'stores', disposition: 'tbd', note: 'Dampers still needed for 2-blade aircraft in service.' },
    ],
    costPage: {
      production: [
        line('Aft propeller unit cost, 4-blade vs 2-blade (per propeller)', 'supplier_quote', { unitCost: 1440, quantity: 6, note: 'Budgetary. About $8,600 per aircraft.' }),
        line('Blade mould set and hub forging tooling', 'supplier_quote', { oneTime: 500000 }),
        line('Engineering and certification, about 4,500 h', 'engineer_estimate', { oneTime: 650000 }),
        blank('Whirl-tower, flutter and noise testing'),
        blank('Hover performance flight test'),
        blank('Scrap and write-off of 2-blade inventory'),
      ],
      retrofit: [blank('Retrofit kits and installation', 'Retrofit recommended for S/N 005-030; not scoped.')],
      logisticsSupport: [blank('Spares, manuals, training, support equipment')],
      other: [blank('Aft motor controller recalibration and hover table')],
    },
    routedTo: FULL_ROUTE, clarity: 'typical',
    prov: src('docs/research/archer-public-data.md §1', 'Aft propeller 2 to 4 blades follows the real Archer design change (Q4 2025 letter: "chose four blades"). Costs, test scope, noise figures invented.'),
  },

  // ---------------------------------------------------------------- scenario 3: fast-track colour change
  {
    id: 'ECR-0423', rev: 'A',
    title: 'Avionics bay closeout panel BW-9440-030: grey to charcoal',
    status: 'submitted', program: 'vesper', originator: 'EMP-07', filedOn: '2026-10-22', neededBy: '2026-11-05',
    priority: 'routine', justificationCode: 'R', companyClass: 'II', faaClass: 'minor',
    faaRationale: 'Colour masterbatch only. Same base resin, same thickness, same flame-test certificate (supplier letter attached). Non-structural, not a flame barrier. No effect on weight, strength or airworthiness.',
    description:
      'Stratus is dropping the light-grey masterbatch for this part. The closeout panel behind the avionics rack access (never visible to occupants) moves from light grey to charcoal, their stock colour. Same part, same mould, same polymer, same supplier. ' +
      'They quote $39.60 against $41.50, because the grey needs a separate 2,000-piece colour batch. Six panels per aircraft. Use up grey stock first, then charcoal on the next lot.',
    need: 'Supplier is discontinuing the grey batch; charcoal is cheaper and avoids a colour changeover charge. Cost reduction, small.',
    consequencesIfDisapproved: 'Stratus will keep supplying grey at a changeover surcharge of about $4 per panel, or stop.',
    alternativesConsidered: 'None.',
    testAndQualification: 'None. Flame-test certificate carries over (supplier letter SN-2204).',
    itemChanges: [
      { item: 'BW-9440-030', op: 'revise', fromRev: 'A', toRev: 'B', changes: [{ field: 'colour', from: 'light grey', to: 'charcoal' }, { field: 'unit_price_usd', from: 41.5, to: 39.6 }] },
    ],
    bomChanges: [],
    supplierQuotes: [
      {
        id: 'SN-2204', supplier: 'SUP-STRATUS', item: 'BW-9440-030', receivedOn: '2026-10-09',
        lines: [{ description: 'Closeout panel, charcoal, same tooling', unitPrice: 39.6 }],
        leadTimeWeeks: 16, note: 'Product-change notice with flame-test letter. Same lead time and MOQ.',
      },
    ],
    effectivity: { production: { basis: 'lot', from: 'next lot after existing grey stock is used', note: 'Use up grey stock first.' }, interchangeable: true },
    inventoryProposal: [{ item: 'BW-9440-030', location: 'stores', disposition: 'use_until_depleted', note: 'Grey and charcoal are both acceptable on any aircraft.' }],
    costPage: {
      production: [line('Panel unit cost', 'supplier_quote', { unitCost: -1.9, quantity: 6, note: 'Six panels per aircraft.' })],
      retrofit: [], logisticsSupport: [], other: [],
    },
    routedTo: ['cm_analyst', 'buyer'], clarity: 'terse',
    prov: inv('Trivial change that should fast-track: Class II, FAA minor, no safety part, no interface, same supplier, no tooling.'),
  },

  // ---------------------------------------------------------------- scenario 4: two ECRs that conflict (same item, same fields)
  {
    id: 'ECR-0412', rev: 'A',
    title: 'Battery loop coolant pump BW-8210-110 Rev C: higher flow',
    status: 'in_review', program: 'vesper', originator: 'EMP-06', filedOn: '2026-10-09', neededBy: '2026-11-12', originatingNcr: 'NCR-0112',
    priority: 'urgent', justificationCode: 'D', companyClass: 'I', faaClass: 'minor',
    faaRationale: 'The pump is a system component with the same mounting, ports and connector. A flow increase does not change the pack safety assessment; it adds temperature margin. Proposed minor.',
    description:
      'Raise the battery loop coolant pump to Rev C: impeller 48 mm to 54 mm, motor 180 W to 240 W, rated flow 12.0 to 14.2 L/min at 0.9 bar. Same housing, same ports and mounting, same connector. Mass +0.14 kg, electrical draw +60 W per pump, two pumps per aircraft. ' +
      'Hollis quotes Rev C at $3,820 against $3,400 for Rev B. Meridian uses the same pump, two per aircraft; Linnea has been told.',
    need:
      'NCR-0112: hot-and-high climb at 45 C gave 11.4 L/min against 12.5 L/min needed, with the hottest module at 58 C against a 60 C limit. Rev C gives 14.2 L/min, which holds the module spread under 6 K and the hottest module near 54 C on the same profile.',
    consequencesIfDisapproved: 'Hot-day climb stays restricted to 40 C ambient. Certification hot-day tests (planned January) cannot be run at the required 45 C.',
    alternativesConsidered: 'Two pumps in parallel per loop (more plumbing, +1.9 kg, needs a manifold change); larger lines (structure interference). Larger impeller chosen.',
    testAndQualification: 'Pump bench test, glycol soak, and a repeat of the hot-and-high climb on S/N 004. Hollis estimates 8 weeks.',
    itemChanges: [
      {
        item: 'BW-8210-110', op: 'revise', fromRev: 'B', toRev: 'C',
        changes: [
          { field: 'impeller_diameter_mm', from: 48, to: 54 },
          { field: 'motor_power_w', from: 180, to: 240 },
          { field: 'rated_flow_lpm', from: 12.0, to: 14.2 },
          { field: 'unit_price_usd', from: 3400, to: 3820 },
        ],
      },
    ],
    bomChanges: [],
    supplierQuotes: [
      {
        id: 'Q-HOL-26-0966', supplier: 'SUP-HOLLIS', item: 'BW-8210-110', receivedOn: '2026-10-07', validUntil: '2027-01-07',
        lines: [{ description: 'Pump Rev C, 240 W, 14.2 L/min', unitPrice: 3820 }, { description: 'Qualification and soak testing', oneTime: 36000 }],
        leadTimeWeeks: 18,
      },
    ],
    effectivity: { production: { basis: 'serial', from: '13', note: 'S/N 013 and subsequent (January 2027).' }, retrofit: { basis: 'tbd', from: 'tbd', note: 'S/N 005-012 retrofit only if hot-day certification needs it.' }, interchangeable: true },
    inventoryProposal: [{ item: 'BW-8210-110', location: 'stores', disposition: 'tbd', note: 'Rev B still usable for aircraft not flown hot.' }],
    costPage: {
      production: [
        line('Pump unit cost, Rev C vs Rev B', 'supplier_quote', { unitCost: 420, quantity: 2, note: 'Two per aircraft.' }),
        line('Qualification and soak testing (Hollis)', 'supplier_quote', { oneTime: 36000 }),
        blank('Engineering and data revision'),
      ],
      retrofit: [blank('Retrofit S/N 005-012')], logisticsSupport: [], other: [],
    },
    routedTo: FULL_ROUTE, clarity: 'detailed',
    prov: inv('Half of the conflicting pair: same item and fields as ECR-0415.'),
  },
  {
    id: 'ECR-0415', rev: 'A',
    title: 'Coolant pump BW-8210-110 Rev C: low-cost polymer housing',
    status: 'submitted', program: 'vesper', originator: 'EMP-08', filedOn: '2026-10-13', neededBy: '2026-11-12',
    priority: 'routine', justificationCode: 'R', companyClass: 'I', faaClass: 'minor',
    faaRationale: 'Same mounting, ports and connector; polymer housing is rated for the glycol and temperature range. No appreciable effect on strength or reliability. Proposed minor.',
    description:
      'Cost reduction on the battery loop pump. Rev C: injection-moulded PPS GF40 housing instead of machined stainless, motor 180 W to 150 W, rated flow 12.0 to 11.0 L/min. Mounting and connector unchanged. Hollis quotes Rev C at $3,015 against $3,400: -$385 per pump, two per aircraft, plus a one-time $48,000 for the mould. ' +
      'The pack loop requirement in TS-8210 rev 3 is 10.5 L/min, so 11.0 still has margin. Mass -0.31 kg per pump.',
    need: 'Pump is the largest single thermal component by price after the heat exchangers, and the stainless housing is overspecified for the pressure. A 12% cost reduction at 650 aircraft per year is worth about $500k a year.',
    consequencesIfDisapproved: 'No saving. The machined housing stays at about $1,100 of the pump price.',
    alternativesConsidered: 'Cast aluminium housing (-$210, needs a mould too and a coating step); keep machined, cut the motor only (-$120).',
    testAndQualification: 'Housing burst and glycol soak at 85 C, vibration profile. Hollis says 10 weeks.',
    itemChanges: [
      {
        item: 'BW-8210-110', op: 'revise', fromRev: 'B', toRev: 'C',
        changes: [
          { field: 'housing_material', from: 'stainless steel, machined', to: 'PPS GF40, injection moulded' },
          { field: 'motor_power_w', from: 180, to: 150 },
          { field: 'rated_flow_lpm', from: 12.0, to: 11.0 },
          { field: 'unit_price_usd', from: 3400, to: 3015 },
        ],
      },
    ],
    bomChanges: [],
    supplierQuotes: [
      {
        id: 'Q-HOL-26-0981', supplier: 'SUP-HOLLIS', item: 'BW-8210-110', receivedOn: '2026-10-12', validUntil: '2027-01-12',
        lines: [{ description: 'Pump Rev C, polymer housing, 150 W, 11.0 L/min', unitPrice: 3015 }, { description: 'Injection mould', oneTime: 48000 }, { description: 'Qualification', oneTime: 22000 }],
        leadTimeWeeks: 22,
        note: 'Mould lead time 14 weeks.',
      },
    ],
    effectivity: { production: { basis: 'serial', from: '15', note: 'S/N 015 and subsequent (March 2027), after mould and qualification.' }, interchangeable: true },
    inventoryProposal: [{ item: 'BW-8210-110', location: 'stores', disposition: 'use_until_depleted' }],
    costPage: {
      production: [
        line('Pump unit cost, Rev C vs Rev B', 'supplier_quote', { unitCost: -385, quantity: 2, note: 'Two per aircraft.' }),
        line('Injection mould (Hollis)', 'supplier_quote', { oneTime: 48000 }),
        line('Qualification (Hollis)', 'supplier_quote', { oneTime: 22000 }),
        blank('Engineering and data revision'),
      ],
      retrofit: [], logisticsSupport: [], other: [],
    },
    routedTo: ['cost_engineer', 'buyer', 'production_planner', 'cost_accountant', 'quality'], clarity: 'typical',
    prov: inv('Half of the conflicting pair: both claim Rev C of BW-8210-110 with different rated flow, motor, housing and price. Also conflicts with the 12.5 L/min need in NCR-0112; TS-8210 rev 3 (10.5 L/min) is out of date.'),
  },

  // ---------------------------------------------------------------- scenario 5: shared supplier (Orrin Magnetics), different parts
  {
    id: 'ECR-0419', rev: 'A',
    title: 'Forward rotor magnet set BW-3120-340: SH grade to UH grade',
    status: 'submitted', program: 'vesper', originator: 'EMP-04', filedOn: '2026-10-20', neededBy: '2026-11-12', originatingNcr: 'NCR-0115',
    priority: 'urgent', justificationCode: 'D', companyClass: 'I', faaClass: 'major',
    faaRationale: 'New magnet material grade in a flight-critical rotating part; changes rotor design data, torque constant (-3%) and the spin and thermal margins. Treated as major pending Gideon.',
    description:
      'Move the forward motor rotor magnets from SH to UH grade, same segment geometry and coating. UH has higher coercivity (Hcj 2,630 kA/m against 1,990) at slightly lower remanence (1.34 T against 1.40 T), so the torque constant drops about 3% and the controller current limit rises by the same amount. ' +
      'The set price goes from $8,000 to $9,350. Orrin runs UH only on its pilot furnace line; they said the next qualification slot is 2027-Q2 and they will not commit to a date until we place the qualification order.',
    need:
      'NCR-0115: 0.8% irreversible flux loss after three hot-day transition cycles at 163 C magnet temperature. The knee margin on SH is about 2 C at our worst case. UH gives about 35 C of margin. Interim software limit TL-212 caps transition thrust above 38 C ambient and costs us hot-day range.',
    consequencesIfDisapproved: 'The transition-thrust limit stays, and hot-day certification flight tests cannot show the required transition performance.',
    alternativesConsidered: 'Improve nacelle airflow at transition (structures change, 4 to 6 months, less margin gained); derate the motor (costs range); active cooling jackets on the rotor (new part). UH chosen as the least invasive.',
    testAndQualification: 'Orrin qualification lot, rotor spin and thermal cycling test, one repeat hot-day transition test on S/N 004, update of the motor performance data for certification.',
    itemChanges: [
      {
        item: 'BW-3120-340', op: 'revise', fromRev: 'A', toRev: 'B',
        changes: [
          { field: 'magnet_grade', from: 'SH', to: 'UH' },
          { field: 'coercivity_hcj_ka_m', from: 1990, to: 2630 },
          { field: 'remanence_br_t', from: 1.4, to: 1.34 },
          { field: 'unit_price_usd', from: 8000, to: 9350 },
        ],
      },
    ],
    bomChanges: [],
    supplierQuotes: [
      {
        id: 'Q-OR-0912', supplier: 'SUP-ORRIN', item: 'BW-3120-340', receivedOn: '2026-10-12', validUntil: '2027-01-12',
        lines: [
          { description: 'Forward magnet set, UH grade, production', unitPrice: 9350 },
          { description: 'Qualification lot of 12 sets', oneTime: 96000 },
        ],
        leadTimeWeeks: 28,
        note: 'Production lead time 24 weeks after qualification. UH capacity 1,200 sets per year on the pilot furnace; second furnace not before 2028-Q3. Qualification slot 2027-Q2 is the next open one; slots are quarterly.',
      },
    ],
    effectivity: {
      production: { basis: 'serial', from: '30', note: 'S/N 030 and subsequent (about October 2027), if the 2027-Q2 qualification slot holds.' },
      retrofit: { basis: 'tbd', from: 'tbd', note: 'Motors on built aircraft keep SH under the transition-thrust limit. Retrofit not requested.' },
      interchangeable: true,
    },
    inventoryProposal: [
      { item: 'BW-3120-340', location: 'stores', disposition: 'use_until_depleted', note: 'SH sets remain good for aircraft built before cut-in.' },
      { item: 'BW-3120-340', location: 'on_order', disposition: 'tbd', note: 'Open orders for SH sets continue until cut-in.' },
    ],
    costPage: {
      production: [
        line('Magnet set unit cost, UH vs SH', 'supplier_quote', { unitCost: 1350, quantity: 6, note: 'Six forward motors per aircraft.' }),
        line('Orrin qualification lot', 'supplier_quote', { oneTime: 96000 }),
        line('Engineering and testing', 'engineer_estimate', { oneTime: 210000, note: 'About 1,450 h plus test hardware.' }),
        blank('Torque-constant recalibration and controller update'),
      ],
      retrofit: [], logisticsSupport: [], other: [],
    },
    routedTo: FULL_ROUTE, clarity: 'detailed',
    prov: inv('Half of the shared-supplier pair: Orrin Magnetics also supplies the Meridian cruise motor magnets in ECR-0421.'),
  },
  {
    id: 'ECR-0421', rev: 'A',
    title: 'Meridian cruise motor magnets BW-M512-340: qualify UH grade for the first-flight rotors',
    status: 'submitted', program: 'meridian', originator: 'EMP-17', filedOn: '2026-10-21', neededBy: '2026-11-12',
    priority: 'routine', justificationCode: 'O', companyClass: 'I', faaClass: 'major',
    faaRationale: 'Meridian is not yet type certificated, so this sits inside the certification project rather than under 14 CFR 21.93. Recorded as major for planning: it changes the rotor material and the thermal margin the motor compliance data rests on.',
    description:
      'The preliminary-design cruise motor assumed SH grade magnets from the catalogue. Thermal analysis for the 12,000 lb vehicle puts the cruise rotor at 171 C at the hot-day top-of-climb point, past what SH can hold, so the design basis needs UH grade. ' +
      'Change BW-M512-340 from SH to UH, same geometry. Orrin quotes $24,900 against $21,400 per set, two sets per aircraft. We need qualified UH sets for the first-flight article rotor build in June 2027. ' +
      'Orrin runs UH on one pilot furnace line and qualifies one lot per quarter; we have asked for the 2027-Q2 slot.',
    need: 'First flight is planned for September 2027 and the rotor build starts in June. The SH grade does not meet the thermal margin on the hot-day design point, and we want the UH data in hand before the means-of-compliance discussion.',
    consequencesIfDisapproved: 'First flight uses SH rotors with a restricted envelope, and the hot-day compliance data has to be redone on UH later.',
    alternativesConsidered: 'Stator-side cooling upgrade (heavier, cost +$14,000 per motor); a lower-power cruise motor (loses the cruise margin). UH chosen.',
    testAndQualification: 'Orrin qualification lot; rotor spin and thermal cycle test; first-flight-article rotor balance.',
    itemChanges: [
      {
        item: 'BW-M512-340', op: 'revise', fromRev: 'A', toRev: 'B',
        changes: [
          { field: 'magnet_grade', from: 'SH', to: 'UH' },
          { field: 'coercivity_hcj_ka_m', from: 1990, to: 2630 },
          { field: 'unit_price_usd', from: 21400, to: 24900 },
        ],
      },
    ],
    bomChanges: [],
    supplierQuotes: [
      {
        id: 'Q-OR-0915', supplier: 'SUP-ORRIN', item: 'BW-M512-340', receivedOn: '2026-10-16', validUntil: '2027-01-16',
        lines: [
          { description: 'Cruise motor magnet set, UH grade', unitPrice: 24900 },
          { description: 'Qualification lot of 4 sets', oneTime: 142000 },
        ],
        leadTimeWeeks: 30,
        note: 'Slot 2027-Q2 requested. Lead time 30 weeks after qualification lot is released.',
      },
    ],
    effectivity: { production: { basis: 'date', from: '2027-06-01', note: 'First-flight article rotor build, June 2027.' }, interchangeable: true },
    inventoryProposal: [],
    costPage: {
      production: [
        line('Magnet set unit cost, UH vs SH', 'supplier_quote', { unitCost: 3500, quantity: 2, note: 'Two cruise motors per aircraft.' }),
        line('Orrin qualification lot', 'supplier_quote', { oneTime: 142000 }),
        blank('Engineering and testing'),
      ],
      retrofit: [], logisticsSupport: [], other: [],
    },
    routedTo: ['cost_engineer', 'buyer', 'production_planner', 'certification'], clarity: 'typical',
    prov: inv('Other half of the shared-supplier pair: same grade, same supplier, same qualification slot as ECR-0419, different part and program.'),
  },
];
