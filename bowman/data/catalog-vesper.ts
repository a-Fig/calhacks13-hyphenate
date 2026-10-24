import { buy, make } from './catalog-core.ts';
import type { Row } from './catalog-core.ts';
import { ARCHER, PRACTICE, src } from './prov.ts';

// Vesper V4 catalog. Part numbers are BW-<family>-<sequence>. Families:
//   1xxx airframe   2xxx landing gear   3xxx motors and propulsion units   4xxx propellers
//   5xxx motor controllers (inverters)  6xxx battery   7xxx avionics   8xxx actuation and thermal
//   9xxx electrical, cabin, consumables
// Prices are today's contract prices in USD per unit of measure. Quantities are in the BOM rows.
// The cost-group share of the rolled-up standard cost is tuned in check.ts to the suggested basis
// (avionics 20, motors/inverters/propellers 22, battery 15, airframe 20, actuators/thermal 10, other 13).

const TILT = src(`${ARCHER} §1`, 'Midnight: 12 motors, 12-tilt-6; six forward motors tilt, six aft are fixed lift (FAA final airworthiness criteria, 2024-11192).');
const FWD_PROP = src(`${ARCHER} §1`, 'Forward motors drive 5-blade variable-pitch propellers (FAA 2024-11192).');
const AFT_PROP = src(`${ARCHER} §1`, 'FAA text describes 2-bladed aft propellers; Archer later chose four (Q4 2025 letter).');
const PACKS = src(`${ARCHER} §1`, 'Six packs, about 140 kWh, cylindrical cells. Press-level figure (aggregator), not an Archer disclosure.');
const FCC = src(`${ARCHER} §3`, 'Safran UCAP flight control computer, four per Archer airframe (2023-06-21).');
const DECK = src(`${ARCHER} §3`, 'Garmin G3000 integrated flight deck (2022-11-15).');
const FUSE = src(`${ARCHER} §3`, 'FACC supplies key fuselage and wing elements (Q2 2022 letter).');
const ACT = src(`${ARCHER} §3`, 'Honeywell supplies actuators, climate and thermal management (Q2 2022 letter).');
const PREG = src(`${ARCHER} §3`, 'Hexcel carbon fiber prepreg (letter of intent, April 2022).');
const TOP = src(`${ARCHER} §1`, 'Pilot + 4, MTOW 6,500 lb, 12-tilt-6, composite structure, fixed tricycle gear.');

const AF = 'airframe' as const;
const PT = 'powertrain' as const;
const BT = 'battery' as const;
const AV = 'avionics' as const;
const AT = 'actuation_thermal' as const;
const OT = 'other' as const;

export const vesper: Row[] = [
  // ------------------------------------------------------------ top level
  make('BW-0001-000', 'Vesper V4 air vehicle', OT, 'Aircraft', 'WC-FINAL', 640, [
    ['BW-1000-000', 1], ['BW-2000-000', 1], ['BW-3000-000', 1], ['BW-3500-000', 1], ['BW-6000-000', 1],
    ['BW-7000-000', 1], ['BW-8000-000', 1], ['BW-8200-000', 1], ['BW-9100-000', 1], ['BW-9300-100', 1],
    ['BW-9400-000', 1], ['BW-9600-000', 1],
  ], { kind: 'aircraft', safety: true, prov: TOP }),

  // ------------------------------------------------------------ 1000 airframe
  make('BW-1000-000', 'Airframe structure', AF, 'Assemblies', 'WC-STRUCT', 460, [
    ['BW-1110-100', 1], ['BW-1120-100', 1], ['BW-1130-100', 1], ['BW-1140-100', 1], ['BW-1150-100', 1], ['BW-1160-100', 2],
    ['BW-1200-000', 1], ['BW-1300-000', 1], ['BW-1410-000', 6], ['BW-1420-000', 2], ['BW-1500-100', 1],
  ], { safety: true }),
  buy('BW-1110-100', 'Fuselage shell, forward, carbon/epoxy', AF, 'Composite structure', 'SUP-TARN', 73_500, 'tier1', 1, { safety: true, vol: 'stable', prov: FUSE }),
  buy('BW-1120-100', 'Fuselage shell, aft, carbon/epoxy', AF, 'Composite structure', 'SUP-TARN', 59_800, 'tier1', 1, { safety: true, vol: 'stable' }),
  buy('BW-1130-100', 'Cabin floor panel assembly', AF, 'Composite structure', 'SUP-TARN', 17_400, 'tier1', 1, { safety: true }),
  buy('BW-1140-100', 'Bulkhead set, five composite bulkheads', AF, 'Composite structure', 'SUP-TARN', 23_600, 'tier1', 1, { safety: true }),
  buy('BW-1150-100', 'Canopy and windshield transparency', AF, 'Composite structure', 'SUP-TARN', 27_000, 'tier1', 1),
  buy('BW-1160-100', 'Cabin door assembly', AF, 'Composite structure', 'SUP-TARN', 11_400, 'tier1', 1, { safety: true }),
  make('BW-1200-000', 'Wing assembly', AF, 'Assemblies', 'WC-STRUCT', 140, [
    ['BW-1210-000', 2], ['BW-1230-100', 4], ['BW-1240-100', 1], ['BW-1250-100', 1],
  ], { safety: true }),
  make('BW-1210-000', 'Wing box, carbon (left or right)', AF, 'Assemblies', 'WC-LAYUP', 140, [
    ['BW-1910-100', 95], ['BW-1920-100', 6], ['BW-1930-100', 8], ['BW-1940-100', 1], ['BW-1215-100', 1], ['BW-1216-100', 1],
  ], { safety: true }),
  buy('BW-1215-100', 'Wing attach fitting set, machined titanium', AF, 'Machined parts', 'SUP-HALDEN', 4_300, 'machined', 1, { safety: true, alt: { supplier: 'SUP-COBALT', priceFactor: 1.08, share: 0.2 } }),
  buy('BW-1216-100', 'Flaperon hinge set', AF, 'Machined parts', 'SUP-HALDEN', 1_850, 'machined', 1, { alt: { supplier: 'SUP-COBALT', priceFactor: 1.06, share: 0.25 } }),
  buy('BW-1230-100', 'Flaperon, composite', AF, 'Composite structure', 'SUP-TARN', 3_500, 'tier1', 1),
  buy('BW-1240-100', 'Wing leading-edge and skin fairing set', AF, 'Composite structure', 'SUP-TARN', 10_400, 'tier1', 1),
  buy('BW-1250-100', 'Lightning-strike protection mesh kit', AF, 'Raw material', 'SUP-CARDINAL', 6_300, 'rawsmall', 1),
  make('BW-1300-000', 'V-tail assembly', AF, 'Assemblies', 'WC-STRUCT', 90, [['BW-1310-000', 2], ['BW-1320-100', 4]], { safety: true }),
  make('BW-1310-000', 'V-tail half, carbon', AF, 'Assemblies', 'WC-LAYUP', 95, [
    ['BW-1910-100', 55], ['BW-1920-100', 3], ['BW-1930-100', 4], ['BW-1940-100', 1], ['BW-1315-100', 1],
  ], { safety: true }),
  buy('BW-1315-100', 'V-tail attach fitting set', AF, 'Machined parts', 'SUP-HALDEN', 2_800, 'machined', 1, { safety: true }),
  buy('BW-1320-100', 'Ruddervator, composite', AF, 'Composite structure', 'SUP-TARN', 3_300, 'tier1', 1, { safety: true }),
  make('BW-1410-000', 'Forward tilt pylon', AF, 'Assemblies', 'WC-LAYUP', 18, [
    ['BW-1910-100', 14], ['BW-1940-100', 1], ['BW-1411-100', 1], ['BW-1412-100', 1],
  ], { safety: true }),
  buy('BW-1411-100', 'Tilt fitting, machined', AF, 'Machined parts', 'SUP-HALDEN', 3_100, 'machined', 1, { safety: true }),
  buy('BW-1412-100', 'Tilt bearing set', AF, 'Hardware and consumables', 'SUP-COBALT', 1_350, 'bearings', 1, { safety: true }),
  make('BW-1420-000', 'Aft boom, carbon', AF, 'Assemblies', 'WC-LAYUP', 110, [
    ['BW-1910-100', 70], ['BW-1920-100', 5], ['BW-1930-100', 6], ['BW-1940-100', 1], ['BW-1421-100', 3],
  ], { safety: true }),
  buy('BW-1421-100', 'Aft motor mount fitting', AF, 'Machined parts', 'SUP-HALDEN', 1_600, 'machined', 3, { safety: true }),
  buy('BW-1500-100', 'Aerodynamic fairing and seal kit', AF, 'Composite structure', 'SUP-TARN', 21_500, 'tier1', 1),
  buy('BW-1910-100', 'Carbon/epoxy prepreg', AF, 'Raw material', 'SUP-CARDINAL', 92, 'prepreg', 200, { uom: 'kg', kind: 'material', vol: 'volatile', prov: PREG }),
  buy('BW-1920-100', 'Honeycomb core', AF, 'Raw material', 'SUP-CARDINAL', 205, 'prepreg', 20, { uom: 'm2', kind: 'material' }),
  buy('BW-1930-100', 'Film adhesive', AF, 'Raw material', 'SUP-CARDINAL', 31, 'rawsmall', 20, { uom: 'm2', kind: 'material' }),
  buy('BW-1940-100', 'Layup and bagging consumables kit', AF, 'Raw material', 'SUP-CARDINAL', 940, 'rawsmall', 5, { kind: 'material' }),

  // ------------------------------------------------------------ 2000 landing gear
  make('BW-2000-000', 'Landing gear assembly, fixed tricycle', OT, 'Assemblies', 'WC-STRUCT', 40, [
    ['BW-2100-100', 1], ['BW-2200-100', 2], ['BW-2300-100', 3], ['BW-2500-100', 3],
  ], { safety: true }),
  buy('BW-2100-100', 'Nose gear assembly', OT, 'Landing gear', 'SUP-STRATUS', 16_700, 'gear', 1, { safety: true }),
  buy('BW-2200-100', 'Main gear leg, composite spring', OT, 'Landing gear', 'SUP-STRATUS', 11_100, 'gear', 1, { safety: true }),
  buy('BW-2300-100', 'Wheel, brake and tire assembly', OT, 'Landing gear', 'SUP-STRATUS', 5_250, 'gear', 1, { safety: true }),
  buy('BW-2500-100', 'Wheel fairing', OT, 'Composite structure', 'SUP-TARN', 1_380, 'tier1', 1),

  // ------------------------------------------------------------ 3000 forward propulsion (6 tilting units)
  make('BW-3000-000', 'Forward propulsion system', PT, 'Assemblies', 'WC-SYS', 30, [['BW-3010-000', 6]], { safety: true }),
  make('BW-3010-000', 'Forward propulsor unit (motor, propeller, controller)', PT, 'Assemblies', 'WC-SYS', 8, [
    ['BW-3100-000', 1], ['BW-4100-000', 1], ['BW-5100-000', 1],
  ], { safety: true, prov: TILT }),
  make('BW-3100-000', 'Forward motor assembly', PT, 'Assemblies', 'WC-MOTOR', 22, [
    ['BW-3110-100', 1], ['BW-3120-000', 1], ['BW-3130-100', 1], ['BW-3140-100', 1], ['BW-3150-100', 2],
    ['BW-3160-100', 1], ['BW-3170-100', 1], ['BW-3180-100', 1], ['BW-3190-100', 1],
  ], { safety: true }),
  buy('BW-3110-100', 'Stator, wound and potted (forward)', PT, 'Motor components', 'SUP-NORTHGATE', 7_800, 'windings', 6, { safety: true }),
  make('BW-3120-000', 'Rotor assembly (forward)', PT, 'Assemblies', 'WC-MOTOR', 6, [['BW-3120-340', 1], ['BW-3125-100', 1], ['BW-3126-100', 1]], { safety: true }),
  buy('BW-3120-340', 'Rotor magnet segment set, SH grade (forward)', PT, 'Motor components', 'SUP-ORRIN', 8_000, 'magnets', 6, { safety: true, vol: 'volatile' }),
  buy('BW-3125-100', 'Rotor core and hub, machined (forward)', PT, 'Machined parts', 'SUP-HALDEN', 1_520, 'machined', 6, { safety: true }),
  buy('BW-3126-100', 'Magnet retention sleeve, carbon (forward)', PT, 'Motor components', 'SUP-TARN', 710, 'tier1', 12, { safety: true, rev: 'B' }),
  buy('BW-3130-100', 'Motor housing with cooling jacket (forward)', PT, 'Machined parts', 'SUP-HALDEN', 1_880, 'machined', 6, { alt: { supplier: 'SUP-COBALT', priceFactor: 1.07, share: 0.2 } }),
  buy('BW-3140-100', 'Bearing set, hybrid ceramic (forward)', PT, 'Hardware and consumables', 'SUP-COBALT', 1_120, 'bearings', 6, { safety: true, rev: 'B' }),
  buy('BW-3150-100', 'Rotor position sensor (resolver)', PT, 'Motor components', 'SUP-NORTHGATE', 470, 'electronics', 12, { safety: true }),
  buy('BW-3160-100', 'Motor shaft (forward)', PT, 'Machined parts', 'SUP-HALDEN', 900, 'machined', 6, { safety: true }),
  buy('BW-3170-100', 'Seal and hardware kit (forward motor)', PT, 'Hardware and consumables', 'SUP-COBALT', 230, 'hardware', 50),
  buy('BW-3180-100', 'Winding temperature sensor set (forward motor)', PT, 'Motor components', 'SUP-NORTHGATE', 140, 'electronics', 24),
  buy('BW-3190-100', 'HV motor terminal block and connector', PT, 'Electrical', 'SUP-DUNMORE', 420, 'harness', 20, { rev: 'B', safety: true }),

  // ------------------------------------------------------------ 3500 aft propulsion (6 fixed lift units)
  make('BW-3500-000', 'Aft propulsion system', PT, 'Assemblies', 'WC-SYS', 24, [['BW-3510-000', 6]], { safety: true }),
  make('BW-3510-000', 'Aft propulsor unit (motor, propeller, controller)', PT, 'Assemblies', 'WC-SYS', 6, [
    ['BW-3200-000', 1], ['BW-4200-000', 1], ['BW-5200-000', 1],
  ], { safety: true, prov: TILT }),
  make('BW-3200-000', 'Aft motor assembly', PT, 'Assemblies', 'WC-MOTOR', 16, [
    ['BW-3210-100', 1], ['BW-3220-000', 1], ['BW-3230-100', 1], ['BW-3240-100', 1], ['BW-3150-100', 2],
    ['BW-3260-100', 1], ['BW-3190-100', 1],
  ], { safety: true }),
  buy('BW-3210-100', 'Stator, wound and potted (aft)', PT, 'Motor components', 'SUP-NORTHGATE', 5_200, 'windings', 6, { safety: true }),
  make('BW-3220-000', 'Rotor assembly (aft)', PT, 'Assemblies', 'WC-MOTOR', 4, [['BW-3220-340', 1], ['BW-3226-100', 1]], { safety: true }),
  buy('BW-3220-340', 'Rotor magnet segment set, SH grade (aft)', PT, 'Motor components', 'SUP-ORRIN', 4_800, 'magnets', 6, { safety: true, vol: 'volatile' }),
  buy('BW-3226-100', 'Rotor core, hub and retention sleeve (aft)', PT, 'Motor components', 'SUP-HALDEN', 1_480, 'machined', 6, { safety: true }),
  buy('BW-3230-100', 'Motor housing with cooling jacket (aft)', PT, 'Machined parts', 'SUP-HALDEN', 1_330, 'machined', 6, { alt: { supplier: 'SUP-COBALT', priceFactor: 1.07, share: 0.2 } }),
  buy('BW-3240-100', 'Bearing set, hybrid ceramic (aft)', PT, 'Hardware and consumables', 'SUP-COBALT', 860, 'bearings', 6, { safety: true, rev: 'B' }),
  buy('BW-3260-100', 'Motor shaft (aft)', PT, 'Machined parts', 'SUP-HALDEN', 640, 'machined', 6, { safety: true }),

  // ------------------------------------------------------------ 4000 propellers
  make('BW-4100-000', 'Forward propeller assembly, 5-blade variable pitch', PT, 'Propeller', 'WC-MOTOR', 6, [
    ['BW-4110-100', 1], ['BW-4120-100', 5], ['BW-4130-100', 1], ['BW-4140-100', 1], ['BW-4150-100', 1],
  ], { safety: true, prov: FWD_PROP }),
  buy('BW-4110-100', 'Propeller hub, 5-blade variable pitch', PT, 'Propeller', 'SUP-HALVORSEN', 6_670, 'props', 1, { safety: true }),
  buy('BW-4120-100', 'Propeller blade, forward, carbon', PT, 'Propeller', 'SUP-HALVORSEN', 1_540, 'props', 5, { safety: true }),
  buy('BW-4130-100', 'Pitch change actuator', PT, 'Propeller', 'SUP-HALVORSEN', 3_950, 'props', 1, { safety: true }),
  buy('BW-4140-100', 'Spinner (forward)', PT, 'Propeller', 'SUP-HALVORSEN', 490, 'props', 6),
  buy('BW-4150-100', 'Balance weights and hardware (forward propeller)', PT, 'Hardware and consumables', 'SUP-COBALT', 260, 'hardware', 50),
  make('BW-4200-000', 'Aft propeller assembly, 2-blade fixed pitch', PT, 'Propeller', 'WC-MOTOR', 4, [
    ['BW-4210-100', 1], ['BW-4220-100', 2], ['BW-4230-100', 2], ['BW-4240-100', 1], ['BW-4250-100', 1],
  ], { safety: true, prov: AFT_PROP }),
  buy('BW-4210-100', 'Propeller hub, 2-blade fixed pitch', PT, 'Propeller', 'SUP-HALVORSEN', 2_500, 'props', 1, { safety: true }),
  buy('BW-4220-100', 'Propeller blade, aft 2-blade, carbon', PT, 'Propeller', 'SUP-HALVORSEN', 1_330, 'props', 4, { safety: true }),
  buy('BW-4230-100', 'Blade damper (aft)', PT, 'Propeller', 'SUP-HALVORSEN', 560, 'props', 4, { safety: true }),
  buy('BW-4240-100', 'Spinner and fairing cap (aft)', PT, 'Propeller', 'SUP-HALVORSEN', 280, 'props', 6),
  buy('BW-4250-100', 'Propeller position lock actuator (aft)', PT, 'Propeller', 'SUP-HALVORSEN', 1_450, 'actuators', 1, { safety: true }),
  // Proposed by ECR-0409 (aft propeller 2 to 4 blades). Not in any released BOM.
  buy('BW-4210-200', 'Propeller hub, 4-blade fixed pitch', PT, 'Propeller', 'SUP-HALVORSEN', 3_950, 'props', 1, { safety: true, status: 'proposed', prov: src('ECR-0409', 'Halvorsen budgetary quote; invented, anchored to the 2-blade hub price.') }),
  buy('BW-4220-200', 'Propeller blade, aft 4-blade, carbon', PT, 'Propeller', 'SUP-HALVORSEN', 930, 'props', 8, { safety: true, status: 'proposed' }),
  buy('BW-4240-200', 'Spinner and fairing cap (aft, 4-blade)', PT, 'Propeller', 'SUP-HALVORSEN', 330, 'props', 6, { status: 'proposed' }),

  // ------------------------------------------------------------ 5000 motor controllers (inverters)
  make('BW-5100-000', 'Motor controller, forward (inverter)', PT, 'Assemblies', 'WC-PE', 14, [
    ['BW-5110-100', 3], ['BW-5130-100', 1], ['BW-5140-100', 1], ['BW-5150-100', 1], ['BW-5160-100', 1],
    ['BW-5170-100', 1], ['BW-5180-100', 1], ['BW-5190-100', 3], ['BW-5195-100', 1], ['BW-5120-000', 1],
  ], { safety: true }),
  make('BW-5200-000', 'Motor controller, aft (inverter)', PT, 'Assemblies', 'WC-PE', 12, [
    ['BW-5210-100', 3], ['BW-5230-100', 1], ['BW-5140-100', 1], ['BW-5150-100', 1], ['BW-5260-100', 1],
    ['BW-5270-100', 1], ['BW-5190-100', 3], ['BW-5195-100', 1], ['BW-5120-000', 1],
  ], { safety: true }),
  make('BW-5120-000', 'Motor controller mount kit', PT, 'Assemblies', 'WC-PE', 0.5, [
    ['BW-5120-210', 1], ['BW-5120-220', 4], ['BW-5120-230', 1],
  ], {
    safety: false,
    prov: src(`${PRACTICE} §1`, 'Worked example ECR-0417: bracket count of 12 per aircraft is one per controller, six forward and six aft.'),
  }),
  buy('BW-5120-210', 'Motor controller mounting bracket, machined plate', PT, 'Machined parts', 'SUP-HALDEN', 186.4, 'machined', 25, {
    rev: 'B', vol: 'stable',
    prov: src(`${PRACTICE} §1`, 'Worked example ECR-0417: Rev B standard $186.40, Rev B to Rev C. Illustrative in the source.'),
  }),
  buy('BW-5120-220', 'Vibration isolator, controller mount', PT, 'Hardware and consumables', 'SUP-COBALT', 24, 'hardware', 100),
  buy('BW-5120-230', 'Mount hardware kit (fasteners, washers)', PT, 'Hardware and consumables', 'SUP-COBALT', 38, 'hardware', 100),
  buy('BW-5110-100', 'SiC power module, 1200 V half-bridge (forward)', PT, 'Power electronics', 'SUP-NORTHGATE', 2_550, 'powersemi', 12, { vol: 'volatile', safety: true }),
  buy('BW-5130-100', 'DC-link capacitor (forward)', PT, 'Power electronics', 'SUP-NORTHGATE', 780, 'electronics', 12),
  buy('BW-5140-100', 'Gate driver board', PT, 'Power electronics', 'SUP-NORTHGATE', 510, 'electronics', 12),
  buy('BW-5150-100', 'Controller control board (MCU, programmed)', PT, 'Power electronics', 'SUP-NORTHGATE', 1_780, 'electronics', 12, { safety: true }),
  buy('BW-5160-100', 'Cold plate (forward controller)', PT, 'Machined parts', 'SUP-HALDEN', 1_020, 'machined', 6),
  buy('BW-5170-100', 'Controller enclosure (forward)', PT, 'Machined parts', 'SUP-HALDEN', 1_320, 'machined', 6),
  buy('BW-5180-100', 'Busbar set (forward controller)', PT, 'Power electronics', 'SUP-NORTHGATE', 640, 'electronics', 12),
  buy('BW-5190-100', 'Current sensor', PT, 'Power electronics', 'SUP-NORTHGATE', 115, 'electronics', 50),
  buy('BW-5195-100', 'Controller HV/LV connector set', PT, 'Electrical', 'SUP-DUNMORE', 370, 'harness', 20),
  buy('BW-5210-100', 'SiC power module, 1200 V half-bridge (aft)', PT, 'Power electronics', 'SUP-NORTHGATE', 1_920, 'powersemi', 12, { vol: 'volatile', safety: true }),
  buy('BW-5230-100', 'DC-link capacitor (aft)', PT, 'Power electronics', 'SUP-NORTHGATE', 600, 'electronics', 12),
  buy('BW-5260-100', 'Cold plate (aft controller)', PT, 'Machined parts', 'SUP-HALDEN', 800, 'machined', 6),
  buy('BW-5270-100', 'Controller enclosure (aft)', PT, 'Machined parts', 'SUP-HALDEN', 1_040, 'machined', 6),

  // ------------------------------------------------------------ 6000 battery system (6 packs, ~140 kWh, cylindrical cells)
  make('BW-6000-000', 'Battery system (six packs)', BT, 'Assemblies', 'WC-PACK', 12, [['BW-6100-000', 6]], { safety: true, prov: PACKS }),
  make('BW-6100-000', 'Battery pack, 800 V, about 24 kWh', BT, 'Assemblies', 'WC-PACK', 40, [
    ['BW-6120-000', 6], ['BW-6130-100', 1], ['BW-6140-100', 1], ['BW-6150-100', 1], ['BW-6160-100', 1], ['BW-6170-100', 1], ['BW-6180-100', 1], ['BW-6190-100', 1],
  ], { safety: true }),
  make('BW-6120-000', 'Cell module, 36s7p (252 cells)', BT, 'Assemblies', 'WC-PACK', 10, [
    ['BW-6110-100', 252], ['BW-6121-100', 1], ['BW-6122-100', 1], ['BW-6123-100', 1], ['BW-6124-100', 1],
  ], { safety: true }),
  buy('BW-6110-100', 'Lithium-ion cell, 21700, aviation lot-screened', BT, 'Cells and battery', 'SUP-VANTAGE', 11.1, 'cells', 5000, { vol: 'cells', safety: true, rev: 'B' }),
  buy('BW-6121-100', 'Cell carrier and potting set', BT, 'Cells and battery', 'SUP-COBALT', 1_150, 'hardware', 12, { safety: true }),
  buy('BW-6122-100', 'Module interconnect set, laser-welded busbar', BT, 'Cells and battery', 'SUP-NORTHGATE', 1_430, 'electronics', 12, { safety: true, rev: 'B' }),
  buy('BW-6123-100', 'Module cooling plate', BT, 'Cells and battery', 'SUP-HALDEN', 1_330, 'machined', 12),
  buy('BW-6124-100', 'Module sense harness', BT, 'Cells and battery', 'SUP-DUNMORE', 490, 'harness', 12),
  buy('BW-6130-100', 'Pack enclosure with fire shield', BT, 'Cells and battery', 'SUP-TARN', 5_100, 'tier1', 1, { safety: true }),
  buy('BW-6140-100', 'Battery management system, pack master', BT, 'Cells and battery', 'SUP-NORTHGATE', 3_100, 'electronics', 6, { safety: true }),
  buy('BW-6150-100', 'HV junction box with contactors and fuse', BT, 'Cells and battery', 'SUP-DUNMORE', 4_100, 'harness', 6, { safety: true }),
  buy('BW-6160-100', 'Pack cooling manifold', BT, 'Cells and battery', 'SUP-HOLLIS', 1_500, 'thermal', 6),
  buy('BW-6170-100', 'Vent and fire-containment kit', BT, 'Cells and battery', 'SUP-COBALT', 2_200, 'hardware', 6, { safety: true }),

  buy('BW-6180-100', 'Pack harness', BT, 'Cells and battery', 'SUP-DUNMORE', 1_200, 'harness', 6),
  buy('BW-6190-100', 'Pack hardware and seals kit', BT, 'Cells and battery', 'SUP-COBALT', 520, 'hardware', 12),

  // ------------------------------------------------------------ 7000 avionics and flight control
  make('BW-7000-000', 'Avionics and flight control system', AV, 'Assemblies', 'WC-AVI', 220, [
    ['BW-7110-100', 3], ['BW-7120-100', 1], ['BW-7130-100', 2], ['BW-7200-100', 4], ['BW-7210-100', 1], ['BW-7220-100', 2],
    ['BW-7300-100', 3], ['BW-7310-100', 2], ['BW-7320-100', 2], ['BW-7330-100', 1], ['BW-7340-100', 1], ['BW-7360-100', 1],
    ['BW-7400-100', 1], ['BW-7410-100', 2], ['BW-7430-100', 1],
  ], { safety: true }),
  buy('BW-7110-100', 'Integrated flight deck display, 10-inch touchscreen', AV, 'Avionics', 'SUP-ALTUS', 33_000, 'avionics', 1, { safety: true, vol: 'stable', rev: 'B', prov: DECK }),
  buy('BW-7120-100', 'Flight deck touch controller', AV, 'Avionics', 'SUP-ALTUS', 9_900, 'avionics', 1, { vol: 'stable' }),
  buy('BW-7130-100', 'Integrated avionics unit', AV, 'Avionics', 'SUP-ALTUS', 19_000, 'avionics', 1, { safety: true, vol: 'stable' }),
  buy('BW-7200-100', 'Flight control computer', AV, 'Avionics', 'SUP-VEYRON', 43_300, 'avionics', 1, { safety: true, vol: 'stable', prov: FCC }),
  buy('BW-7210-100', 'Vehicle management computer', AV, 'Avionics', 'SUP-VEYRON', 49_000, 'avionics', 1, { safety: true, vol: 'stable' }),
  buy('BW-7220-100', 'Pilot inceptor, sidestick', AV, 'Avionics', 'SUP-VEYRON', 15_000, 'avionics', 1, { safety: true, vol: 'stable' }),
  buy('BW-7300-100', 'Air data and attitude reference unit', AV, 'Avionics', 'SUP-ALTUS', 12_200, 'avionics', 1, { safety: true, vol: 'stable' }),
  buy('BW-7310-100', 'GNSS receiver', AV, 'Avionics', 'SUP-ALTUS', 5_600, 'avionics', 1, { vol: 'stable' }),
  buy('BW-7320-100', 'VHF communication radio', AV, 'Avionics', 'SUP-ALTUS', 9_200, 'avionics', 1, { vol: 'stable' }),
  buy('BW-7330-100', 'Mode S transponder with ADS-B', AV, 'Avionics', 'SUP-ALTUS', 10_200, 'avionics', 1, { vol: 'stable' }),
  buy('BW-7340-100', 'Radar altimeter', AV, 'Avionics', 'SUP-VEYRON', 15_100, 'avionics', 1, { safety: true, vol: 'stable' }),
  buy('BW-7360-100', 'Standby instrument', AV, 'Avionics', 'SUP-ALTUS', 6_500, 'avionics', 1, { vol: 'stable' }),
  buy('BW-7400-100', 'Flight data and voice recorder', AV, 'Avionics', 'SUP-VEYRON', 11_500, 'avionics', 1, { vol: 'stable' }),
  buy('BW-7410-100', 'Avionics network switch', AV, 'Avionics', 'SUP-VEYRON', 8_100, 'avionics', 1, { safety: true, vol: 'stable' }),
  buy('BW-7430-100', 'Datalink and satcom antenna set', AV, 'Avionics', 'SUP-ALTUS', 12_500, 'avionics', 1, { vol: 'stable' }),

  // ------------------------------------------------------------ 8000 actuation, 8200 thermal
  make('BW-8000-000', 'Actuation system', AT, 'Assemblies', 'WC-SYS', 36, [
    ['BW-8110-100', 6], ['BW-8120-100', 4], ['BW-8130-100', 4], ['BW-8140-100', 2],
  ], { safety: true }),
  buy('BW-8110-100', 'Tilt actuator, dual-redundant electromechanical', AT, 'Actuation', 'SUP-HOLLIS', 19_400, 'actuators', 1, { safety: true, rev: 'B', prov: ACT }),
  buy('BW-8120-100', 'Flaperon actuator, electromechanical', AT, 'Actuation', 'SUP-HOLLIS', 9_200, 'actuators', 1, { safety: true }),
  buy('BW-8130-100', 'Ruddervator actuator, electromechanical', AT, 'Actuation', 'SUP-HOLLIS', 9_700, 'actuators', 1, { safety: true }),
  buy('BW-8140-100', 'Actuator interface electronics', AT, 'Actuation', 'SUP-HOLLIS', 3_400, 'actuators', 2, { safety: true }),
  make('BW-8200-000', 'Thermal management system', AT, 'Assemblies', 'WC-SYS', 44, [
    ['BW-8210-110', 2], ['BW-8220-110', 2], ['BW-8230-100', 2], ['BW-8240-100', 1], ['BW-8250-100', 1], ['BW-8260-100', 6], ['BW-8270-100', 20], ['BW-8280-100', 1], ['BW-8290-100', 1],
  ], {}),
  buy('BW-8210-110', 'Battery loop coolant pump', AT, 'Thermal', 'SUP-HOLLIS', 3_400, 'thermal', 2, { rev: 'B', safety: true }),
  buy('BW-8220-110', 'Powertrain loop coolant pump', AT, 'Thermal', 'SUP-HOLLIS', 2_980, 'thermal', 2, { rev: 'A', safety: true }),
  buy('BW-8230-100', 'Heat exchanger and radiator', AT, 'Thermal', 'SUP-HOLLIS', 10_800, 'thermal', 1),
  buy('BW-8240-100', 'Coolant reservoir and fill assembly', AT, 'Thermal', 'SUP-HOLLIS', 1_900, 'thermal', 1),
  buy('BW-8250-100', 'Coolant hose and fitting set', AT, 'Thermal', 'SUP-HOLLIS', 7_200, 'thermal', 1),
  buy('BW-8260-100', 'Flow control valve', AT, 'Thermal', 'SUP-HOLLIS', 650, 'thermal', 6),
  buy('BW-8270-100', 'Coolant, glycol-water mix', AT, 'Thermal', 'SUP-COBALT', 9, 'hardware', 20, { uom: 'L', kind: 'material' }),
  buy('BW-8280-100', 'Cabin environmental control unit', AT, 'Thermal', 'SUP-HOLLIS', 20_400, 'thermal', 1),
  buy('BW-8290-100', 'Air duct and louvre set', AT, 'Thermal', 'SUP-TARN', 5_400, 'tier1', 1),

  // ------------------------------------------------------------ 9000 electrical, cabin, consumables
  make('BW-9100-000', 'Electrical power distribution system', OT, 'Assemblies', 'WC-SYS', 50, [
    ['BW-9110-100', 1], ['BW-9120-100', 2], ['BW-9130-100', 2], ['BW-9140-100', 1], ['BW-9150-100', 2], ['BW-9160-100', 1],
  ], { safety: true }),
  buy('BW-9110-100', 'HV feeder harness set', OT, 'Electrical', 'SUP-DUNMORE', 30_400, 'harness', 1, { safety: true }),
  buy('BW-9120-100', 'HV power distribution unit', OT, 'Electrical', 'SUP-NORTHGATE', 12_500, 'electronics', 1, { safety: true }),
  buy('BW-9130-100', 'DC-DC converter, HV to 28 V', OT, 'Electrical', 'SUP-NORTHGATE', 5_150, 'electronics', 1),
  buy('BW-9140-100', 'Charge inlet and ground interface', OT, 'Electrical', 'SUP-DUNMORE', 6_500, 'harness', 1),
  buy('BW-9150-100', '28 V backup battery', OT, 'Electrical', 'SUP-NORTHGATE', 1_800, 'electronics', 2, { safety: true }),
  buy('BW-9160-100', 'LV power distribution unit', OT, 'Electrical', 'SUP-NORTHGATE', 10_800, 'electronics', 1, { safety: true }),
  buy('BW-9300-100', 'Airframe signal harness set', OT, 'Electrical', 'SUP-DUNMORE', 38_600, 'harness', 1, { safety: true }),
  make('BW-9400-000', 'Cabin interior', OT, 'Assemblies', 'WC-INT', 90, [
    ['BW-9410-100', 1], ['BW-9420-100', 4], ['BW-9430-100', 5], ['BW-9440-010', 1], ['BW-9440-030', 6], ['BW-9450-100', 1], ['BW-9490-100', 1],
  ], {}),
  buy('BW-9410-100', 'Pilot seat, crashworthy', OT, 'Interior', 'SUP-STRATUS', 7_300, 'interior', 1, { safety: true }),
  buy('BW-9420-100', 'Passenger seat, crashworthy', OT, 'Interior', 'SUP-STRATUS', 4_450, 'interior', 4, { safety: true }),
  buy('BW-9430-100', 'Four-point harness', OT, 'Interior', 'SUP-STRATUS', 500, 'interior', 5, { safety: true }),
  buy('BW-9440-010', 'Sidewall, headliner and floor trim set', OT, 'Interior', 'SUP-STRATUS', 15_800, 'interior', 1),
  buy('BW-9440-030', 'Avionics bay closeout panel, internal, light grey', OT, 'Interior', 'SUP-STRATUS', 41.5, 'interior', 60, {
    alt: { supplier: 'SUP-TARN', priceFactor: 1.12, share: 0.1 },
  }),
  buy('BW-9450-100', 'Cabin lighting set (reading and emergency egress lighting)', OT, 'Interior', 'SUP-STRATUS', 3_500, 'interior', 1, { safety: true }),
  buy('BW-9490-100', 'Safety equipment kit', OT, 'Interior', 'SUP-COBALT', 3_300, 'hardware', 1, { safety: true }),
  make('BW-9600-000', 'Fasteners, sealants and finish kit', OT, 'Assemblies', undefined, 0, [
    ['BW-9610-100', 1], ['BW-9620-100', 1], ['BW-9630-100', 1],
  ], {}),
  buy('BW-9610-100', 'Fastener kit, aircraft set', OT, 'Hardware and consumables', 'SUP-COBALT', 11_700, 'hardware', 1, { rev: 'B' }),
  buy('BW-9620-100', 'Sealant and adhesive kit', OT, 'Hardware and consumables', 'SUP-CARDINAL', 4_300, 'rawsmall', 1),
  buy('BW-9630-100', 'Primer, topcoat and livery (applied)', OT, 'Hardware and consumables', 'SUP-COBALT', 16_400, 'interior', 1),
];
