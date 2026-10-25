// The ECR list and pages. Bowman's ten open ECRs plus the ten released ECOs of the last 18 months.
// Every year-one cost is the real checks' (norn/checks) result on the dataset, saved in
// ../fixtures/list-costs.json by web/scripts/make-fixtures.ts. ECR-0417, ECR-0409 and ECR-0423
// carry a full impact assessment; the rest show only the backlog row. The reviewers, comments and
// flags are mock.
import listCosts from '../fixtures/list-costs.json';
import type { EcrSummary, ImpactAssessment } from '../types.ts';
import { ecr0409, ecr0409Summary } from './ecr0409.ts';
import { ecr0417, ecr0417Summary } from './ecr0417.ts';
import { ecr0423, ecr0423Summary } from './ecr0423.ts';

const PT = '-07:00';
const costOf = (id: keyof typeof listCosts) => ({ p10: listCosts[id].p10, p50: listCosts[id].p50, p90: listCosts[id].p90, point: listCosts[id].point, from: listCosts[id].from });

const others: EcrSummary[] = [
  {
    id: 'ECR-0421', title: 'Meridian cruise motor magnets BW-M512-340: qualify UH grade for the first-flight rotors',
    program: 'Meridian', partNumber: 'BW-M512-340', companyClass: 'I', faa: 'major', priority: 'Routine', status: 'Submitted',
    level: 1,
    lastActivity: `2026-10-22T11:40:00${PT}`, lastActivityBy: 'Fern posted Level 1',
    originator: 'Nikhil Desai', filedOn: '2026-10-21', flag: 'Shares Orrin’s one qualification slot with ECR-0419', hasAssessment: false,
  },
  {
    id: 'ECR-0419', title: 'Forward rotor magnet set BW-3120-340: SH grade to UH grade',
    program: 'Vesper', partNumber: 'BW-3120-340', companyClass: 'I', faa: 'major', priority: 'Urgent', status: 'Submitted',
    level: 1,
    lastActivity: `2026-10-21T15:05:00${PT}`, lastActivityBy: 'Fern posted Level 1',
    originator: 'Maren Solheim', filedOn: '2026-10-20', flag: 'Shares Orrin’s one qualification slot with ECR-0421', hasAssessment: false,
  },
  {
    id: 'ECR-0415', title: 'Coolant pump BW-8210-110 Rev C: low-cost polymer housing',
    program: 'Vesper', partNumber: 'BW-8210-110', companyClass: 'I', faa: 'minor', priority: 'Routine', status: 'Submitted',
    level: 1,
    lastActivity: `2026-10-20T10:12:00${PT}`, lastActivityBy: 'Fern posted Level 1',
    originator: 'Wei-Lin Zhao', filedOn: '2026-10-13', flag: 'Conflicts with ECR-0412 on the same pump', hasAssessment: false,
  },
  {
    id: 'ECR-0412', title: 'Battery loop coolant pump BW-8210-110 Rev C: higher flow',
    program: 'Vesper', partNumber: 'BW-8210-110', companyClass: 'I', faa: 'minor', priority: 'Urgent', status: 'In review',
    level: 2,
    lastActivity: `2026-10-22T09:30:00${PT}`, lastActivityBy: 'Fern posted Level 2',
    originator: 'Tomasz Wierzbicki', filedOn: '2026-10-09', flag: 'Conflicts with ECR-0415 on the same pump', hasAssessment: false,
  },
  {
    id: 'ECR-0410', title: 'Drop the second DC-DC converter',
    program: 'Vesper', partNumber: undefined, companyClass: 'I', faa: 'major', priority: 'Routine', status: 'Submitted',
    level: 1,
    lastActivity: `2026-10-20T14:48:00${PT}`, lastActivityBy: 'Fern posted Level 1',
    originator: 'Wei-Lin Zhao', filedOn: '2026-10-07', flag: 'Removes redundancy: filed FAA minor, Fern says major', hasAssessment: false,
  },
  {
    id: 'ECR-0407', title: 'Carbon prepreg: move to Cardinal’s new resin system',
    program: 'Vesper', partNumber: undefined, companyClass: 'I', faa: 'major', priority: 'Routine', status: 'Submitted',
    level: 1,
    lastActivity: `2026-10-20T09:20:00${PT}`, lastActivityBy: 'Fern posted Level 1',
    originator: 'Wei-Lin Zhao', filedOn: '2026-10-03', flag: 'Qualification is not on the ECR: filed FAA minor, Fern says likely major', hasAssessment: false,
  },
  {
    id: 'ECR-0406', title: 'Cabin lighting set: LED strip v2',
    program: 'Vesper', partNumber: undefined, companyClass: 'I', faa: 'minor', priority: 'Routine', status: 'Submitted',
    level: 1,
    lastActivity: `2026-10-19T16:02:00${PT}`, lastActivityBy: 'Fern posted Level 1',
    originator: 'Ayesha Karimi', filedOn: '2026-10-02', flag: 'Filed Class II, Fern says Class I: it includes emergency egress lighting', hasAssessment: false,
  },
];

// What the list shows for ECRs without a full page: who reviews, how the checks went, how much talk.
const extras: Record<string, Pick<EcrSummary, 'reviewers' | 'checks' | 'comments'>> = {
  'ECR-0421': { reviewers: [{ name: 'Gideon Falk', state: 'pending' }, { name: 'Hamid Barzani', state: 'pending' }, { name: 'Beatriz Nowak', state: 'pending' }], checks: 'attention', comments: 1 },
  'ECR-0419': { reviewers: [{ name: 'Gideon Falk', state: 'pending' }, { name: 'Hamid Barzani', state: 'pending' }, { name: 'Beatriz Nowak', state: 'pending' }], checks: 'attention', comments: 2 },
  'ECR-0415': { reviewers: [{ name: 'Samir Vaidya', state: 'pending' }, { name: 'Hamid Barzani', state: 'pending' }], checks: 'attention', comments: 3 },
  'ECR-0412': { reviewers: [{ name: 'Samir Vaidya', state: 'approved' }, { name: 'Hamid Barzani', state: 'pending' }, { name: 'Beatriz Nowak', state: 'pending' }], checks: 'attention', comments: 4 },
  'ECR-0410': { reviewers: [{ name: 'Gideon Falk', state: 'pending' }, { name: 'Beatriz Nowak', state: 'pending' }], checks: 'attention', comments: 2 },
  'ECR-0407': { reviewers: [{ name: 'Gideon Falk', state: 'pending' }, { name: 'Beatriz Nowak', state: 'pending' }], checks: 'attention', comments: 2 },
  'ECR-0406': { reviewers: [{ name: 'Dana Okafor', state: 'pending' }, { name: 'Beatriz Nowak', state: 'pending' }], checks: 'attention', comments: 1 },
};

// The ten released ECOs of the last 18 months (bowman/data/history.ts): the closed list.
const released: [string, string, string, string, string][] = [
  ['ECR-0372', 'Battery loop coolant pump, Rev B impeller and seal', 'Tomasz Wierzbicki', '2026-06-02', '2026-06-25'],
  ['ECR-0368', 'Superseded fastener standards in the aircraft fastener kit', 'Ayesha Karimi', '2026-05-12', '2026-05-19'],
  ['ECR-0362', 'Keyed HV terminal connector on both motors', 'Jeff Hargrove', '2026-04-14', '2026-05-14'],
  ['ECR-0356', 'Tighter capacity-match screening on cells', 'Maren Solheim', '2026-02-23', '2026-03-26'],
  ['ECR-0351', 'Thicker carbon retention sleeve on forward rotor', 'Maren Solheim', '2026-02-09', '2026-03-12'],
  ['ECR-0319', 'Motor-controller bracket BW-5120-210 stiffened, Rev A to Rev B', 'Jeff Hargrove', '2025-10-27', '2025-11-20'],
  ['ECR-0312', 'Redundant position sensor in the tilt actuator', 'Maren Solheim', '2025-08-18', '2025-10-03'],
  ['ECR-0301', 'Laser-welded Cu-Al clad busbar replaces nickel strip in cell modules', 'Wei-Lin Zhao', '2025-06-30', '2025-08-08'],
  ['ECR-0296', 'Flight deck display Rev B for the new vehicle-management software load', 'Ayesha Karimi', '2025-06-09', '2025-07-17'],
  ['ECR-0288', 'Hybrid-ceramic bearings in forward and aft motors', 'Maren Solheim', '2025-04-28', '2025-06-16'],
];
const closed: EcrSummary[] = released.map(([id, title, who, filedOn, done], i) => ({
  id, title, program: 'Vesper', companyClass: 'I', faa: 'minor', priority: 'Routine', status: 'ECO released',
  level: 3, lastActivity: `${done}T12:00:00${PT}`, lastActivityBy: 'ECO released', originator: who, filedOn,
  reviewers: [{ name: 'Rafael Quintero', state: 'approved' }], checks: 'passed', comments: 3 + (i % 4), hasAssessment: false,
}));

export const mockAssessments: Record<string, ImpactAssessment> = {
  'ECR-0409': ecr0409,
  'ECR-0417': ecr0417,
  'ECR-0423': ecr0423,
};

export const mockEcrs: EcrSummary[] = [ecr0417Summary, ecr0409Summary, ecr0423Summary, ...others.map(e => ({ ...e, ...extras[e.id], cost: costOf(e.id as keyof typeof listCosts) })), ...closed]
  .map(e => ({ ...e, hasAssessment: e.id in mockAssessments }))
  .sort((a, b) => b.id.localeCompare(a.id));
