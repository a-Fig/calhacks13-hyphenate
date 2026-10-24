import type { Eco } from './types.ts';
import { INV, inv } from './prov.ts';

// Ten released ECOs from the last 18 months. Each records what was forecast when the CCB approved
// and what happened. The pattern is deliberate and is what Norn's research agents should learn:
// cost increases land 15-40% above forecast, savings land 10-30% below, one-time costs run 20-35%
// over, and cut-in dates slip 5-10 weeks whenever a supplier tooling step or a qualification slot is
// involved. Changes with no tooling or test step land on time.
//
// Unit cost deltas are per aircraft (standard cost). Dates are ISO.

export const history: Eco[] = [
  {
    id: 'ECO-0231', ecr: 'ECR-0288', title: 'Hybrid-ceramic bearings in forward and aft motors',
    originator: 'EMP-04', fileDate: '2025-04-28', approvedOn: '2025-06-12', releasedOn: '2025-06-16', decidedBy: 'ccb',
    justificationCode: 'D', companyClass: 'I', faaClass: 'minor', program: ['vesper'],
    itemChanges: [
      { item: 'BW-3140-100', op: 'revise', fromRev: 'A', toRev: 'B', changes: [{ field: 'bearing_balls', from: 'steel', to: 'silicon nitride (hybrid ceramic)' }, { field: 'unit_price_usd', from: 935, to: 1120 }] },
      { item: 'BW-3240-100', op: 'revise', fromRev: 'A', toRev: 'B', changes: [{ field: 'bearing_balls', from: 'steel', to: 'silicon nitride (hybrid ceramic)' }, { field: 'unit_price_usd', from: 685, to: 860 }] },
    ],
    summary:
      'Electrical fluting found on the aft motor bearing races after 120 hours on the rig, caused by common-mode current from the inverter. ' +
      'Ceramic balls insulate the race. Same envelope and interfaces, so interchangeable.',
    forecast: { unitCostDeltaUsd: 1860, oneTimeCostUsd: 38000, cutInDate: '2025-09-15', cutInSerial: 4, notes: 'Cobalt quoted +$160 forward and +$150 aft per set. Assumed lot 1 in 14 weeks.' },
    actual: {
      unitCostDeltaUsd: 2160, oneTimeCostUsd: 51500, cutInDate: '2025-10-27', cutInSerial: 4,
      variance: 'Price rose to +$185 and +$175 per set when the ceramic ball allocation was confirmed. Cut-in slipped six weeks: Cobalt\'s bearing source had a ball allocation queue. One-time cost included an extra 40 h of rig time to repeat the fluting check.',
    },
    prov: INV,
  },
  {
    id: 'ECO-0244', ecr: 'ECR-0301', title: 'Laser-welded Cu-Al clad busbar replaces nickel strip in cell modules',
    originator: 'EMP-08', fileDate: '2025-06-30', approvedOn: '2025-08-05', releasedOn: '2025-08-08', decidedBy: 'ccb',
    justificationCode: 'R', companyClass: 'I', faaClass: 'minor', program: ['vesper'],
    itemChanges: [
      { item: 'BW-6122-100', op: 'revise', fromRev: 'A', toRev: 'B', changes: [{ field: 'interconnect', from: 'spot-welded nickel strip', to: 'laser-welded Cu-Al clad busbar' }, { field: 'unit_price_usd', from: 1712, to: 1430 }] },
    ],
    summary: 'Cost reduction. Replaces the spot-welded nickel strip with a laser-welded clad busbar, cutting module interconnect cost and resistance. Needs weld process qualification and pull testing.',
    forecast: { unitCostDeltaUsd: -14760, oneTimeCostUsd: 120000, cutInDate: '2025-11-03', cutInSerial: 5, notes: 'Quote: -$410 per module on 36 modules per aircraft. Weld qualification budgeted at one pass.' },
    actual: {
      unitCostDeltaUsd: -10152, oneTimeCostUsd: 168000, cutInDate: '2026-01-12', cutInSerial: 5,
      variance: 'Saving was -$282 per module, not -$410: first-lot weld yield was 88% and the supplier priced rework in. Weld qualification failed first pull-test round and was repeated; cut-in slipped ten weeks and one-time cost ran 40% over.',
    },
    prov: INV,
  },
  {
    id: 'ECO-0256', ecr: 'ECR-0312', title: 'Redundant position sensor in the tilt actuator',
    originator: 'EMP-04', fileDate: '2025-08-18', approvedOn: '2025-09-30', releasedOn: '2025-10-03', decidedBy: 'ccb',
    justificationCode: 'S', companyClass: 'I', faaClass: 'major', program: ['vesper', 'meridian'],
    itemChanges: [
      { item: 'BW-8110-100', op: 'revise', fromRev: 'A', toRev: 'B', changes: [{ field: 'position_sensors', from: 1, to: 2 }, { field: 'unit_price_usd', from: 17990, to: 19400 }] },
    ],
    summary: 'A single-sensor failure mode in the tilt actuator could not be shown to be extremely improbable. A second, independent position sensor closes the issue-paper finding. FAA major: it changes the system safety assessment.',
    forecast: { unitCostDeltaUsd: 6900, oneTimeCostUsd: 260000, cutInDate: '2025-12-01', cutInSerial: 5, notes: 'Hollis quote +$1,150 per actuator, six per aircraft. Qualification test estimated at 10 weeks.' },
    actual: {
      unitCostDeltaUsd: 8460, oneTimeCostUsd: 342000, cutInDate: '2026-02-09', cutInSerial: 5,
      variance: 'Price landed at +$1,410 per actuator after Hollis re-quoted for the extra harness and connector. Qualification test needed a second thermal-cycling run, and the FAA data review added three weeks. Cut-in slipped ten weeks to the next aircraft.',
    },
    prov: INV,
  },
  {
    id: 'ECO-0271', ecr: 'ECR-0319', title: 'Motor-controller bracket BW-5120-210 stiffened, Rev A to Rev B',
    originator: 'EMP-03', fileDate: '2025-10-27', approvedOn: '2025-11-18', releasedOn: '2025-11-20', decidedBy: 'ccb',
    justificationCode: 'D', companyClass: 'I', faaClass: 'minor', program: ['vesper', 'meridian'],
    itemChanges: [
      { item: 'BW-5120-210', op: 'revise', fromRev: 'A', toRev: 'B', changes: [
        { field: 'plate_thickness_in', from: 0.75, to: 1.0 }, { field: 'web_thickness_mm', from: 3.5, to: 5 }, { field: 'unit_price_usd', from: 175.2, to: 186.4 },
      ] },
    ],
    summary: 'Bench vibration survey found a 212 Hz bracket mode with 0.6 mm excursion at the flange. A thicker plate and web moved the mode above the motor forcing range. Same envelope, interchangeable. Test aircraft S/N 001-004 were retrofitted from Rev A (48 brackets, 4 x 12 h of labor).',
    forecast: { unitCostDeltaUsd: 134.4, oneTimeCostUsd: 26600, cutInDate: '2026-01-12', cutInSerial: 5, notes: '+$11.20 per bracket x 12 per aircraft. One-time: fixture and first-article inspection $12,400, retrofit of S/N 001-004 $14,200.' },
    actual: {
      unitCostDeltaUsd: 134.4, oneTimeCostUsd: 34300, cutInDate: '2026-02-23', cutInSerial: 5,
      variance: 'Steady-state price landed exactly on forecast ($186.40) from the third lot. The first two lots cost $201.50 (25 pieces) and $188.90 (50 pieces): purchase price variance $502.50. Halden\'s first fixture failed CMM correlation and was rebuilt ($20,100 fixture and inspection against $12,400); cut-in slipped six weeks and one-time cost ran 29% over.',
    },
    prov: INV,
  },
  {
    id: 'ECO-0285', ecr: 'ECR-0340', title: 'Flight deck display Rev B for the new vehicle-management software load',
    originator: 'EMP-07', fileDate: '2025-12-09', approvedOn: '2026-01-20', releasedOn: '2026-01-22', decidedBy: 'ccb',
    justificationCode: 'C', companyClass: 'I', faaClass: 'minor', program: ['vesper', 'meridian'],
    itemChanges: [
      { item: 'BW-7110-100', op: 'revise', fromRev: 'A', toRev: 'B', changes: [{ field: 'firmware_hardware_baseline', from: 'HW-A / SW 4.1', to: 'HW-B / SW 4.3' }, { field: 'unit_price_usd', from: 32400, to: 33000 }] },
    ],
    summary: 'Compatibility with the VMC software load 5.0 interface. Altus ships a hardware-B display with a revised bus transceiver. No change to form or fit.',
    forecast: { unitCostDeltaUsd: 1350, oneTimeCostUsd: 30000, cutInDate: '2026-03-02', cutInSerial: 5, notes: 'Altus budgetary +$450 per display, three per aircraft.' },
    actual: {
      unitCostDeltaUsd: 1800, oneTimeCostUsd: 34000, cutInDate: '2026-03-02', cutInSerial: 5,
      variance: 'On time. The firm quote came in at +$600 per display, a third above the budgetary number. Integration retest used the planned bench slot.',
    },
    prov: INV,
  },
  {
    id: 'ECO-0297', ecr: 'ECR-0351', title: 'Thicker carbon retention sleeve on forward rotor',
    originator: 'EMP-04', fileDate: '2026-02-09', approvedOn: '2026-03-10', releasedOn: '2026-03-12', decidedBy: 'ccb',
    justificationCode: 'D', companyClass: 'I', faaClass: 'minor', program: ['vesper'],
    itemChanges: [
      { item: 'BW-3126-100', op: 'revise', fromRev: 'A', toRev: 'B', changes: [{ field: 'sleeve_thickness_mm', from: 0.8, to: 1.0 }, { field: 'unit_price_usd', from: 590, to: 710 }] },
    ],
    summary:
      'Rotor spin test at 115% speed showed sleeve strain above the allowable at the magnet seam. A 1.0 mm sleeve restores margin. The thicker sleeve changes the magnet-to-sleeve interference fit, so Orrin regrinds the magnet outer diameter to match.',
    forecast: { unitCostDeltaUsd: 570, oneTimeCostUsd: 62000, cutInDate: '2026-05-18', cutInSerial: 6, notes: 'Tarn +$95 per sleeve, six per aircraft. Magnet regrind assumed to fit in routine production.' },
    actual: {
      unitCostDeltaUsd: 720, oneTimeCostUsd: 71000, cutInDate: '2026-07-06', cutInSerial: 8,
      variance: 'Sleeve price was +$120. The magnet regrind needed a new process qualification at Orrin, and Orrin\'s qualification furnace was booked: the change waited seven weeks for a slot, so cut-in moved two aircraft later. This is the supplier-slot pattern ECR-0419 and ECR-0421 now share.',
    },
    prov: INV,
  },
  {
    id: 'ECO-0309', ecr: 'ECR-0362', title: 'Tighter capacity-match screening on cells',
    originator: 'EMP-04', fileDate: '2026-04-06', approvedOn: '2026-05-05', releasedOn: '2026-05-07', decidedBy: 'ccb',
    justificationCode: 'D', companyClass: 'I', faaClass: 'minor', program: ['vesper', 'meridian'],
    itemChanges: [
      { item: 'BW-6110-100', op: 'revise', fromRev: 'A', toRev: 'B', changes: [{ field: 'capacity_match_band_pct', from: 3, to: 1.5 }, { field: 'unit_price_usd', from: 10.27, to: 11.1 }] },
    ],
    summary: 'Pack-level testing showed module imbalance traced to cell capacity spread. Vantage re-sorts cells to a 1.5% capacity band before shipment. Same cell, same lot traceability.',
    forecast: { unitCostDeltaUsd: 5443, oneTimeCostUsd: 85000, cutInDate: '2026-06-29', cutInSerial: 7, notes: '+$0.60 per cell on 9,072 cells per aircraft.' },
    actual: {
      unitCostDeltaUsd: 7530, oneTimeCostUsd: 91000, cutInDate: '2026-08-03', cutInSerial: 8,
      variance: 'Price was +$0.83 per cell: Vantage\'s re-sort yield was 83% and the rejected band is priced into the accepted cells. Cut-in slipped five weeks while Vantage added a sorting shift.',
    },
    prov: INV,
  },
  {
    id: 'ECO-0314', ecr: 'ECR-0368', title: 'Superseded fastener standards in the aircraft fastener kit',
    originator: 'EMP-07', fileDate: '2026-05-26', approvedOn: '2026-06-02', releasedOn: '2026-06-02', decidedBy: 'fast_track',
    justificationCode: 'C', companyClass: 'II', faaClass: 'minor', program: ['vesper'],
    itemChanges: [
      { item: 'BW-9610-100', op: 'revise', fromRev: 'A', toRev: 'B', changes: [{ field: 'fastener_standards', from: 'three superseded part standards', to: 'superseding equivalent standards (pre-authorized list)' }, { field: 'unit_price_usd', from: 11738, to: 11700 }] },
    ],
    summary: 'Obsolescence: three fastener part standards are superseded by equivalents on the pre-authorized list. No form, fit or function change. Approved by the CM analyst and design engineer without a board.',
    forecast: { unitCostDeltaUsd: -42, oneTimeCostUsd: 0, cutInDate: '2026-06-22', cutInSerial: 7 },
    actual: {
      unitCostDeltaUsd: -38, oneTimeCostUsd: 0, cutInDate: '2026-06-22', cutInSerial: 7,
      variance: 'On forecast. Six days from filing to release.',
    },
    prov: inv('Shows the fast-track path: a change that fits the published "qualifies" list.'),
  },
  {
    id: 'ECO-0318', ecr: 'ECR-0372', title: 'Keyed HV terminal connector on both motors',
    originator: 'EMP-03', fileDate: '2026-06-02', approvedOn: '2026-06-23', releasedOn: '2026-06-25', decidedBy: 'ccb',
    justificationCode: 'S', companyClass: 'I', faaClass: 'minor', program: ['vesper', 'meridian'],
    itemChanges: [
      { item: 'BW-3190-100', op: 'revise', fromRev: 'A', toRev: 'B', changes: [{ field: 'keying', from: 'unkeyed', to: 'keyed, phase-coded' }, { field: 'unit_price_usd', from: 400.6, to: 420 }] },
    ],
    summary: 'NCR: a technician swapped two phases on an aft motor during build. A keyed, phase-coded connector makes miswiring impossible. Interchangeable at the motor.',
    forecast: { unitCostDeltaUsd: 264, oneTimeCostUsd: 9800, cutInDate: '2026-08-10', cutInSerial: 9, notes: '+$22 per connector, twelve per aircraft.' },
    actual: {
      unitCostDeltaUsd: 233, oneTimeCostUsd: 8900, cutInDate: '2026-08-10', cutInSerial: 9,
      variance: 'On time and slightly under: +$19.40 per connector. The only miss was three days on drawing release.',
    },
    prov: INV,
  },
  {
    id: 'ECO-0326', ecr: 'ECR-0381', title: 'Battery loop coolant pump, Rev B impeller and seal',
    originator: 'EMP-06', fileDate: '2026-07-21', approvedOn: '2026-08-18', releasedOn: '2026-08-20', decidedBy: 'ccb',
    justificationCode: 'D', companyClass: 'I', faaClass: 'minor', program: ['vesper', 'meridian'],
    itemChanges: [
      { item: 'BW-8210-110', op: 'revise', fromRev: 'A', toRev: 'B', changes: [{ field: 'seal_material', from: 'EPDM', to: 'FKM' }, { field: 'impeller_material', from: 'PA66 GF30', to: 'PPS GF40' }, { field: 'unit_price_usd', from: 3188, to: 3400 }] },
    ],
    summary: 'Seal swelling after glycol-water soak exceeded limits. Rev B changes the seal and impeller materials. Same flow rating, same mounting.',
    forecast: { unitCostDeltaUsd: 360, oneTimeCostUsd: 14000, cutInDate: '2026-10-05', cutInSerial: 10, notes: 'Hollis +$180 per pump, two per aircraft.' },
    actual: {
      unitCostDeltaUsd: 424, oneTimeCostUsd: 17500, cutInDate: '2026-10-12', cutInSerial: 10,
      variance: '+$212 per pump after material price adders. One week late: soak-test report was reissued once.',
    },
    prov: INV,
  },
];
