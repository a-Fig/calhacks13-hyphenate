// MOCK fixtures for the ECR list and pages. Bowman's ten open ECRs, with numbers drawn from the
// dataset (bowman/data/changes.ts) and its answer key (scenarios.ts). Year-1 means 2027 at the
// planned 24 aircraft unless the ECR's cut-in is later. ECR-0417, ECR-0409 and ECR-0423 carry a full impact
// assessment; the rest show what Norn's Level 1 would put on the backlog.
import type { EcrSummary, ImpactAssessment } from '../types.ts';
import { ecr0409, ecr0409Summary } from './ecr0409.ts';
import { ecr0417, ecr0417Summary } from './ecr0417.ts';
import { ecr0423, ecr0423Summary } from './ecr0423.ts';

const PT = '-07:00';

const others: EcrSummary[] = [
  {
    id: 'ECR-0421', title: 'Meridian cruise motor magnets BW-M512-340: qualify UH grade for the first-flight rotors',
    program: 'Meridian', partNumber: 'BW-M512-340', companyClass: 'I', faa: 'major', priority: 'Routine', status: 'Submitted',
    cost: { p10: 150000, p50: 172000, p90: 240000 }, level: 1,
    lastActivity: `2026-10-22T11:40:00${PT}`, lastActivityBy: 'Norn posted Level 1',
    originator: 'Nikhil Desai', filedOn: '2026-10-21', flag: 'Shares Orrin’s one qualification slot with ECR-0419', hasAssessment: false,
  },
  {
    id: 'ECR-0419', title: 'Forward rotor magnet set BW-3120-340: SH grade to UH grade',
    program: 'Vesper', partNumber: 'BW-3120-340', companyClass: 'I', faa: 'major', priority: 'Urgent', status: 'Submitted',
    cost: { p10: 310000, p50: 345000, p90: 470000 }, level: 1,
    lastActivity: `2026-10-21T15:05:00${PT}`, lastActivityBy: 'Norn posted Level 1',
    originator: 'Maren Solheim', filedOn: '2026-10-20', flag: 'Shares Orrin’s one qualification slot with ECR-0421', hasAssessment: false,
  },
  {
    id: 'ECR-0415', title: 'Coolant pump BW-8210-110 Rev C: low-cost polymer housing',
    program: 'Vesper', partNumber: 'BW-8210-110', companyClass: 'I', faa: 'minor', priority: 'Routine', status: 'Submitted',
    cost: { p10: 30000, p50: 55000, p90: 85000 }, level: 1,
    lastActivity: `2026-10-20T10:12:00${PT}`, lastActivityBy: 'Norn posted Level 1',
    originator: 'Wei-Lin Zhao', filedOn: '2026-10-13', flag: 'Conflicts with ECR-0412 on the same pump', hasAssessment: false,
  },
  {
    id: 'ECR-0412', title: 'Battery loop coolant pump BW-8210-110 Rev C: higher flow',
    program: 'Vesper', partNumber: 'BW-8210-110', companyClass: 'I', faa: 'minor', priority: 'Urgent', status: 'In review',
    cost: { p10: 45000, p50: 55000, p90: 95000 }, level: 2,
    lastActivity: `2026-10-22T09:30:00${PT}`, lastActivityBy: 'Norn posted Level 2',
    originator: 'Tomasz Wierzbicki', filedOn: '2026-10-09', flag: 'Conflicts with ECR-0415 on the same pump', hasAssessment: false,
  },
  {
    id: 'ECR-0410', title: 'Drop the second DC-DC converter',
    program: 'Vesper', partNumber: undefined, companyClass: 'I', faa: 'major', priority: 'Routine', status: 'Submitted',
    cost: { p10: -150000, p50: -123600, p90: -95000 }, level: 1,
    lastActivity: `2026-10-20T14:48:00${PT}`, lastActivityBy: 'Norn posted Level 1',
    originator: 'Wei-Lin Zhao', filedOn: '2026-10-07', flag: 'Removes redundancy: filed FAA minor, Norn says major', hasAssessment: false,
  },
  {
    id: 'ECR-0407', title: 'Carbon prepreg: move to Cardinal’s new resin system',
    program: 'Vesper', partNumber: undefined, companyClass: 'I', faa: 'major', priority: 'Routine', status: 'Submitted',
    cost: { p10: -62000, p50: -50300, p90: -38000 }, level: 1,
    lastActivity: `2026-10-20T09:20:00${PT}`, lastActivityBy: 'Norn posted Level 1',
    originator: 'Wei-Lin Zhao', filedOn: '2026-10-03', flag: 'Qualification is not on the ECR: filed FAA minor, Norn says likely major', hasAssessment: false,
  },
  {
    id: 'ECR-0406', title: 'Cabin lighting set: LED strip v2',
    program: 'Vesper', partNumber: undefined, companyClass: 'I', faa: 'minor', priority: 'Routine', status: 'Submitted',
    cost: { p10: -6000, p50: -5040, p90: -4000 }, level: 1,
    lastActivity: `2026-10-19T16:02:00${PT}`, lastActivityBy: 'Norn posted Level 1',
    originator: 'Ayesha Karimi', filedOn: '2026-10-02', flag: 'Filed Class II, Norn says Class I: it includes emergency egress lighting', hasAssessment: false,
  },
];

export const mockAssessments: Record<string, ImpactAssessment> = {
  'ECR-0409': ecr0409,
  'ECR-0417': ecr0417,
  'ECR-0423': ecr0423,
};

export const mockEcrs: EcrSummary[] = [ecr0417Summary, ecr0409Summary, ecr0423Summary, ...others]
  .map(e => ({ ...e, hasAssessment: e.id in mockAssessments }))
  .sort((a, b) => b.id.localeCompare(a.id));
