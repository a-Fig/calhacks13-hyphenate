import type { Company, Person, Program, Site, WorkCenter } from './types.ts';
import { ARCHER, IMPACT, INV, PRACTICE, inv, src } from './prov.ts';

export const company: Company = {
  name: 'Bowman Aviation',
  short: 'Bowman',
  description:
    'Fictional Archer-like electric-aircraft maker. HQ and pilot production line in California, ' +
    'high-rate plant in Georgia. Builds the Vesper V4 piloted eVTOL air taxi and is developing the ' +
    'Meridian M6 hybrid-electric cargo and medevac VTOL.',
  vocabulary: 'NCR -> ECR -> CCB -> ECO. There is no separate ECN: releasing the ECO notifies downstream teams.',
  plm: 'Stand-in PLM (plays the role Teamcenter plays at Archer)',
  erp: 'ERPNext v16 (plays the role SAP S/4HANA plays at Archer)',
  currency: 'USD',
  asOf: '2026-10-24',
  prov: src(`${ARCHER} §6 and "Suggested basis for Bowman"`, 'Teamcenter and SAP are the confirmed Archer tools; Bowman mirrors the roles.'),
};

export const sites: Site[] = [
  {
    id: 'CA',
    name: 'Bowman HQ and pilot line',
    location: 'San Jose, California',
    role: 'Headquarters, engineering, battery-pack and powertrain build, and the pilot final-assembly line (to 6 aircraft per month).',
    prov: src(`${ARCHER} §2`, 'Mirrors Archer: Silicon Valley golden manufacturing line, powertrain and pack build.'),
  },
  {
    id: 'GA',
    name: 'Bowman Georgia plant',
    location: 'Covington, Georgia',
    role: 'High-rate plant: fuselage and structure, then final assembly from 2028. Designed for 650 aircraft per year around 2030.',
    prov: src(`${ARCHER} §2 and "Suggested basis for Bowman"`, '350,000 sq ft and the 650 aircraft per year design rate are Archer public figures; the 2028 start date is invented.'),
  },
];

export const programs: Program[] = [
  {
    id: 'vesper',
    name: 'Vesper V4',
    stage: 'production',
    description:
      'Midnight-like 12-tilt-6 piloted eVTOL air taxi: six forward motors tilt and drive 5-blade variable-pitch propellers; ' +
      'six aft motors are fixed, provide lift only, and are faired in cruise. Composite structure, fixed tricycle gear. ' +
      'Powertrain and flight-control software in-house.',
    topItem: 'BW-0001-000',
    seats: 'Pilot + 4',
    mtowLb: 6500,
    payloadLb: 1000,
    rangeMi: 100,
    cruiseMph: 150,
    listPriceUsd: 5_000_000,
    targetPriceUsd: 5_000_000,
    standardCostUsd: 2_800_000,
    targetStandardCostAtRateUsd: 1_800_000,
    certification:
      'Type certificate and production certificate held (fictional). Mirrors Archer: 797 means-of-compliance items accepted, 17 issue papers (13 standard, 4 unique).',
    note: 'Rate: about 1 aircraft per month now (Oct 2026), 2 per month in 2027, 6 per month in 2028, 650 per year at the Georgia plant around 2030.',
    prov: src(`${ARCHER} §1, §5 and "Suggested basis for Bowman"`, 'Configuration, MTOW, payload, range and speed follow Midnight; certificates held, price, costs and ramp are invented.'),
  },
  {
    id: 'meridian',
    name: 'Meridian M6',
    stage: 'development',
    description:
      'Hybrid-electric lift-plus-cruise VTOL for cargo and medevac. Eight lift rotors reuse the Vesper aft lift motor and controller; ' +
      'two cruise motors; a single-source turbogenerator feeds a small peak-power battery built from Vesper cell modules.',
    topItem: 'BW-M000-000',
    seats: 'Pilot + cargo / litter',
    mtowLb: 12000,
    payloadLb: 800,
    targetPriceUsd: 9_000_000,
    standardCostUsd: 5_000_000,
    certification: 'Type-certification phase 2 closed, means of compliance in negotiation (fictional).',
    note: 'First flight 2027, first deliveries 2029, 24 per year by 2030. Shares about 40% of Vesper powertrain parts, which creates the shared-supplier interactions.',
    prov: src(`${ARCHER} "Suggested basis for Bowman", Program B`, 'Modeled on Halo and Beta CX300; all figures invented.'),
  },
];

export const workCenters: WorkCenter[] = [
  { id: 'WC-LAYUP', name: 'Composite layup and bond', site: 'GA', laborRatePerHour: 98, learningSlope: 0.88, prov: inv('Loaded rates (wages, benefits, overhead) are invented.') },
  { id: 'WC-STRUCT', name: 'Structure assembly', site: 'GA', laborRatePerHour: 104, learningSlope: 0.88, prov: INV },
  { id: 'WC-MOTOR', name: 'Motor winding and assembly', site: 'CA', laborRatePerHour: 92, learningSlope: 0.9, prov: INV },
  { id: 'WC-PE', name: 'Power electronics assembly', site: 'CA', laborRatePerHour: 88, learningSlope: 0.9, prov: INV },
  { id: 'WC-PACK', name: 'Battery module and pack assembly', site: 'CA', laborRatePerHour: 88, learningSlope: 0.9, prov: INV },
  { id: 'WC-AVI', name: 'Avionics integration', site: 'CA', laborRatePerHour: 105, learningSlope: 0.92, prov: INV },
  { id: 'WC-SYS', name: 'Systems installation (actuation, thermal, electrical)', site: 'CA', laborRatePerHour: 100, learningSlope: 0.9, prov: INV },
  { id: 'WC-INT', name: 'Interior installation', site: 'CA', laborRatePerHour: 90, learningSlope: 0.92, prov: INV },
  { id: 'WC-FINAL', name: 'Final assembly and acceptance test', site: 'CA', laborRatePerHour: 125, learningSlope: 0.86, prov: inv('California pilot-line rate. The Georgia final line is cheaper per hour; the at-rate factors capture that move.') },
];

// Names are invented. Emails use the reserved .example domain.
const mail = (first: string, last: string) => `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '') + '@bowman-aviation.example';

export const people: Person[] = [
  {
    id: 'EMP-01', name: 'Rafael Quintero', title: 'Program Manager, Vesper', department: 'Programs', seat: 'ccb_chair', site: 'CA',
    email: mail('Rafael', 'Quintero'), ccbRole: 'chair',
    responsibilities: 'Chairs the Change Control Board, signs the decision that releases an ECO, owns the Vesper schedule and budget.',
    prov: src(`${PRACTICE} §2`, 'The CCB chair is the program manager (MIL-HDBK-61A 6.1.1.3).'),
  },
  {
    id: 'EMP-02', name: 'Dana Okafor', title: 'Configuration Management Analyst', department: 'Configuration Management', seat: 'cm_analyst', site: 'CA',
    email: mail('Dana', 'Okafor'), reportsTo: 'EMP-01', ccbRole: 'secretary',
    responsibilities: 'Logs, classifies and routes ECRs, checks them for completeness before the board, runs the CCB agenda and minutes.',
    prov: src(`${ARCHER} §6`, 'Archer posts a Configuration and Data Management Specialist who reviews change notices for completeness before the Change Review Board.'),
  },
  {
    id: 'EMP-03', name: 'Jeff Hargrove', title: 'Design Engineer, Power Electronics Packaging', department: 'Engineering', seat: 'design_engineer', site: 'CA',
    email: mail('Jeff', 'Hargrove'), reportsTo: 'EMP-05',
    responsibilities: 'Owns the motor-controller enclosure, cold plate and mount hardware, including bracket BW-5120-210. Files ECR-0417.',
    prov: INV,
  },
  {
    id: 'EMP-04', name: 'Maren Solheim', title: 'Senior Design Engineer, Propulsion and Energy Storage', department: 'Engineering', seat: 'design_engineer', site: 'CA',
    email: mail('Maren', 'Solheim'), reportsTo: 'EMP-05',
    responsibilities: 'Owns motors, magnets, propellers, tilt actuation and the battery modules on Vesper. Files the aft propeller (ECR-0409) and forward magnet-grade (ECR-0419) ECRs.',
    prov: INV,
  },
  {
    id: 'EMP-05', name: 'Priya Venkataraman', title: 'Director of Engineering', department: 'Engineering', seat: 'program_manager', site: 'CA',
    email: mail('Priya', 'Venkataraman'), reportsTo: 'EMP-01', ccbRole: 'member',
    responsibilities: 'Technical approval for engineering changes, line manager of the design engineers.',
    prov: INV,
  },
  {
    id: 'EMP-06', name: 'Tomasz Wierzbicki', title: 'Design Engineer, Thermal Systems', department: 'Engineering', seat: 'design_engineer', site: 'CA',
    email: mail('Tomasz', 'Wierzbicki'), reportsTo: 'EMP-05',
    responsibilities: 'Owns the coolant loops, pumps and heat exchangers. Files the pump flow-margin ECR (ECR-0412).',
    prov: INV,
  },
  {
    id: 'EMP-07', name: 'Ayesha Karimi', title: 'Design Engineer, Flight Deck, Interiors and Cabin Systems', department: 'Engineering', seat: 'design_engineer', site: 'CA',
    email: mail('Ayesha', 'Karimi'), reportsTo: 'EMP-05',
    responsibilities: 'Owns the flight deck, seats, panels and cabin trim. Files the avionics-bay panel colour change (ECR-0423).',
    prov: INV,
  },
  {
    id: 'EMP-08', name: 'Wei-Lin Zhao', title: 'Product Cost Engineer', department: 'Finance and Cost', seat: 'cost_engineer', site: 'CA',
    email: mail('Wei-Lin', 'Zhao'), reportsTo: 'EMP-14', ccbRole: 'member',
    responsibilities: 'Builds should-cost for changed parts, checks supplier quotes, runs the learning-curve cross-check, files cost-reduction ECRs, including the low-cost pump variant (ECR-0415).',
    prov: src(`${IMPACT} §2`, 'Product cost engineer is the seat that writes the cost impact (CHANGE-CONTROL.md).'),
  },
  {
    id: 'EMP-09', name: 'Hamid Barzani', title: 'Strategic Procurement Manager, Electric Propulsion', department: 'Supply Chain', seat: 'buyer', site: 'CA',
    email: mail('Hamid', 'Barzani'), reportsTo: 'EMP-13', ccbRole: 'member',
    responsibilities: 'Owns the magnet, cell and power-electronics supply base, negotiates quotes and tooling, tracks single-source exposure.',
    prov: src(`${ARCHER} §6`, 'Archer posts a Strategic Procurement Manager, Electric Propulsion.'),
  },
  {
    id: 'EMP-10', name: 'Colleen Rourke', title: 'Production Planner', department: 'Operations', seat: 'production_planner', site: 'CA',
    email: mail('Colleen', 'Rourke'), reportsTo: 'EMP-13', ccbRole: 'member',
    responsibilities: 'Runs MRP, sets effectivity against inventory and lead times, decides use-up versus scrap with the board.',
    prov: src(`${ARCHER} §6`, 'Archer posts a Supply Chain Planner and a Sr. Buyer working in SAP MRP.'),
  },
  {
    id: 'EMP-11', name: 'Samir Vaidya', title: 'Cost Accountant', department: 'Finance and Cost', seat: 'cost_accountant', site: 'CA',
    email: mail('Samir', 'Vaidya'), reportsTo: 'EMP-14', ccbRole: 'member',
    responsibilities: 'Maintains standard costs in ERPNext, books purchase price variance, updates standards when an ECO releases.',
    prov: src(`${ARCHER} §6`, 'Archer posts a Cost Analyst (Cost Accountant) who maintains standard costs in SAP and analyses budgets versus standards versus actuals.'),
  },
  {
    id: 'EMP-12', name: 'Beatriz Nowak', title: 'Senior Product Quality Engineer, Powertrain', department: 'Quality', seat: 'quality', site: 'CA',
    email: mail('Beatriz', 'Nowak'), reportsTo: 'EMP-05', ccbRole: 'member',
    responsibilities: 'Opens and dispositions NCRs, chairs the Material Review Board, owns inspection plans and first-article reviews.',
    prov: src(`${ARCHER} §6`, 'Archer posts a Sr. Product Quality Engineer, Powertrain (Teamcenter, SAP).'),
  },
  {
    id: 'EMP-13', name: 'Marcus Edelstein', title: 'VP Operations and Supply Chain', department: 'Operations', seat: 'manufacturing_engineer', site: 'CA',
    email: mail('Marcus', 'Edelstein'), reportsTo: 'EMP-15', ccbRole: 'member',
    responsibilities: 'Owns the line, tooling and assembly-time estimates; line manager of procurement and planning.',
    prov: INV,
  },
  {
    id: 'EMP-14', name: 'Helen Castellanos', title: 'Chief Financial Officer', department: 'Finance', seat: 'cfo', site: 'CA',
    email: mail('Helen', 'Castellanos'),
    responsibilities: 'Final say on program budget; the audience for the production impact card and the backlog roll-up.',
    prov: INV,
  },
  {
    id: 'EMP-15', name: 'Gideon Falk', title: 'Chief Engineer and Certification Lead', department: 'Certification', seat: 'certification', site: 'CA',
    email: mail('Gideon', 'Falk'), ccbRole: 'member',
    responsibilities: 'Decides FAA major versus minor for every change as design-approval holder; owns the certification plan and means-of-compliance items.',
    prov: src(`${PRACTICE} §4`, 'The design approval holder, not a DER, classifies major versus minor (FAA Order 8110.37G).'),
  },
  {
    id: 'EMP-17', name: 'Nikhil Desai', title: 'Design Engineer, Meridian Propulsion', department: 'Engineering', seat: 'design_engineer', site: 'CA',
    email: mail('Nikhil', 'Desai'), reportsTo: 'EMP-05',
    responsibilities: 'Owns the Meridian cruise motors, hybrid power integration and shared-part interfaces with Vesper. Files the Meridian magnet-grade ECR (ECR-0421).',
    prov: INV,
  },
  {
    id: 'EMP-16', name: 'Linnea Brandt', title: 'Program Manager, Meridian', department: 'Programs', seat: 'program_manager', site: 'CA',
    email: mail('Linnea', 'Brandt'), reportsTo: 'EMP-15', ccbRole: 'member',
    responsibilities: 'Owns Meridian schedule and cost; files Meridian ECRs and watches shared-supplier exposure with Vesper.',
    prov: INV,
  },
];
