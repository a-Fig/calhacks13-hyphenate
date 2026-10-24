import { buy, make } from './catalog-core.ts';
import type { Row } from './catalog-core.ts';
import { ARCHER, src } from './prov.ts';

// Meridian M6 catalog. Meridian-only parts use the BW-M<family>-<sequence> pattern. Everything else
// is a Vesper item reused as is, so a change to a shared Vesper part moves both programs.
// Shared with Vesper: aft lift motor and controller (and their magnets, SiC modules, bracket kit),
// cell modules and cells, avionics, coolant pumps, power distribution, some cabin parts.

const AF = 'airframe' as const;
const PT = 'powertrain' as const;
const BT = 'battery' as const;
const AV = 'avionics' as const;
const AT = 'actuation_thermal' as const;
const OT = 'other' as const;

const SHARE = src(`${ARCHER} "Suggested basis for Bowman", Program B`, 'Meridian reuses about 40% of Vesper powertrain parts (decided fact). Part-level choices invented.');

export const meridian: Row[] = [
  make('BW-M000-000', 'Meridian M6 air vehicle', OT, 'Aircraft', 'WC-FINAL', 900, [
    ['BW-M100-000', 1], ['BW-M200-100', 1], ['BW-M300-000', 1], ['BW-M400-000', 1], ['BW-M500-000', 1], ['BW-M600-000', 1],
    ['BW-M700-000', 1], ['BW-M800-000', 1], ['BW-M900-000', 1], ['BW-M950-000', 1], ['BW-M990-100', 1],
  ], { kind: 'aircraft', safety: true }),

  // ------------------------------------------------------------ airframe and gear
  make('BW-M100-000', 'Airframe structure', AF, 'Assemblies', 'WC-STRUCT', 640, [
    ['BW-M110-100', 1], ['BW-M120-100', 1], ['BW-M130-100', 1], ['BW-M140-100', 1], ['BW-M150-100', 1],
  ], { safety: true }),
  buy('BW-M110-100', 'Fuselage shell set, composite', AF, 'Composite structure', 'SUP-TARN', 262_000, 'tier1', 1, { safety: true }),
  buy('BW-M120-100', 'Wing set, composite', AF, 'Composite structure', 'SUP-TARN', 226_000, 'tier1', 1, { safety: true }),
  buy('BW-M130-100', 'Tail boom and empennage, composite', AF, 'Composite structure', 'SUP-TARN', 171_000, 'tier1', 1, { safety: true }),
  buy('BW-M140-100', 'Cargo and litter door and ramp assembly', AF, 'Composite structure', 'SUP-TARN', 104_000, 'tier1', 1, { safety: true }),
  buy('BW-M150-100', 'Fairing and seal kit', AF, 'Composite structure', 'SUP-TARN', 59_000, 'tier1', 1),
  buy('BW-M200-100', 'Landing gear set, wheeled, heavy', OT, 'Landing gear', 'SUP-STRATUS', 188_000, 'gear', 1, { safety: true }),

  // ------------------------------------------------------------ hybrid power (single-source turbogenerator)
  make('BW-M300-000', 'Hybrid power system', PT, 'Assemblies', 'WC-SYS', 90, [
    ['BW-M310-100', 1], ['BW-M330-100', 1], ['BW-M340-100', 1], ['BW-M350-100', 1], ['BW-M360-100', 1], ['BW-M370-100', 1],
  ], { safety: true }),
  buy('BW-M310-100', 'Turbogenerator, 450 kW class', PT, 'Hybrid power', 'SUP-AURELIO', 820_000, 'turbogen', 1, { safety: true, vol: 'custom', prov: src(`${ARCHER} "Suggested basis for Bowman", Program B`, 'Single-source hybrid turbogenerator is a decided fact. Price and lead time invented.') }),
  buy('BW-M330-100', 'Generator rectifier, power electronics', PT, 'Power electronics', 'SUP-NORTHGATE', 96_000, 'powersemi', 1, { safety: true }),
  buy('BW-M340-100', 'Fuel system (tank, pumps, lines, valves)', PT, 'Hybrid power', 'SUP-HOLLIS', 108_000, 'thermal', 1, { safety: true }),
  buy('BW-M350-100', 'Inlet, exhaust and nacelle system', PT, 'Hybrid power', 'SUP-TARN', 66_000, 'tier1', 1),
  buy('BW-M360-100', 'Turbogenerator mount and isolation set', PT, 'Machined parts', 'SUP-HALDEN', 23_500, 'machined', 1, { safety: true }),
  buy('BW-M370-100', 'Fire detection and suppression kit', PT, 'Hybrid power', 'SUP-COBALT', 31_500, 'hardware', 1, { safety: true }),

  // ------------------------------------------------------------ lift propulsion (reuses Vesper aft motor and controller)
  make('BW-M400-000', 'Lift propulsion system (eight units)', PT, 'Assemblies', 'WC-SYS', 40, [['BW-M410-000', 8]], { safety: true, prov: SHARE }),
  make('BW-M410-000', 'Lift propulsor unit (aft motor, controller, rotor)', PT, 'Assemblies', 'WC-SYS', 6, [
    ['BW-3200-000', 1], ['BW-5200-000', 1], ['BW-M420-000', 1],
  ], { safety: true, prov: SHARE }),
  make('BW-M420-000', 'Lift rotor assembly, 3-blade', PT, 'Propeller', 'WC-MOTOR', 5, [
    ['BW-M421-100', 1], ['BW-M422-100', 3], ['BW-M423-100', 1],
  ], { safety: true }),
  buy('BW-M421-100', 'Lift rotor hub, fixed pitch', PT, 'Propeller', 'SUP-HALVORSEN', 8_900, 'props', 1, { safety: true }),
  buy('BW-M422-100', 'Lift rotor blade, carbon', PT, 'Propeller', 'SUP-HALVORSEN', 2_750, 'props', 3, { safety: true }),
  buy('BW-M423-100', 'Lift rotor spinner', PT, 'Propeller', 'SUP-HALVORSEN', 620, 'props', 8),

  // ------------------------------------------------------------ cruise propulsion (Meridian-only motors)
  make('BW-M500-000', 'Cruise propulsion system (two units)', PT, 'Assemblies', 'WC-SYS', 24, [
    ['BW-M510-000', 2], ['BW-M520-000', 2], ['BW-M530-100', 2],
  ], { safety: true }),
  make('BW-M510-000', 'Cruise motor assembly', PT, 'Assemblies', 'WC-MOTOR', 40, [
    ['BW-M511-100', 1], ['BW-M512-000', 1], ['BW-M515-100', 1], ['BW-M516-100', 1], ['BW-M517-100', 1], ['BW-3150-100', 2], ['BW-3190-100', 1],
  ], { safety: true }),
  buy('BW-M511-100', 'Stator, wound and potted (cruise)', PT, 'Motor components', 'SUP-NORTHGATE', 21_500, 'windings', 2, { safety: true }),
  make('BW-M512-000', 'Rotor assembly (cruise)', PT, 'Assemblies', 'WC-MOTOR', 10, [['BW-M512-340', 1], ['BW-M513-100', 1], ['BW-M514-100', 1]], { safety: true }),
  buy('BW-M512-340', 'Rotor magnet segment set, SH grade (cruise)', PT, 'Motor components', 'SUP-ORRIN', 21_400, 'magnets', 2, { safety: true, vol: 'volatile' }),
  buy('BW-M513-100', 'Rotor core and hub, machined (cruise)', PT, 'Machined parts', 'SUP-HALDEN', 4_000, 'machined', 2, { safety: true }),
  buy('BW-M514-100', 'Magnet retention sleeve, carbon (cruise)', PT, 'Motor components', 'SUP-TARN', 1_650, 'windings', 2, { safety: true }),
  buy('BW-M515-100', 'Motor housing with cooling jacket (cruise)', PT, 'Machined parts', 'SUP-HALDEN', 5_200, 'machined', 2),
  buy('BW-M516-100', 'Bearing set, hybrid ceramic (cruise)', PT, 'Hardware and consumables', 'SUP-COBALT', 3_100, 'bearings', 2, { safety: true }),
  buy('BW-M517-100', 'Motor shaft (cruise)', PT, 'Machined parts', 'SUP-HALDEN', 2_600, 'machined', 2, { safety: true }),
  make('BW-M520-000', 'Cruise propeller assembly, 5-blade variable pitch', PT, 'Propeller', 'WC-MOTOR', 8, [
    ['BW-M521-100', 1], ['BW-M522-100', 5], ['BW-M523-100', 1],
  ], { safety: true }),
  buy('BW-M521-100', 'Cruise propeller hub, variable pitch', PT, 'Propeller', 'SUP-HALVORSEN', 21_000, 'props', 1, { safety: true }),
  buy('BW-M522-100', 'Cruise propeller blade, carbon', PT, 'Propeller', 'SUP-HALVORSEN', 5_400, 'props', 5, { safety: true }),
  buy('BW-M523-100', 'Cruise propeller pitch actuator', PT, 'Propeller', 'SUP-HALVORSEN', 9_100, 'props', 1, { safety: true }),
  buy('BW-M530-100', 'Motor controller, cruise (inverter)', PT, 'Power electronics', 'SUP-NORTHGATE', 48_500, 'powersemi', 2, { safety: true }),

  // ------------------------------------------------------------ peak-power battery (Vesper cell modules)
  make('BW-M600-000', 'Peak-power battery system (two packs)', BT, 'Assemblies', 'WC-PACK', 14, [['BW-M610-000', 2]], { safety: true }),
  make('BW-M610-000', 'Battery pack, 4-module, 800 V', BT, 'Assemblies', 'WC-PACK', 22, [
    ['BW-6120-000', 4], ['BW-M620-100', 1], ['BW-M630-100', 1], ['BW-M640-100', 1],
  ], { safety: true, prov: SHARE }),
  buy('BW-M620-100', 'Pack enclosure with fire shield (4-module)', BT, 'Cells and battery', 'SUP-TARN', 4_900, 'tier1', 1, { safety: true }),
  buy('BW-M630-100', 'Battery management system, pack master (Meridian)', BT, 'Cells and battery', 'SUP-NORTHGATE', 3_900, 'electronics', 2, { safety: true }),
  buy('BW-M640-100', 'HV junction box with contactors (Meridian)', BT, 'Cells and battery', 'SUP-FERROW', 5_100, 'harness', 2, { safety: true }),

  // ------------------------------------------------------------ avionics and mission systems
  make('BW-M700-000', 'Avionics and mission systems', AV, 'Assemblies', 'WC-AVI', 320, [
    ['BW-7110-100', 3], ['BW-7120-100', 1], ['BW-7130-100', 2], ['BW-7200-100', 4], ['BW-7210-100', 1], ['BW-7220-100', 2],
    ['BW-7300-100', 3], ['BW-7310-100', 2], ['BW-7320-100', 2], ['BW-7330-100', 1], ['BW-7340-100', 1], ['BW-7360-100', 1],
    ['BW-7400-100', 1], ['BW-7410-100', 2], ['BW-7430-100', 1], ['BW-M710-100', 1], ['BW-M720-100', 1],
  ], { safety: true }),
  buy('BW-M710-100', 'Electro-optical sensor pod and weather radar', AV, 'Avionics', 'SUP-ALTUS', 244_000, 'avionics', 1, { vol: 'stable' }),
  buy('BW-M720-100', 'Mission management system (cargo and medevac)', AV, 'Avionics', 'SUP-VEYRON', 148_000, 'avionics', 1, { vol: 'stable' }),

  // ------------------------------------------------------------ actuation and thermal
  make('BW-M800-000', 'Actuation and thermal system', AT, 'Assemblies', 'WC-SYS', 70, [
    ['BW-M810-100', 1], ['BW-M820-100', 1], ['BW-M830-100', 1], ['BW-8210-110', 2], ['BW-8220-110', 2], ['BW-8280-100', 1],
  ], { safety: true }),
  buy('BW-M810-100', 'Control surface actuator set (Meridian)', AT, 'Actuation', 'SUP-HOLLIS', 178_000, 'actuators', 1, { safety: true }),
  buy('BW-M820-100', 'Heat exchanger and radiator set (Meridian)', AT, 'Thermal', 'SUP-HOLLIS', 73_000, 'thermal', 1),
  buy('BW-M830-100', 'Coolant hose, valve and fitting set (Meridian)', AT, 'Thermal', 'SUP-HOLLIS', 24_000, 'thermal', 1),

  // ------------------------------------------------------------ electrical, cabin, consumables
  make('BW-M900-000', 'Electrical power distribution system', OT, 'Assemblies', 'WC-SYS', 80, [
    ['BW-M910-100', 1], ['BW-M920-100', 1], ['BW-9120-100', 2], ['BW-9130-100', 2], ['BW-9140-100', 1], ['BW-9150-100', 2], ['BW-9160-100', 1],
  ], { safety: true }),
  buy('BW-M910-100', 'HV feeder harness set (Meridian)', OT, 'Electrical', 'SUP-FERROW', 96_000, 'harness', 1, { safety: true }),
  buy('BW-M920-100', 'Airframe signal harness set (Meridian)', OT, 'Electrical', 'SUP-FERROW', 112_000, 'harness', 1, { safety: true }),
  make('BW-M950-000', 'Cabin: cargo, litter and flight station', OT, 'Assemblies', 'WC-INT', 120, [
    ['BW-9410-100', 1], ['BW-M960-100', 1], ['BW-M970-100', 1], ['BW-9450-100', 1], ['BW-9490-100', 1],
  ], {}),
  buy('BW-M960-100', 'Litter and cargo restraint system', OT, 'Interior', 'SUP-STRATUS', 102_000, 'interior', 1, { safety: true }),
  buy('BW-M970-100', 'Interior panel and trim set (Meridian)', OT, 'Interior', 'SUP-STRATUS', 52_000, 'interior', 1),
  buy('BW-M990-100', 'Fasteners, sealants and finish kit (Meridian)', OT, 'Hardware and consumables', 'SUP-COBALT', 96_000, 'hardware', 1),
];
