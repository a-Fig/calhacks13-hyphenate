// The publisher (#42): when a Level 1 or later impact statement exists for an ECR the PLM knows, write
// it onto that ECR in the PLM, so an engineer or a CCB member sees it without opening Norn.
//
//   NORN_DB=norn-l1 npm run level1:publisher -w @norn/workers      (from norn/)
//
// It only reads Norn's database. The PLM is written with Norn's integration credentials (PLM_URL,
// PLM_API_KEY, PLM_API_SECRET from the environment, ENV_FILE or the main checkout's .env), and only
// the seven impact fields (and, if NORN_PUBLISH_COMMENT=1, one comment).
//   NORN_PUBLISH_ECRS=ECR-0417,ECR-0423   write only these ECRs (default: every ECR that has a PLM number)
//   NORN_WEB_URL                          where Norn's pages are, for the link in the PLM (default http://127.0.0.1:5173)
//
// Idempotent: the text it writes ends with a ref that names the statement and a digest of what was
// written, and before every write it reads the ECR's fields from the PLM. If the ref is already
// there, and the plain fields match, nothing is written. A restart, a second publisher, or a
// scratch database reset therefore writes nothing twice.
//
// Read-then-write is not atomic, and the PLM cannot refuse a second identical write, so two
// publishers that look at the same moment would both write. The write is therefore taken in turns
// through a lease row in Norn's database (claim_publication, keyed by ECR): claim, read the PLM
// again, write, release. A publisher that loses the claim writes nothing and looks again on its next
// sweep, by which time the PLM shows the ref.
import { pathToFileURL } from 'node:url';
import type { DbConnection } from '@norn/bindings';
import { connect, subscribe } from '../connect.ts';
import { randomUUID } from 'node:crypto';
import { provenanceOf } from '../impact.ts';
import { alreadyPublished, statementToPlmFields, type Formatted, type Provenance, type StatementDoc } from './format.ts';
import { plmFromConnector, plmOptionsFromEnv, type PlmApi } from './plm.ts';
import type { EcrRef } from './routing.ts';
import { statementIsFor } from './plan.ts';
import { settingsFromEnv } from './settings.ts';
import { crSeqOfRun, jsonOr, runInputs } from './source.ts';

/** How long a claim stands if its holder dies before releasing it. Longer than one PLM write. */
const LEASE_MS = 60_000;

export type PublishResult = 'written' | 'unchanged' | 'missing' | 'mock' | 'busy';

/** Turns at writing one ECR's statement to the PLM (see the header). */
export interface Lease {
  /** False when another publisher holds the lease. */
  claim(statementId: number): Promise<boolean>;
  release(): Promise<void>;
}

export interface PublishDeps {
  plm: PlmApi;
  /** ECR number -> the ref last seen in the PLM, so a steady state costs no requests. */
  published: Map<string, string>;
  /** Without one, nothing stops two publishers writing at once. The process always passes one. */
  lease?: Lease;
  /** Post a short comment on the ECR after a write. */
  comment?: boolean;
  log: (m: string) => void;
}

/** Write one formatted statement onto the ECR in the PLM, unless the PLM already shows it. */
export async function publishStatement(d: PublishDeps, ecrNumber: string, f: Formatted, prov: Pick<Provenance, 'mock'>): Promise<PublishResult> {
  if (prov.mock) {
    d.log(`${ecrNumber}: not written to the PLM, the statement rests on mock numbers`);
    return 'mock';
  }
  if (d.published.get(ecrNumber) === f.ref) return 'unchanged';
  const current = await d.plm.readImpact(ecrNumber);
  if (current === null) return 'missing';
  if (alreadyPublished(current, f)) {
    d.published.set(ecrNumber, f.ref);
    return 'unchanged';
  }
  if (d.lease && !(await d.lease.claim(Number(f.ref.split('.')[0])))) return 'busy';
  try {
    if (d.lease) {
      // Whoever held the lease before us may have written while we waited: look again, now that it is ours.
      const again = await d.plm.readImpact(ecrNumber);
      if (again === null) return 'missing';
      if (alreadyPublished(again, f)) {
        d.published.set(ecrNumber, f.ref);
        return 'unchanged';
      }
    }
    const after = await d.plm.writeImpact(ecrNumber, f.fields);
    // Proof, not the status code: the PLM's answer holds our ref.
    if (!alreadyPublished(after, f)) d.log(`${ecrNumber}: the PLM stored the statement but its answer differs from what was sent (it may have rewritten the text)`);
    d.published.set(ecrNumber, f.ref);
    if (d.comment) {
      const rec = f.recommendation ? ` Recommendation: ${f.recommendation}.` : '';
      await d.plm.postComment(ecrNumber, `<p>Norn posted a Level ${f.fields.impact_report_level} impact statement on this ECR.${rec} See the Impact assessment tab.</p>`);
    }
    return 'written';
  } finally {
    await d.lease?.release().catch(() => {});
  }
}

// ---- reading Norn's database ---------------------------------------------------------------

type Row<T extends keyof DbConnection['db']> = DbConnection['db'][T] extends { iter(): IterableIterator<infer R> } ? R : never;

/** What ranking a statement needs. `crSeq` is the change-request revision of the run it was written from, or null. */
export interface Candidate {
  id: bigint;
  level: number;
  createdMs: number;
  crSeq: number | null;
}

/**
 * The statement to publish for an ECR: of those for the current change-request revision, the highest
 * level, newest of that level. An earlier revision's statement never beats the current one, whatever
 * its level; with none for the current revision there is nothing to publish (the PLM keeps showing
 * the earlier one, whose text names its revision). `current` is null for an ECR with no change request.
 */
export function pickStatement<T extends Candidate>(all: T[], current: { seq: number; createdMs: number } | null): T | undefined {
  let best: T | undefined;
  for (const s of all) {
    if (current && !statementIsFor(s, current.seq, current.createdMs)) continue;
    if (!best || s.level > best.level || (s.level === best.level && s.id > best.id)) best = s;
  }
  return best;
}

export function gather(db: DbConnection['db'], pr: Row<'pullRequest'>): { statement: StatementDoc; ecr: EcrRef; prov: Provenance } | null {
  const cur = [...db.ecrRevision.prId.filter(pr.id)].find(r => r.current);
  const candidates = [...db.impactStatement.prId.filter(pr.id)].map(s => ({ row: s, id: s.id, level: s.level, createdMs: s.createdAt.toDate().getTime(), crSeq: crSeqOfRun(db, s.checkRunId) }));
  const picked = pickStatement(candidates, cur ? { seq: cur.seq, createdMs: cur.createdAt.toDate().getTime() } : null);
  if (!picked) return null;
  const s = picked.row;
  const doc: StatementDoc = {
    id: Number(s.id),
    level: s.level,
    prRevision: s.prRevision,
    createdAtIso: s.createdAt.toDate().toISOString(),
    changeClass: s.changeClass,
    route: s.route,
    headline: s.headline,
    numbers: s.numbers.map(n => ({ key: n.key, label: n.label, unit: n.unit, p10: n.p10, p50: n.p50, p90: n.p90, evidence: n.evidence, resultKey: n.resultKey })),
    drivers: s.drivers.map(c => ({ text: c.text, evidence: c.evidence })),
    assumptions: s.assumptions.map(a => ({ key: a.key, source: a.source, note: a.note })),
    claims: s.claims.map(c => ({ text: c.text, evidence: c.evidence })),
  };
  // Where it came from: the check run the module recorded for the statement. Its inputs name the
  // change-request revision and the ERP baseline. Nothing here is guessed from matching numbers.
  const run = s.checkRunId === 0n ? undefined : db.checkRun.id.find(s.checkRunId);
  const inputs = runInputs(db, s.checkRunId) ?? {};
  const results = [...db.checkResult.prId.filter(pr.id)];
  // The results behind the computation numbers (for the formulas and the mock flag): the same key
  // and digits, in the statement's own run first, else the newest such result.
  const matched = doc.numbers
    .filter(n => n.evidence === 'computation' && n.resultKey)
    .map(n => {
      const same = results.filter(r => r.key === n.resultKey && r.p10 === n.p10 && r.p50 === n.p50 && r.p90 === n.p90);
      return same.find(r => run && r.checkRunId === run.id) ?? same.sort((x, y) => Number(y.id - x.id))[0];
    })
    .filter((r): r is NonNullable<typeof r> => !!r);
  const formulas: Record<string, string> = {};
  for (const r of matched) {
    const f = jsonOr<{ trace?: { formula?: string } }>(r.detailJson, {}).trace?.formula;
    if (f) formulas[r.key] = f;
  }
  const detailRow = run ? results.find(r => r.checkRunId === run.id && r.key === 'detail') : undefined;
  const detail = detailRow ? jsonOr<{ codeVersion?: string; draws?: number }>(detailRow.detailJson, {}) : {};
  const p = provenanceOf(inputs);
  const crSeq = inputs.revision ?? cur?.seq ?? 0;
  return {
    statement: doc,
    ecr: { number: pr.plmEcrNumber, title: pr.title, revision: crSeq },
    prov: { baseline: p.baseline, changeRequest: p.changeRequest, codeVersion: detail.codeVersion, draws: detail.draws, s2RunId: run ? Number(run.id) : undefined, formulas, mock: matched.some(r => r.mock) },
  };
}

// ---- the process ------------------------------------------------------------------------------

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const name = process.env.WORKER_NAME ?? 'level1-publisher';
  const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 23)} [${name}] ${m}`);
  const settings = settingsFromEnv();
  const only = (process.env.NORN_PUBLISH_ECRS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const plm = plmFromConnector(await plmOptionsFromEnv());
  const { conn, R } = await connect({ kind: 'agent', name, origin: 'norn', spawnedBy: 'Norn' });
  // One id per process: two publishers of the same name share a saved identity, so the identity cannot tell them apart.
  const holder = `${name}-${randomUUID()}`;
  const leaseFor = (prId: bigint): Lease => ({
    async claim(statementId) {
      try {
        await R.claimPublication({ prId, statementId: BigInt(statementId), holder, leaseMs: LEASE_MS });
        return true;
      } catch (e) {
        if (/\[held\]/.test((e as Error).message)) return false;
        throw e;
      }
    },
    release: () => R.releasePublication({ prId, holder }),
  });
  await subscribe(conn, [
    'SELECT * FROM pull_request',
    'SELECT * FROM impact_statement',
    'SELECT * FROM check_run',
    'SELECT * FROM check_result',
    'SELECT * FROM ecr_revision',
  ]);
  const published = new Map<string, string>();
  const missingUntil = new Map<string, number>();
  let running = false;
  let again = false;

  async function sweep() {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        for (const pr of conn.db.pullRequest.iter()) {
          if (pr.plmEcrNumber.startsWith('NORN-') || (only.length && !only.includes(pr.plmEcrNumber))) continue;
          if ((missingUntil.get(pr.plmEcrNumber) ?? 0) > Date.now()) continue;
          const g = gather(conn.db, pr);
          if (!g) continue;
          try {
            const f = statementToPlmFields(g.statement, g.ecr, g.prov, { nornBaseUrl: settings.webBaseUrl });
            const r = await publishStatement({ plm, published, lease: leaseFor(pr.id), comment: settings.publishComment, log }, pr.plmEcrNumber, f, g.prov);
            if (r === 'written') log(`${pr.plmEcrNumber}: wrote Level ${g.statement.level} statement ${g.statement.id} to the PLM (ref ${f.ref}${f.recommendation ? `, ${f.recommendation}` : ''})`);
            else if (r === 'busy') log(`${pr.plmEcrNumber}: another publisher is writing it; looking again later`);
            else if (r === 'missing') {
              missingUntil.set(pr.plmEcrNumber, Date.now() + 5 * 60_000);
              log(`${pr.plmEcrNumber}: the PLM has no such ECR; not written (will look again in 5 minutes)`);
            }
          } catch (e) {
            log(`${pr.plmEcrNumber}: could not write to the PLM: ${(e as Error).message}`);
          }
        }
      } while (again);
    } finally {
      running = false;
    }
  }

  log(`publishing Level 1+ statements to the PLM${only.length ? ` for ${only.join(', ')}` : ''}; links point to ${settings.webBaseUrl}`);
  conn.db.impactStatement.onInsert(() => void sweep());
  setInterval(() => void sweep(), 15_000);
  void sweep();
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}
