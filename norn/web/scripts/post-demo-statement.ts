// Posts a Level 1 impact statement for one ECR through the module, as Norn's agent would, so the web
// screens render a bot comment from real rows. The numbers marked computation are copied from the ECR's
// current s2_cost results (the module refuses any that differ). Scratch databases only.
//   NORN_DB=norn-ui node --import tsx ../web/scripts/post-demo-statement.ts ECR-0417   (from norn/workers/)
import { DB, connect, subscribe } from '../../workers/src/connect.ts';

if (['norn', 'norn-test', 'norn-mcp', 'norn-l1', 'norn-live'].includes(DB) || DB.startsWith('norn-pipe')) throw new Error(`refusing to post a demo statement to ${DB}`);
const number = process.argv[2] ?? 'ECR-0417';
const A = await connect({ kind: 'agent', name: 'Norn impact agent', origin: 'norn', spawnedBy: 'Norn' }, { persistToken: false, quiet: true });
await subscribe(A.conn, ['SELECT * FROM pull_request', 'SELECT * FROM check_run', 'SELECT * FROM check_result']);
const db = A.conn.db as any;
const pr = [...db.pullRequest.iter()].find((p: any) => p.plmEcrNumber === number);
if (!pr) throw new Error(`${number} is not in ${DB}`);
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
const requestId = `demo-statement-${Date.now()}`;
await (A.R as any).postImpactStatement({
  prId: pr.id, level: 1,
  changeClass: 'Class II, FAA major',
  route: 'Cost engineering, procurement, quality and certification review, then the CCB',
  headline: 'A first read of the numbers the cost check produced: about $157,000 net in year one, almost all of it one-time engineering, retrofit and old-stock cost. Nothing here is a recommendation yet.',
  numbers: [comp('net_total_year_one'), comp('one_time_total'), comp('recurring_year_one'), comp('net_total_plan')],
  drivers: [
    { text: 'Scrapping and cancelling the old bracket stock is the largest single line, about $60,000.', evidence: 'computation' },
    { text: 'Engineering and data revision plus the vibration re-test on the endurance rig come to roughly $34,000 and carry the widest range.', evidence: 'computation' },
  ],
  assumptions: [],
  claims: [
    { text: 'The ECR changes one item and touches both the Vesper and Meridian programs.', evidence: 'fact' },
    { text: 'Retrofit of S/N 001-010 is in the cost; the delay cost of holding S/N 011-014 is not priced yet and is shown as zero.', evidence: 'judgment' },
  ],
});
console.log(`posted a Level 1 statement for ${number} (${requestId})`);
A.close();
process.exit(0);
