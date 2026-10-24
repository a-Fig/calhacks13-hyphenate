import { connect, classify, subscribe } from '../connect.ts';

const c = await connect({ kind: 'agent', name: 'probe', origin: 'norn', spawnedBy: 'Norn' }, { persistToken: false });
console.log('identity', c.identity.toHexString().slice(0, 12));
for (const mode of ['sender', 'internal', 'type', 'ok']) {
  try {
    await c.conn.reducers.spikeFail({ mode });
    console.log(mode, '-> resolved');
  } catch (e) {
    console.log(mode, '->', classify(e), (e as Error).constructor.name);
  }
}
try {
  await c.conn.reducers.claimCheck({ checkRunId: 9999n, leaseMs: 5000 });
} catch (e) {
  console.log('claim ->', classify(e));
}
const sub = await subscribe(c.conn, ['SELECT * FROM check_run', 'SELECT * FROM action_log']);
console.log('check_run rows', [...c.conn.db.checkRun.iter()].length, 'action_log', [...c.conn.db.actionLog.iter()].map(r => `${r.reducer}:${r.summary}`));
sub.unsubscribe();
c.close();
process.exit(0);
