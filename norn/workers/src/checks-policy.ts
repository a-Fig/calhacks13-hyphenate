// Checks for the policy gate (allow, deny, downgrade) against the test module, which registers
// a few rules (module-test/src/rules.ts); the real module has none until #43.
//   npm run test-db:publish && npm run check:policy      (from norn/)
import * as TestBindings from '@norn/module-test/bindings';
import { connect, subscribe, type Client } from './connect.ts';
import { TABLES, kit, recorder } from './testkit.ts';

type TestConn = InstanceType<typeof TestBindings.DbConnection>;
const { check, finish } = recorder();
const open = (name: string, kind: 'agent' | 'person', origin: 'norn' | 'external' | 'human', onBehalfOf?: string) =>
  connect<TestConn>({ kind, name, origin, onBehalfOf, spawnedBy: 'Norn' }, { persistToken: false, quiet: true, bindings: TestBindings, database: 'norn-test' });

const A = await open('policy-a', 'agent', 'norn');
const X = await open('policy-external', 'agent', 'external', 'Tyler');
const D = await open('test-downgrader', 'agent', 'norn');
await subscribe(A.conn, TABLES);
const K = kit(A as unknown as Client);
const { R, until, holds, pr, logs, newPr, allCodeDone, db } = K;
const stamp = Date.now().toString(36);

const E = await newPr(`policy ${stamp}`);

// deny
await A.R.addComment({ prId: E.id, anchor: '', body: 'policy:deny this one', meta: { requestId: `deny-${stamp}` } });
const denied = await until(() => logs(l => l.requestId === `deny-${stamp}`)[0], 3000, 'the denial in the log');
check('a denied call returns normally and its log row is kept, matched by request id', denied.outcome === 'denied' && denied.policy.startsWith('deny:') && denied.entity === 'denied' && denied.summary.includes('add_comment refused') && denied.prId === E.id, `${denied.outcome}: ${denied.policy}`);
check('...and the write did not happen', ![...db.comment.iter()].some(c => c.prId === E.id && c.body.startsWith('policy:deny')));
await A.R.addComment({ prId: E.id, anchor: '', body: 'an ordinary comment', meta: { requestId: `ok-${stamp}` } });
const okRow = await until(() => logs(l => l.requestId === `ok-${stamp}`)[0], 3000, 'the allowed call in the log');
check('an allowed call is logged as applied with the allow reason', okRow.outcome === 'applied' && okRow.policy === 'allow (no rules yet)' && [...db.comment.iter()].some(c => c.prId === E.id && c.body === 'an ordinary comment'), okRow.policy);

// downgrade: approve -> recommend
await allCodeDone(E.id);
await R.setPrStatus({ prId: E.id, status: 'review' });
await X.R.setPrStatus({ prId: E.id, status: 'approved', meta: { requestId: `down-${stamp}` } });
const down = await until(() => logs(l => l.requestId === `down-${stamp}`)[0], 3000, 'the downgrade in the log');
check('an outside agent\'s approval is downgraded to a recommendation: logged as downgraded, the ECR stays in review', down.outcome === 'downgraded' && down.summary.startsWith('recommends approval') && down.policy.startsWith('downgrade to recommendation') && pr(E.id).status === 'review', `${down.outcome}: ${down.summary}`);
await A.R.setPrStatus({ prId: E.id, status: 'approved', meta: { requestId: `approve-${stamp}` } });
check('the same approval by Norn\'s own agent goes through', await holds(() => pr(E.id).status === 'approved') && (await until(() => logs(l => l.requestId === `approve-${stamp}`)[0])).outcome === 'applied');

// downgrade with no weaker form
const E2 = await newPr(`policy close ${stamp}`);
await D.R.setPrStatus({ prId: E2.id, status: 'closed', meta: { requestId: `close-${stamp}` } });
const close = await until(() => logs(l => l.requestId === `close-${stamp}`)[0], 3000, 'the refusal in the log');
check('a downgrade for an action that has no weaker form is a refusal', close.outcome === 'denied' && close.summary.includes('no weaker action') && pr(E2.id).status === 'draft', close.summary);

for (const id of [E.id, E2.id]) await R.setPrStatus({ prId: id, status: 'closed' }).catch(() => {});
for (const c of [A, X, D]) c.close();
process.exit(finish() ? 0 : 1);
