// The parts of the three full pages that are not computed: the ECR text, the diff blocks of the
// Changes tab, the revisions, the linked records and the CCB meeting. MOCK, drawn from
// bowman/data/changes.ts (ECR text and item changes) and history.ts (the earlier bracket ECO).
import type { ChangedItem, LinkedRecord, Meeting, Revision } from '../types.ts';

type Detail = {
  body: { heading: string; text: string }[];
  changes: ChangedItem[];
  revisions: Revision[];
  linked: LinkedRecord[];
  meeting: Meeting;
};

export const detail0417: Detail = {
  body: [
    {
      heading: 'Change',
      text: 'Replace the machined 7075 mounting bracket BW-5120-210 Rev B with Rev C on all twelve motor controllers, six forward and six aft. Rev C takes the plate stock from 1.0 in to 1.25 in, the web from 5 mm to 8 mm and the lower fillet radius from 3 mm to 6 mm. The envelope, the four mounting holes and the isolator pattern do not change, so Rev C is interchangeable with Rev B. Mass goes from 0.41 kg to 0.53 kg per bracket.',
    },
    {
      heading: 'Need',
      text: 'NCR-0119: crack at the lower fillet at 8.2 h of the 20 h endurance profile; three of twelve rig brackets had initiated by 20 h. The sixth electrical order of the aft motor at hover speed sits at 241 Hz, right on the Rev B mode. Rev C moves the mode to 262 Hz, and the stress report supplement shows a fatigue margin of +14% at the fillet against −31% for Rev B.',
    },
    {
      heading: 'If not approved',
      text: 'No aircraft can fly beyond the 5 h inspection interval with Rev B. S/N 001–004 carry the certification test program, so the campaign stops. S/N 005–010 cannot be delivered, and controller installation stays held on every aircraft still in build. The first aircraft to reach that station is S/N 011, in about three weeks.',
    },
    {
      heading: 'Alternatives considered',
      text: '(1) Shot-peen the Rev B fillets: +9% margin, not enough. (2) Add a doubler plate: adds a part and a bond, and interferes with the cold-plate hose. (3) Change the isolator durometer: moves the mode onto the 4th order at transition. (4) Do nothing and inspect every 5 h: not viable for a production aircraft.',
    },
  ],
  changes: [
    {
      id: 'item', title: 'BW-5120-210', subtitle: 'Motor-controller mounting bracket · Rev B → Rev C', impact: '+$415.20 per aircraft',
      lines: [
        { kind: 'del', text: 'revision:            B' },
        { kind: 'add', text: 'revision:            C' },
        { kind: 'ctx', text: 'material:            7075 machined' },
        { kind: 'del', text: 'plate_thickness_in:  1.0' },
        { kind: 'add', text: 'plate_thickness_in:  1.25' },
        { kind: 'del', text: 'web_thickness_mm:    5' },
        { kind: 'add', text: 'web_thickness_mm:    8' },
        { kind: 'del', text: 'fillet_radius_mm:    3' },
        { kind: 'add', text: 'fillet_radius_mm:    6' },
        { kind: 'del', text: 'mass_kg:             0.41' },
        { kind: 'add', text: 'mass_kg:             0.53' },
        { kind: 'ctx', text: 'interchangeable:     true' },
        { kind: 'del', text: 'unit_price_usd:      186.40', remark: 'standard cost' },
        { kind: 'add', text: 'unit_price_usd:      221.00', remark: 'Halden quote, lots of 100 and over' },
      ],
    },
    {
      id: 'supplier', title: 'Halden Precision', subtitle: 'Supplier and lead time · sole source', impact: '14 weeks to the first lot',
      lines: [
        { kind: 'ctx', text: 'supplier:            Halden Precision' },
        { kind: 'ctx', text: 'sole_source:         true' },
        { kind: 'del', text: 'price_usd:           186.40' },
        { kind: 'add', text: 'price_usd:           221.00' },
        { kind: 'add', text: 'first_lot_price_usd: 239.50', remark: 'first lot of 25' },
        { kind: 'add', text: 'one_time_usd:        13600', remark: 'fixture and programs 6,800 + NC 4,200 + first article 2,600' },
        { kind: 'add', text: 'lead_time_weeks:     14', remark: 'plate stock 6 weeks in parallel with an 8 week fixture build' },
        { kind: 'add', text: 'quote:               Q-HAL-26-1187', remark: 'valid to 2027-01-15' },
      ],
    },
    {
      id: 'bom', title: 'Engineering BOM · Vesper V4', subtitle: 'Bill of materials', impact: 'No line changes',
      lines: [
        { kind: 'ctx', text: 'BW-5120-000  Motor controller assembly, x12' },
        { kind: 'ctx', text: '  BW-5120-210  Mounting bracket, x1 per controller', remark: 'same quantity and position, new revision' },
      ],
    },
    {
      id: 'stock', title: 'Inventory · BW-5120-210 Rev B', subtitle: 'Old stock', impact: '324 pieces scrapped, $59,470',
      lines: [
        { kind: 'del', text: 'stores:              96 on hand' },
        { kind: 'add', text: 'stores:              96 scrap', remark: 'quarantined by MRB; failed fatigue, so no use-up' },
        { kind: 'del', text: 'wip:                 48 in kits for S/N 011–014' },
        { kind: 'add', text: 'wip:                 48 scrap' },
        { kind: 'del', text: 'supplier_finished:   60 at Halden' },
        { kind: 'add', text: 'supplier_finished:   60 scrap' },
        { kind: 'del', text: 'installed:           120 on S/N 001–010' },
        { kind: 'add', text: 'installed:           120 mandatory install, returned Rev B scrapped' },
        { kind: 'del', text: 'on_order:            60 not started' },
        { kind: 'add', text: 'on_order:            60 cancel', remark: '10% charge, $1,118' },
      ],
    },
    {
      id: 'meridian', title: 'Meridian M6 · aft lift controllers', subtitle: 'Second program, no retrofit', impact: '+$276.80 per aircraft, baseline only',
      lines: [
        { kind: 'ctx', text: 'BW-M520-000  Aft lift controller, x2' },
        { kind: 'del', text: '  BW-5120-210 Rev B  x8 per aircraft' },
        { kind: 'add', text: '  BW-5120-210 Rev C  x8 per aircraft', remark: 'no Meridian hardware is built yet' },
      ],
    },
  ],
  revisions: [
    { id: 'r3', message: 'Set the priority to Urgent: the first aircraft reaches the held station in about three weeks', author: 'Jeff Hargrove', at: '2026-10-19T16:55:00-07:00' },
    { id: 'r2', message: 'Added Halden quote Q-HAL-26-1187 and the stress report supplement', author: 'Jeff Hargrove', at: '2026-10-19T15:10:00-07:00' },
    { id: 'r1', message: 'Filed from NCR-0119: fillet fatigue crack at 8.2 h', author: 'Jeff Hargrove', at: '2026-10-19T14:02:00-07:00' },
  ],
  linked: [
    { kind: 'NCR', ref: 'NCR-0119', title: 'Fillet crack at 8.2 h of a 20 h endurance test', state: 'closed' },
    { kind: 'ECO', ref: 'ECO-0271', title: 'Bracket stiffened, Rev A to Rev B', state: 'released' },
    { kind: 'Quote', ref: 'Q-HAL-26-1187', title: 'Halden Precision, valid to Jan 15, 2027', state: 'valid' },
  ],
  meeting: { label: 'CCB, November 12', date: '2026-11-12' },
};

export const detail0409: Detail = {
  body: [
    {
      heading: 'Change',
      text: 'Replace the six 2-blade aft propellers (BW-4200-000) with 4-blade fixed-pitch propellers and remove the two blade dampers on each. New parts: 4-blade hub, blade (four per propeller) and spinner cap. Tip speed drops 6% at the same hover thrust, so the aft motor runs at lower speed and higher torque. Net mass change −1.7 kg per aircraft.',
    },
    {
      heading: 'Need',
      text: 'NCR-0113: damper elastomer fretting after 38 h, trending to fail before 100 h, and a 2.1 dB hover noise exceedance at the 500 ft point. Four blades at lower tip speed give an estimated 3.4 dB reduction and 3.1% better hover efficiency, and remove the dampers entirely.',
    },
    {
      heading: 'Not re-assessed',
      text: 'The aft-boom vibration spectrum changes with four blades, so the structures group should re-run the aft-boom and controller-bracket vibration survey.',
    },
  ],
  changes: [
    {
      id: 'item', title: 'BW-4200-000', subtitle: 'Aft propeller assembly · Rev A → Rev B', impact: '+$8,640 per aircraft',
      lines: [
        { kind: 'ctx', text: 'revision:            A → B' },
        { kind: 'del', text: 'blade_count:         2' },
        { kind: 'add', text: 'blade_count:         4' },
        { kind: 'del', text: 'dampers:             2' },
        { kind: 'add', text: 'dampers:             0' },
        { kind: 'del', text: 'mass_kg:             9.80' },
        { kind: 'add', text: 'mass_kg:             9.52' },
      ],
    },
    {
      id: 'bom', title: 'Engineering BOM · BW-4200-000', subtitle: 'Seven line changes', impact: '+$1,440 per propeller',
      lines: [
        { kind: 'del', text: 'BW-4210-100  Hub, 2-blade                x1' },
        { kind: 'del', text: 'BW-4220-100  Blade, 2-blade              x2' },
        { kind: 'del', text: 'BW-4230-100  Damper                      x2' },
        { kind: 'del', text: 'BW-4240-100  Spinner                     x1' },
        { kind: 'add', text: 'BW-4210-200  Hub, 4-blade fixed pitch    x1', remark: '$3,950' },
        { kind: 'add', text: 'BW-4220-200  Blade, 4-blade, carbon      x4', remark: '$930 each' },
        { kind: 'add', text: 'BW-4240-200  Spinner and fairing cap     x1', remark: '$330' },
      ],
    },
    {
      id: 'supplier', title: 'Halvorsen', subtitle: 'Tooling and lead time', impact: '$500,000 one-time, 34 weeks',
      lines: [
        { kind: 'add', text: 'blade_mould_set_usd: 410000' },
        { kind: 'add', text: 'hub_forging_usd:     90000' },
        { kind: 'add', text: 'lead_time_weeks:     34', remark: 'budgetary, plus or minus 20%' },
      ],
    },
  ],
  revisions: [
    { id: 'r2', message: 'Added Halvorsen budgetary quote Q-HV-4417', author: 'Maren Solheim', at: '2026-10-05T16:30:00-07:00' },
    { id: 'r1', message: 'Filed from NCR-0113: damper wear and noise', author: 'Maren Solheim', at: '2026-10-05T14:08:00-07:00' },
  ],
  linked: [
    { kind: 'NCR', ref: 'NCR-0113', title: 'Damper wear after 38 h, 2.1 dB over on noise', state: 'closed' },
    { kind: 'ECR', ref: 'ECR-0417', title: 'Rev C bracket sits in the aft-boom vibration this changes', state: 'open' },
    { kind: 'Quote', ref: 'Q-HV-4417', title: 'Halvorsen, budgetary, valid to Dec 31, 2026', state: 'valid' },
  ],
  meeting: { label: 'CCB, December 10', date: '2026-12-10' },
};

export const detail0423: Detail = {
  body: [
    {
      heading: 'Change',
      text: 'Change the avionics bay closeout panel BW-9440-030 from light grey to charcoal. Colour masterbatch only: same base resin, same thickness, same flame-test certificate (supplier letter attached). Non-structural, not a flame barrier, no effect on weight, strength or airworthiness. Use up the grey stock first.',
    },
  ],
  changes: [
    {
      id: 'item', title: 'BW-9440-030', subtitle: 'Avionics bay closeout panel · Rev A → Rev B', impact: '−$11.40 per aircraft',
      lines: [
        { kind: 'del', text: 'colour:              light grey' },
        { kind: 'add', text: 'colour:              charcoal' },
        { kind: 'ctx', text: 'base_resin:          unchanged' },
        { kind: 'ctx', text: 'interchangeable:     true' },
        { kind: 'del', text: 'unit_price_usd:      41.50' },
        { kind: 'add', text: 'unit_price_usd:      39.60', remark: 'six panels per aircraft' },
      ],
    },
  ],
  revisions: [{ id: 'r1', message: 'Filed: panel colour change, use up grey stock first', author: 'Ayesha Karimi', at: '2026-10-22T10:19:00-07:00' }],
  linked: [],
  meeting: { label: 'Fast track, no CCB', date: '2026-10-23' },
};
