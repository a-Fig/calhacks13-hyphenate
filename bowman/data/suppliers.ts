import type { Supplier, SupplierConstraint } from './types.ts';
import { ARCHER, PRACTICE, inv, src } from './prov.ts';

// Fictional names. `analog` records the real-world counterpart for provenance only.
// Supplier-to-part pairings that follow public Archer press releases are tagged `sourced`;
// everything else about a supplier (region, terms, performance) is invented.

export const suppliers: Supplier[] = [
  {
    id: 'SUP-TARN', name: 'Tarn Composites', region: 'Europe', country: 'Austria',
    supplies: 'Fuselage shells, bulkheads, doors, canopy, control-surface and fairing composites',
    singleSource: false, programs: ['vesper', 'meridian'], paymentTerms: 'Net 45',
    analog: 'FACC (key fuselage and wing elements for Archer)', onTimeDeliveryPct: 88, qualityPpm: 1800,
    prov: src(`${ARCHER} §3`, 'FACC supplies key fuselage and wing elements (Q2 2022 letter). Name, terms and performance invented.'),
  },
  {
    id: 'SUP-CARDINAL', name: 'Cardinal Materials', region: 'North America', country: 'USA (Utah)',
    supplies: 'Carbon prepreg, honeycomb core, film adhesive, layup consumables, lightning-strike mesh',
    singleSource: false, programs: ['vesper', 'meridian'], paymentTerms: 'Net 30',
    analog: 'Hexcel (carbon fiber prepreg; letter of intent only, April 2022)', onTimeDeliveryPct: 91, qualityPpm: 900,
    prov: src(`${ARCHER} §3`, 'Hexcel prepreg letter of intent (April 2022). Everything else invented.'),
  },
  {
    id: 'SUP-VANTAGE', name: 'Vantage Cells', region: 'Asia', country: 'Taiwan',
    supplies: 'High-energy cylindrical lithium-ion cells (21700-class), aviation lot screening',
    singleSource: true, programs: ['vesper', 'meridian'], paymentTerms: 'Net 30, 20% deposit on blanket orders',
    analog: 'Molicel / E-One Moli (battery cells; MOU only, November 2022)', onTimeDeliveryPct: 93, qualityPpm: 120,
    prov: src(`${ARCHER} §1, §3`, 'Molicel cells under a Nov 2022 MOU. Beta Technologies also qualifies a single cell supplier (§7). Single-source flag is invented.'),
  },
  {
    id: 'SUP-ORRIN', name: 'Orrin Magnetics', region: 'Europe', country: 'Germany',
    supplies: 'Sintered neodymium rotor magnet sets (SH grade now, UH grade in qualification), magnet segment machining',
    singleSource: true, programs: ['vesper', 'meridian'], paymentTerms: 'Net 30',
    analog: 'Generic European rare-earth magnet maker (Archer press names no magnet supplier)', onTimeDeliveryPct: 84, qualityPpm: 650,
    prov: inv('Archer names no magnet supplier (archer-public-data.md §3: "Seats, landing gear, motor magnets: nothing found"). Sole-source flag is a Bowman design call.'),
  },
  {
    id: 'SUP-HALDEN', name: 'Halden Precision', region: 'North America', country: 'USA (Washington)',
    supplies: 'Precision-machined aluminum and titanium: brackets, fittings, housings, shafts, cold plates, enclosures',
    singleSource: false, programs: ['vesper', 'meridian'], paymentTerms: 'Net 30',
    analog: 'Generic aerospace machine shop (Supplier A in the ECR-0417 worked example)', onTimeDeliveryPct: 90, qualityPpm: 1200,
    prov: src(`${PRACTICE} §1`, 'The bracket is single source from "Supplier A" in the worked example; Halden is that supplier. At item level, BW-5120-210 is sole-sourced; the supplier is not on the strategic list.'),
  },
  {
    id: 'SUP-NORTHGATE', name: 'Northgate Power Components', region: 'North America', country: 'USA (North Carolina)',
    supplies: 'SiC power modules, gate drivers, DC-link capacitors, control boards, wound stators, sensors, DC-DC converters, BMS',
    singleSource: false, programs: ['vesper', 'meridian'], paymentTerms: 'Net 45',
    analog: 'Generic power-semiconductor and motor-component maker', onTimeDeliveryPct: 86, qualityPpm: 700,
    prov: inv('Archer builds the powertrain in-house and names no component suppliers.'),
  },
  {
    id: 'SUP-HALVORSEN', name: 'Halvorsen Propeller', region: 'Europe', country: 'France',
    supplies: 'Propeller hubs, composite blades, pitch actuators, spinners, prop-lock actuators, dampers',
    singleSource: false, programs: ['vesper', 'meridian'], paymentTerms: 'Net 45',
    analog: 'DUC Helices / MT-Propeller class of composite propeller maker', onTimeDeliveryPct: 87, qualityPpm: 1100,
    prov: src(`${ARCHER} §7`, 'DUC Helices is a named Eve propeller supplier (press). Archer names no propeller supplier. Bowman pairing invented.'),
  },
  {
    id: 'SUP-ALTUS', name: 'Altus Avionics', region: 'North America', country: 'USA (Kansas)',
    supplies: 'Integrated flight deck displays, avionics units, air data and attitude, radios, transponder, GNSS',
    singleSource: false, programs: ['vesper', 'meridian'], paymentTerms: 'Net 45',
    analog: 'Garmin (G3000 integrated flight deck for Archer, Nov 2022)', onTimeDeliveryPct: 92, qualityPpm: 300,
    prov: src(`${ARCHER} §3`, 'Garmin G3000 integrated flight deck, announced 2022-11-15. Name and terms invented.'),
  },
  {
    id: 'SUP-VEYRON', name: 'Veyron Electronics & Defense', region: 'Europe', country: 'France',
    supplies: 'Flight control computers, vehicle management computer, inceptors, radar altimeter, recorder, network switches',
    singleSource: false, programs: ['vesper', 'meridian'], paymentTerms: 'Net 60',
    analog: 'Safran Electronics & Defense (UCAP flight control computer, four per Archer airframe)', onTimeDeliveryPct: 85, qualityPpm: 400,
    prov: src(`${ARCHER} §3`, 'Safran UCAP flight control computer and SkyNaute navigation, announced 2023-06-21. Name invented. Proprietary designs are sole-source by item.'),
  },
  {
    id: 'SUP-HOLLIS', name: 'Hollis Actuation & Thermal', region: 'North America', country: 'USA (Arizona)',
    supplies: 'Electromechanical actuators, coolant pumps, heat exchangers, cabin environmental control, valves, hoses',
    singleSource: false, programs: ['vesper', 'meridian'], paymentTerms: 'Net 45',
    analog: 'Honeywell (actuators, climate and thermal management for Archer)', onTimeDeliveryPct: 89, qualityPpm: 800,
    prov: src(`${ARCHER} §3`, 'Honeywell supplies actuators, climate and thermal management (Q2 2022 letter). Name invented.'),
  },
  {
    id: 'SUP-DUNMORE', name: 'Dunmore Interconnect', region: 'Latin America', country: 'Mexico',
    supplies: 'HV and signal wire harnesses, connectors, junction boxes, charge inlet',
    singleSource: false, programs: ['vesper', 'meridian'], paymentTerms: 'Net 45',
    analog: 'Generic aerospace harness house', onTimeDeliveryPct: 87, qualityPpm: 1500,
    prov: inv('Archer names no harness supplier.'),
  },
  {
    id: 'SUP-STRATUS', name: 'Stratus Aerosystems', region: 'North America', country: 'Canada (Quebec)',
    supplies: 'Landing gear, wheels and brakes, seats, interior panels and trim, medevac interior',
    singleSource: false, programs: ['vesper', 'meridian'], paymentTerms: 'Net 45',
    analog: 'Generic landing-gear and cabin-interior supplier (Archer: "Seats, landing gear: nothing found")', onTimeDeliveryPct: 86, qualityPpm: 1400,
    prov: inv('Archer names no seat or landing-gear supplier (archer-public-data.md §3).'),
  },
  {
    id: 'SUP-COBALT', name: 'Cobalt Industrial Supply', region: 'North America', country: 'USA (Ohio)',
    supplies: 'Fasteners, bearings, seals, isolators, plastics, coatings, safety equipment, chemicals',
    singleSource: false, programs: ['vesper', 'meridian'], paymentTerms: 'Net 30',
    analog: 'Generic aerospace hardware distributor', onTimeDeliveryPct: 95, qualityPpm: 500,
    prov: inv('Distributor; many commodity parts carry a second source.'),
  },
  {
    id: 'SUP-AURELIO', name: 'Aurelio Power Systems', region: 'North America', country: 'USA (Ohio)',
    supplies: 'Hybrid turbogenerator for Meridian (Meridian only)',
    singleSource: true, programs: ['meridian'], paymentTerms: 'Milestone payments, 30% on order',
    analog: 'GE Aerospace hybrid-electric turbogenerator work (Beta Technologies analog)', onTimeDeliveryPct: 78, qualityPpm: 0,
    prov: src(`${ARCHER} "Suggested basis for Bowman", Program B`, 'Hybrid turbogenerator is the single-source sub-system; GE Aerospace hybrid work for Beta is the real analog. Name invented.'),
  },
];

export const supplierConstraints: SupplierConstraint[] = [
  {
    id: 'CON-ORRIN-UH-SLOT',
    supplier: 'SUP-ORRIN',
    kind: 'qualification_slot',
    description:
      'Orrin runs one qualification lot per quarter on its UH-grade (high-coercivity) furnace line, and each part number needs its own lot. ' +
      'Open slots: 2027-Q2, then 2027-Q4. A second part number requested for the same quarter waits for the next slot (about 13 weeks). ' +
      'Grade-level data (material certificate, demagnetisation curves) is shared between part numbers, so a second part number qualified within 26 weeks of the first costs 40% less. ' +
      'Ordering two part numbers inside one 26-week window also earns a 6% UH raw-material price break. UH yield is 71% against 88% for SH, so each UH set consumes about 24% more furnace time.',
    items: ['BW-3120-340', 'BW-M512-340'],
    window: { from: '2027-04-01', to: '2027-09-30' },
    prov: inv('Invented to create the shared-supplier interaction between ECR-0419 (Vesper) and ECR-0421 (Meridian).'),
  },
  {
    id: 'CON-ORRIN-UH-CAPACITY',
    supplier: 'SUP-ORRIN',
    kind: 'capacity',
    description:
      'UH-grade capacity is 1,200 sets per year on the pilot furnace until the second furnace is commissioned in 2028-Q3, then 4,800 sets per year. ' +
      'SH grade capacity is 9,000 sets per year, expandable to 12,000 with a 2029 furnace.',
    items: ['BW-3120-340', 'BW-3220-340', 'BW-M512-340'],
    capacityPerYear: 1200,
    window: { from: '2027-04-01', to: '2028-09-30' },
    prov: inv('Invented capacity figures.'),
  },
  {
    id: 'CON-VANTAGE-ALLOC',
    supplier: 'SUP-VANTAGE',
    kind: 'capacity',
    description:
      'Cell allocation is committed per calendar year: 180,000 cells in 2027, against a Vesper need of about 218,000 (24 aircraft x 9,072 cells) plus Meridian prototype packs. ' +
      'Bowman holds a call option on 60,000 more cells at 12 weeks notice. Meridian prototype and first-article packs draw from the same allocation.',
    items: ['BW-6110-100'],
    capacityPerYear: 180000,
    window: { from: '2027-01-01', to: '2027-12-31' },
    prov: inv('Invented. Each Vesper carries 6 packs x 6 modules x 252 cells = 9,072 cells.'),
  },
  {
    id: 'CON-AURELIO-SLOT',
    supplier: 'SUP-AURELIO',
    kind: 'capacity',
    description: 'Turbogenerator build slots: 2 in 2028 (prototypes), 8 in 2029, 24 per year from 2030. Each slot needs a 60 to 78 week lead time and a 30% deposit.',
    items: ['BW-M310-100'],
    capacityPerYear: 24,
    prov: inv('Single-source hybrid turbogenerator for Meridian.'),
  },
];
