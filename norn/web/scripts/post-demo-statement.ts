// Posts a DEMO Level 1 impact statement for ECR-0417 through the module, so the web screens render a bot
// comment from real rows. A script writes it, not Norn's agent (the real Level 1 agent is a separate piece
// of work), and the statement says so in its headline. Class, headline, drivers and claims are derived from
// the ECR as filed and its newest finished s2_cost run; the numbers marked computation are copied from that
// run (the module refuses any that differ). Scratch databases only.
//   NORN_DB=norn-ui node --import tsx ../web/scripts/post-demo-statement.ts ECR-0417   (from norn/workers/)
import { DB, connect, subscribe } from '../../workers/src/connect.ts';

if (['norn', 'norn-test', 'norn-mcp', 'norn-l1', 'norn-live'].includes(DB) || DB.startsWith('norn-pipe')) throw new Error(`refusing to post a demo statement to ${DB}`);
const number = process.argv[2] ?? 'ECR-0417';
if (number !== 'ECR-0417') throw new Error(`this demo script only knows ECR-0417, not ${number}`);

const A = await connect({ kind: 'agent', name: 'Demo statement script', origin: 'norn', spawnedBy: 'Norn' }, { persistToken: false, quiet: true });
await subscribe(A.conn, ['SELECT * FROM pull_request', 'SELECT * FROM ecr_revision', 'SELECT * FROM check_run', 'SELECT * FROM check_result']);
const db = A.conn.db as any;
const pr = [...db.pullRequest.iter()].find((p: any) => p.plmEcrNumber === number);
if (!pr) throw new Error(`${number} is not in ${DB}`);
const revs = [...db.ecrRevision.iter()].filter((r: any) => r.prId === pr.id);
const rev = revs.find((r: any) => r.current) ?? revs.sort((a: any, b: any) => Number(b.id - a.id))[0];
if (!rev) throw new Error(`${number} has no change request revision`);
const cr = JSON.parse(rev.changeRequestJson);
const runs = [...db.checkRun.iter()].filter((r: any) => r.prId === pr.id && r.stage === 's2_cost' && r.status === 'done');
const run = runs.sort((a: any, b: any) => Number(b.id - a.id))[0];
if (!run) throw new Error(`${number} has no finished cost check yet`);
const res = (key: string) => {
  const r = [...db.checkResult.iter()].find((x: any) => x.checkRunId === run.id && x.key === key);
  if (!r) throw new Error(`no result ${key}`);
  return r;
};
const comp = (key: string) => {
  const r = res(key);
  return { key, label: r.label, unit: r.unit, p10: r.p10, p50: r.p50, p90: r.p90, evidence: 'computation', resultKey: key };
};
const usd = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
const money = (n: number) => (n < 0 ? `a saving of ${usd(n)}` : usd(n));

const net = res('net_total_year_one'), oneTime = res('one_time_total'), recurring = res('recurring_year_one');
const detail = JSON.parse(res('detail').detailJson);
const drivers = [...(detail.drivers ?? [])].sort((a: any, b: any) => b.swing - a.swing).slice(0, 2);
const needEstimate = (detail.flags ?? []).filter((f: any) => f.kind === 'needs_estimate').length;
const items: string[] = (cr.itemChanges ?? []).map((c: any) => c.item);

// The class is the ECR's own, as filed; the script does not classify anything.
const companyClass = cr.companyClass ?? 'I';
const faa = cr.faaClass ?? 'minor';
const routedTo: string[] = cr.routedTo ?? [];

const numbers = [comp('net_total_year_one'), comp('one_time_total'), comp('recurring_year_one')];
if ([...db.checkResult.iter()].some((x: any) => x.checkRunId === run.id && x.key === 'net_total_plan')) numbers.push(comp('net_total_plan'));

await (A.R as any).postImpactStatement({
  prId: pr.id, level: 1,
  changeClass: `Class ${companyClass}, FAA ${faa} (as filed)`,
  route: routedTo.length ? `As filed: ${routedTo.join(', ')}` : 'As filed',
  headline: `Demo statement, written by a script (post-demo-statement.ts), not by Fern's agent. The cost check puts the net cost of the first 12 months at ${money(net.p50)} (P10 ${money(net.p10)}, P90 ${money(net.p90)}), with ${usd(oneTime.p50)} one-time and ${money(recurring.p50)} recurring at the median. Nothing here is a recommendation.`,
  numbers,
  drivers: drivers.map((d: any) => ({ text: `${d.label} moves the net cost by about ${usd(d.swing)} between its low and high case.`, evidence: 'computation' })),
  assumptions: [],
  claims: [
    ...(items.length ? [{ text: `The ECR changes ${items.length === 1 ? 'one item' : `${items.length} items`}: ${items.join(', ')}.`, evidence: 'fact' }] : []),
    ...(needEstimate ? [{ text: `${needEstimate} cost line${needEstimate > 1 ? 's have' : ' has'} no estimate and count as $0 in these numbers.`, evidence: 'fact' }] : []),
  ],
});
console.log(`posted a demo Level 1 statement for ${number} (cost run ${run.id})`);
A.close();
process.exit(0);
