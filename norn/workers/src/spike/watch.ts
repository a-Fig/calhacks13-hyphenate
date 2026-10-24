// Holds a connection open and logs what it sees, to check that republishing the module does not
// drop connected clients. Usage: npx tsx src/spike/watch.ts <seconds>
import { connect, subscribe } from '../connect.ts';

const seconds = Number(process.argv[2] ?? 40);
const c = await connect({ kind: 'agent', name: 'spike-watch', origin: 'norn', spawnedBy: 'Norn' }, { persistToken: false });
await subscribe(c.conn, ['SELECT * FROM comment', 'SELECT * FROM check_result']);
const t = (m: string) => console.log(`${new Date().toISOString().slice(11, 23)} ${m}`);
t(`watching; comments in cache: ${[...c.conn.db.comment.iter()].length}`);
c.conn.db.comment.onInsert((_c, r) => t(`comment inserted: ${r.body}`));
setTimeout(() => {
  t('done');
  c.close();
  process.exit(0);
}, seconds * 1000);
