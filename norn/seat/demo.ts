// The cost engineer seat chasing ECR-0417's missing inputs, offline, from Bowman's dataset.
// The colleagues' replies are SIMULATED (scripted here); on the live stack a person types them on the
// ECR. Everything else is the real seat logic and the real checks.
//
//   node norn/seat/demo.ts [ECR-0417]
import { bowman } from '../../bowman/data/index.ts';
import { costEngineerSeat as seat } from '../../bowman/norn-config/seats/cost-engineer.ts';
import { costCheck } from '../checks/src/index.ts';
import type { AssumptionOverride } from '../checks/src/types.ts';
import { findGaps } from './src/gaps.ts';
import { nextActions, type SeatState } from './src/plan.ts';
import type { Person, Reply } from './src/types.ts';

const id = process.argv[2] ?? 'ECR-0417';
const ecr = bowman.ecrs.find((e) => e.id === id);
if (!ecr) throw new Error(`no ${id} in the dataset`);
const people: Person[] = bowman.people.map((p) => ({ id: p.id, name: p.name, title: p.title, seat: p.seat, programs: (p as { programs?: string[] }).programs }));
const originator = people.find((p) => p.id === ecr.originator)!;
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

const before = costCheck(bowman, ecr, { seed: 'norn-seed-1' });
const state: SeatState = { ecr: id, program: ecr.program, originator, gaps: findGaps(seat, before), questions: [], replies: [], recorded: [], reminded: [], escalated: {}, followedUp: [] };
console.log(`Norn, ${seat.title} seat${seat.replaces ? ` (the job held by ${people.find((p) => p.id === seat.replaces)?.name})` : ''}: ${id}`);
console.log(`One-time total before: ${usd(before.headline.oneTimeTotal.p50)} [${usd(before.headline.oneTimeTotal.p10)} to ${usd(before.headline.oneTimeTotal.p90)}]`);
console.log(`\nGaps worth asking about: ${state.gaps.length}`);
for (const g of state.gaps) console.log(`  - ${g.label} (${g.kind === 'blank_row' ? 'blank on the cost page' : `default, swing ${usd(g.swing ?? 0)}`})`);

const overrides: AssumptionOverride[] = [];
const step = (now: string, label: string) => {
  console.log(`\n[${now}] ${label}`);
  for (const a of nextActions(seat, people, state, now)) {
    if (a.kind === 'ask') { state.questions.push(a.question); console.log(`  ASK ${a.question.to.name} (${a.question.to.title}): ${a.question.body}`); }
    if (a.kind === 'remind') { state.reminded.push(a.question.gap.inputId); console.log(`  REMIND ${a.question.to.name}: ${a.body}`); }
    if (a.kind === 'escalate') { state.escalated[a.question.gap.inputId] = a.level; console.log(`  ESCALATE to ${a.to.name} (${a.to.title}): ${a.body}`); }
    if (a.kind === 'follow_up') { state.followedUp.push(a.reply.inputId); console.log(`  FOLLOW UP ${a.reply.from.name}: ${a.body}`); }
    if (a.kind === 'record') { state.recorded.push(a.override.id); overrides.push(a.override); console.log(`  RECORD ${a.override.id} from ${a.override.by}: ${a.override.rationale}`); }
    if (a.kind === 'rerun') console.log(`  RE-RUN the checks: ${a.reason}`);
  }
};

const t0 = '2026-10-24T09:00:00Z';
step(t0, 'Norn picks up the ECR');
// SIMULATED replies: the first asked person answers with a range, a second gives no figure (a follow-up), the rest stay silent.
const say = (inputId: string, text: string, at: string) => {
  const q = state.questions.find((x) => x.gap.inputId === inputId)!;
  const r: Reply = { inputId, from: q.to, text, at };
  state.replies.push(r);
  console.log(`  SIMULATED reply from ${q.to.name}: "${text}"`);
};
const [q1, q2] = state.questions;
if (q1) say(q1.gap.inputId, 'Roughly $3,000 to $5,000 for the re-inspection across all ten retrofits.', '2026-10-24T13:30:00Z');
if (q2) say(q2.gap.inputId, "I'd have to check with the team.", '2026-10-24T15:00:00Z');
step('2026-10-24T15:05:00Z', 'Replies arrive');
step('2026-10-25T10:00:00Z', '25 hours after asking');
step('2026-10-26T10:00:00Z', '49 hours after asking');

const after = costCheck(bowman, ecr, { seed: 'norn-seed-1', assumptions: overrides });
console.log(`\nOne-time total after recorded answers: ${usd(after.headline.oneTimeTotal.p50)} [${usd(after.headline.oneTimeTotal.p10)} to ${usd(after.headline.oneTimeTotal.p90)}]`);
console.log(`Assessment still missing: ${state.gaps.length - state.recorded.length} input(s), each asked, reminded or escalated.`);
