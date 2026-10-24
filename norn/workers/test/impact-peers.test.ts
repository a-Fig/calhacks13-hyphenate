// Offline test of the s4 handler's peers: it reads exactly the change-request revisions its run
// names (core.ts peerSnapshot), not whatever happens to be in the live cache. No database: the
// connection is a fake with the two tables the handler reads. The module side (filing an ECR re-runs
// the others' s4, without bumping a revision or withdrawing an approval) is src/checks.ts.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bowman } from '../../../bowman/data/index.ts';
import type { ChangeRequest } from '../../checks/src/index.ts';
import { impactHandlers, type Inputs } from '../src/impact.ts';
import { AbortedError, type RunCtx } from '../src/stages.ts';

const ecr = (id: string): ChangeRequest => structuredClone(bowman.ecrs.find(x => x.id === id)!) as ChangeRequest;

type Rev = { prId: bigint; seq: number; digest: string; changeRequestJson: string };
const revision = (prId: bigint, e: ChangeRequest, digest: string): Rev => ({ prId, seq: 1, digest, changeRequestJson: JSON.stringify(e) });

type Row = { id: bigint; key: string; distJson: string; source: string; rationale: string };
/** A connection holding only what the handler reads: ecr_revision by pr id, and assumptions by id. */
function fakeConn(cache: Rev[], assumptions: Row[] = []) {
  return {
    db: {
      ecrRevision: { prId: { filter: (id: bigint) => cache.filter(r => r.prId === id) } },
      assumption: { id: { find: (id: bigint) => assumptions.find(a => a.id === id) } },
    },
  } as never;
}
const baselines = { get: async () => bowman, refresh: async () => undefined } as never;

const SELF = 1n;
const run = (inputs: Inputs): RunCtx => ({
  runId: 1n,
  prId: SELF,
  stage: 's4_supply',
  inputHash: 'h',
  inputsJson: JSON.stringify({ seed: 'norn-seed-1', overlay: 'd419', revision: 1, erpBaseline: 'b'.repeat(64), erpBaselineSource: 'erp', erpBaselineAsOf: '2026-10-24', revisionSource: 'plm', ...inputs }),
  signal: new AbortController().signal,
  progress: async () => undefined,
  log: () => undefined,
});
const detail = (rows: { key: string; detailJson: string }[]) => JSON.parse(rows.find(r => r.key === 'detail')!.detailJson);
const rowsText = (rows: unknown) => JSON.stringify(rows);

describe('s4 reads the peers its run names', () => {
  const self = revision(SELF, ecr('ECR-0419'), 'd419');
  const peer = revision(2n, ecr('ECR-0421'), 'd421');
  const named = { pr: '2', revision: 1, overlay: 'd421' };

  it('gives the same rows for the same inputs when another ECR is later added to the cache', async () => {
    const cache = [self];
    const handlers = impactHandlers(fakeConn(cache), baselines);
    const inputs = { peers: [] };
    const before = await handlers.s4_supply(run(inputs));
    assert.equal(detail(before).interaction, null, 'no peer is named, so there is no interaction');
    cache.push(peer); // ECR-0421 is filed after the run was made
    const after = await handlers.s4_supply(run(inputs));
    assert.equal(rowsText(after), rowsText(before), 'the run names no peers: it computes the same thing');
  });

  it('compares with the peer the run names', async () => {
    const handlers = impactHandlers(fakeConn([self, peer]), baselines);
    const alone = await handlers.s4_supply(run({ peers: [] }));
    const withPeer = await handlers.s4_supply(run({ peers: [named] }));
    const d = detail(withPeer);
    assert.deepEqual(d.interaction.peers.map((p: { ecr: string }) => p.ecr), ['ECR-0421']);
    assert.ok(withPeer.some(r => r.key === 'peer_cut_in_shift_weeks'));
    assert.ok(!alone.some(r => r.key === 'peer_cut_in_shift_weeks'));
    // The peer's revision, not just its id, is what the rows depend on.
    const edited = revision(2n, { ...ecr('ECR-0421'), filedOn: '2026-10-01' } as ChangeRequest, 'd421-b');
    const other = await impactHandlers(fakeConn([self, edited]), baselines).s4_supply(run({ peers: [{ pr: '2', revision: 1, overlay: 'd421-b' }] }));
    assert.notEqual(rowsText(other), rowsText(withPeer));
  });

  it('drops a run whose named peer revision is gone or has changed', async () => {
    const handlers = impactHandlers(fakeConn([self, { ...peer, digest: 'edited' }]), baselines);
    await assert.rejects(handlers.s4_supply(run({ peers: [named] })), AbortedError);
    await assert.rejects(impactHandlers(fakeConn([self]), baselines).s4_supply(run({ peers: [named] })), AbortedError);
  });
});

describe('s4 applies the assumptions of its peers', () => {
  const self = revision(SELF, ecr('ECR-0419'), 'd419');
  const peer = revision(2n, ecr('ECR-0421'), 'd421');
  const late: Row = { id: 7n, key: 'decision:ECR-0421', distJson: JSON.stringify({ kind: 'point', value: 70, replacesGiven: true }), source: 'agent_estimated', rationale: 'the board will not see it until the spring' };
  const named = (assumptions: { id: string; key: string; rev: number }[]) => ({ pr: '2', revision: 1, overlay: 'd421', assumptions });

  it('reads a decision lag recorded on the peer, so the comparison changes with it', async () => {
    const without = await impactHandlers(fakeConn([self, peer], [late]), baselines).s4_supply(run({ peers: [named([])] }));
    const withIt = await impactHandlers(fakeConn([self, peer], [late]), baselines).s4_supply(run({ peers: [named([{ id: '7', key: late.key, rev: 1 }])] }));
    assert.notEqual(rowsText(withIt), rowsText(without), 'an assumption on the peer reaches the s4 of this ECR');
    assert.ok(!withIt.some(r => r.key === 'assumption_errors'));
  });

  it('drops a run whose named peer assumption is gone', async () => {
    await assert.rejects(impactHandlers(fakeConn([self, peer], []), baselines).s4_supply(run({ peers: [named([{ id: '7', key: late.key, rev: 1 }])] })), AbortedError);
  });

  it('reads an assumption shared with a peer once, and the own assumption wins a shared key', async () => {
    const own: Row = { ...late, id: 8n, distJson: JSON.stringify({ kind: 'point', value: 4, replacesGiven: true }) };
    const handlers = impactHandlers(fakeConn([self, peer], [late, own]), baselines);
    const both = await handlers.s4_supply(run({ assumptions: [{ id: '8', key: own.key, rev: 1 }], peers: [named([{ id: '7', key: late.key, rev: 1 }, { id: '8', key: own.key, rev: 1 }])] }));
    const ownOnly = await handlers.s4_supply(run({ assumptions: [{ id: '8', key: own.key, rev: 1 }], peers: [named([])] }));
    assert.equal(rowsText(both), rowsText(ownOnly));
  });
});

describe('s4 skips a peer it cannot read', () => {
  it('runs for the ECR itself and says which peer it left out', async () => {
    const self = revision(SELF, ecr('ECR-0419'), 'd419');
    const draft = revision(3n, { id: 'ECR-DRAFT' } as ChangeRequest, 'dd');
    const rows = await impactHandlers(fakeConn([self, draft]), baselines).s4_supply(run({ peers: [{ pr: '3', revision: 1, overlay: 'dd' }] }));
    assert.ok(detail(rows).flags.some((f: { kind: string; ref: string }) => f.kind === 'unreadable_peer' && f.ref === 'ECR-DRAFT'));
  });
});
