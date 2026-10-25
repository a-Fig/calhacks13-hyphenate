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
// sweep, by which time the PLM shows the ref. With the lease held it also picks the statement again,
// so a publisher that waited with an older candidate never overwrites a newer one. The PLM is read on
// every sweep rather than trusting a remembered ref: a cached "done" would never repair a change made
// since (by a person, or by a publisher that has since exited).
import { pathToFileURL } from 'node:url';
import type { DbConnection } from '@norn/bindings';
import { connect, subscribe } from '../connect.ts';
import { randomUUID } from 'node:crypto';
import { provenanceOf } from '../impact.ts';
import { alreadyPublished, statementToPlmFields, type Formatted, type Provenance, type StatementDoc } from './format.ts';
import { ruleInputOf } from './recommendation.ts';
import { plmFromConnector, plmOptionsFromEnv, type PlmApi } from './plm.ts';
import { costCheckOf, storedCompanyConfig, type EcrRef } from './routing.ts';
import { statementIsFor } from './plan.ts';
import { settingsFromEnv } from './settings.ts';
import { crSeqOfRun, failedChecksForRun, jsonOr, runInputs } from './source.ts';

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
  /** Without one, nothing stops two publishers writing at once. The process always passes one. */
  lease?: Lease;
  /** Post a short comment on the ECR after a write. */
  comment?: boolean;
  /**
   * Recording in Norn that the rule's recommendation replaced the agent's (see `recordOverride`). `recorded` is a
   * cheap look at what this process knows; `record` runs under the lease, on the statement actually published, and
   * re-reads Norn's comments itself before inserting.
   */
  override?: { recorded(f: Formatted): boolean; record(f: Formatted): Promise<unknown> };
  log: (m: string) => void;
}

/** The outcome, and the statement it is about: the one actually written or found in the PLM, which may be a newer one than was passed in. */
export interface Published {
  result: PublishResult;
  f?: Formatted;
}

export interface Publication {
  f: Formatted;
  prov: Pick<Provenance, 'mock'>;
}

/**
 * Write one formatted statement onto the ECR in the PLM, unless the PLM already shows it.
 *
 * The PLM is always read, never a remembered ref: someone may have changed the fields since (a person,
 * or another publisher), and a remembered "done" would never notice. Once the lease is ours,
 * `latest` picks the statement again from Norn's database and the PLM is read again, so a publisher
 * that paused holding an older candidate does not overwrite a newer one another publisher wrote
 * while it waited: it writes only what is still the newest and differs from what the PLM holds.
 */
export async function publishStatement(d: PublishDeps, ecrNumber: string, f: Formatted, prov: Pick<Provenance, 'mock'>, latest?: () => Publication | null): Promise<PublishResult> {
  return (await publishDetailed(d, ecrNumber, f, prov, latest)).result;
}

/** `publishStatement`, also saying which statement it wrote or found: under the lease it can switch to a newer one. */
export async function publishDetailed(d: PublishDeps, ecrNumber: string, f: Formatted, prov: Pick<Provenance, 'mock'>, latest?: () => Publication | null): Promise<Published> {
  const mock = (): Published => {
    d.log(`${ecrNumber}: not written to the PLM, the statement rests on mock numbers`);
    return { result: 'mock' };
  };
  // An override is recorded in Norn under the same lease as the PLM write, on the statement actually published.
  const record = async (p: Formatted) => {
    if (!p.overridden || !d.override) return;
    try {
      await d.override.record(p);
    } catch (e) {
      d.log(`${ecrNumber}: could not record the override in Norn: ${(e as Error).message}`);
    }
  };
  if (prov.mock) return mock();
  const current = await d.plm.readImpact(ecrNumber);
  if (current === null) return { result: 'missing' };
  // Already in the PLM. Only an override Norn has not yet recorded is left to do, and that needs the lease too.
  if (alreadyPublished(current, f) && !(f.overridden && d.override && !d.override.recorded(f))) return { result: 'unchanged', f };
  if (!d.lease && alreadyPublished(current, f)) {
    await record(f);
    return { result: 'unchanged', f };
  }
  if (d.lease && !(await d.lease.claim(Number(f.ref.split('.')[0])))) return { result: 'busy' };
  try {
    let target = { f, prov };
    if (d.lease) {
      // Whoever held the lease before us may have written while we waited: choose again, look again, now that it is ours.
      if (latest) {
        const n = latest();
        if (!n) return { result: 'unchanged' };
        if (n.f.ref !== f.ref) d.log(`${ecrNumber}: a newer statement (${n.f.ref}) took over from ${f.ref} while waiting for the lease`);
        target = n;
        if (n.prov.mock) return mock();
      }
      const again = await d.plm.readImpact(ecrNumber);
      if (again === null) return { result: 'missing' };
      if (alreadyPublished(again, target.f)) {
        await record(target.f);
        return { result: 'unchanged', f: target.f };
      }
    }
    const after = await d.plm.writeImpact(ecrNumber, target.f.fields);
    // Proof, not the status code: the PLM's answer holds our ref.
    if (!alreadyPublished(after, target.f)) d.log(`${ecrNumber}: the PLM stored the statement but its answer differs from what was sent (it may have rewritten the text)`);
    if (d.comment) {
      const rec = target.f.recommendation ? ` Recommendation: ${target.f.recommendation}.` : '';
      await d.plm.postComment(ecrNumber, `<p>Norn posted a Level ${target.f.fields.impact_report_level} impact statement on this ECR.${rec} See the Impact assessment tab.</p>`);
    }
    await record(target.f);
    return { result: 'written', f: target.f };
  } finally {
    await d.lease?.release().catch(() => {});
  }
}

// ---- recording an override in Norn ----------------------------------------------------------------

/** What Norn's ECR page shows when the rule, not the agent, set the recommendation. Plain text: a comment. */
/** The statement a formatted publication is for: the ref starts with its id. */
export const statementIdOf = (f: Formatted): number => Number(f.ref.split('.')[0]);

export function overrideComment(statementId: number, o: NonNullable<Formatted['overridden']>): string {
  const agent = o.agent ? `"${o.agent}"` : 'none';
  return `Norn's rule set the recommendation to ${o.derived.recommendation}; the Level 1 agent wrote ${agent} (rule ${o.derived.rule}, statement ${statementId}). ${o.derived.reasoning}`;
}

export interface OverrideDeps {
  /** The bodies of the comments on the ECR, read fresh: this runs under the publication lease. */
  existing(): string[] | Promise<string[]>;
  /** Comment on the ECR as the publisher (add_comment). */
  add(body: string): Promise<void>;
}

/**
 * Leave a comment on the ECR in Norn when the PLM got the rule's recommendation instead of the agent's, so Norn's
 * page does not show the agent's "Send back" while the PLM says "Approve with conditions". A comment, because it
 * needs no module change and the ECR page already lists comments. At most once per statement and outcome: the
 * body is its own key, looked up among the ECR's comments, so a restart or a later sweep adds nothing.
 */
export async function recordOverride(d: OverrideDeps, statementId: number, f: Formatted): Promise<boolean> {
  if (!f.overridden) return false;
  const body = overrideComment(statementId, f.overridden);
  if ((await d.existing()).includes(body)) return false;
  await d.add(body);
  return true;
}

// ---- reading Norn's database ---------------------------------------------------------------

type Row<T extends keyof DbConnection['db']> = DbConnection['db'][T] extends { iter(): IterableIterator<infer R> } ? R : never;

/** What ranking a statement needs. `crSeq` is the change-request revision of the run it was written from, or null; `prRevision` is the ECR's own revision counter the module saw when it was posted. */
export interface Candidate {
  id: bigint;
  level: number;
  crSeq: number | null;
  prRevision: number;
}

/**
 * The statement to publish for an ECR: of those for the current revision, the highest level, newest
 * of that level. A statement written from a check run is for that run's change-request revision. One
 * that rests on no run is for the current revision only if the ECR has not changed since the module
 * recorded it (same `prRevision`); it is never bound by when it was posted. An earlier revision's
 * statement never beats the current one, whatever its level; with none for the current revision
 * there is nothing to publish (the PLM keeps showing the earlier one, whose text names its revision).
 */
export function pickStatement<T extends Candidate>(all: T[], current: { seq: number | null; prRevision: number }): T | undefined {
  let best: T | undefined;
  for (const s of all) {
    const forNow = s.crSeq !== null ? current.seq !== null && statementIsFor(s, current.seq) : s.prRevision === current.prRevision;
    if (!forNow) continue;
    if (!best || s.level > best.level || (s.level === best.level && s.id > best.id)) best = s;
  }
  return best;
}

export function gather(db: DbConnection['db'], pr: Row<'pullRequest'>): { statement: StatementDoc; ecr: EcrRef; prov: Provenance } | null {
  const cur = [...db.ecrRevision.prId.filter(pr.id)].find(r => r.current);
  const candidates = [...db.impactStatement.prId.filter(pr.id)].map(s => ({ row: s, id: s.id, level: s.level, prRevision: s.prRevision, crSeq: crSeqOfRun(db, s.checkRunId) }));
  const picked = pickStatement(candidates, { seq: cur?.seq ?? null, prRevision: pr.revision });
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
    prov: { baseline: p.baseline, changeRequest: p.changeRequest, codeVersion: detail.codeVersion, draws: detail.draws, s2RunId: run ? Number(run.id) : undefined, formulas, mock: matched.some(r => r.mock), costCheck: run ? costCheckOf(results.filter(r => r.checkRunId === run.id)) : undefined,
      // The recommendation rule reads the statement's own run, so it is derived only for a statement that has one.
      ruleInput: run ? ruleInputOf(results.filter(r => r.checkRunId === run.id), failedChecksForRun(db, pr.id, run.id)) : undefined },
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
  // The module takes the holder from our connection's identity. Two publishers of the same name share a
  // saved identity, so each process also names itself.
  const processId = `${name}-${randomUUID()}`;
  const leaseFor = (prId: bigint): Lease => ({
    async claim(statementId) {
      try {
        await R.claimPublication({ prId, statementId: BigInt(statementId), processId, leaseMs: LEASE_MS });
        return true;
      } catch (e) {
        if (/\[held\]/.test((e as Error).message)) return false;
        throw e;
      }
    },
    release: () => R.releasePublication({ prId, processId }),
  });
  await subscribe(conn, [
    'SELECT * FROM pull_request',
    'SELECT * FROM impact_statement',
    'SELECT * FROM check_run',
    'SELECT * FROM check_result',
    'SELECT * FROM ecr_revision',
    'SELECT * FROM norn_config',
    'SELECT * FROM comment',
  ]);
  const posted = new Set<string>(); // comments this process added, until the cache shows them
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
            const config = storedCompanyConfig(conn.db);
            const f = statementToPlmFields(g.statement, g.ecr, g.prov, { nornBaseUrl: settings.webBaseUrl, config });
            // After the lease is ours: the newest statement again, from the freshest cache.
            const latest = (): Publication | null => {
              const g2 = gather(conn.db, conn.db.pullRequest.id.find(pr.id) ?? pr);
              return g2 ? { f: statementToPlmFields(g2.statement, g2.ecr, g2.prov, { nornBaseUrl: settings.webBaseUrl, config: storedCompanyConfig(conn.db) }), prov: g2.prov } : null;
            };
            // Recording an override in Norn: under the lease, on the statement actually published, after re-reading the ECR's comments.
            const cached = () => [...posted, ...[...conn.db.comment.prId.filter(pr.id)].map(c => c.body)];
            const fresh = async () => {
              const sub = await subscribe(conn, [`SELECT * FROM comment WHERE pr_id = ${pr.id}`]);
              try {
                return cached();
              } finally {
                sub.unsubscribe();
              }
            };
            const overrideDeps: OverrideDeps = {
              existing: fresh,
              add: async body => {
                await R.addComment({ prId: pr.id, anchor: '', body });
                posted.add(body);
              },
            };
            const override = {
              recorded: (p: Formatted) => !p.overridden || cached().includes(overrideComment(statementIdOf(p), p.overridden)),
              record: async (p: Formatted) => {
                if (await recordOverride(overrideDeps, statementIdOf(p), p)) log(`${pr.plmEcrNumber}: recorded in Norn that the rule's recommendation replaced the agent's (statement ${statementIdOf(p)})`);
              },
            };
            const out = await publishDetailed({ plm, lease: leaseFor(pr.id), comment: settings.publishComment, override, log }, pr.plmEcrNumber, f, g.prov, latest);
            const r = out.result;
            const w = out.f ?? f; // the statement actually written, which can be a newer one than was gathered
            if (r === 'written') log(`${pr.plmEcrNumber}: wrote Level ${w.fields.impact_report_level} statement ${statementIdOf(w)} to the PLM (ref ${w.ref}${w.recommendation ? `, ${w.recommendation}` : ''})`);
            if (r === 'written' && w.overridden) log(`${pr.plmEcrNumber}: the agent wrote ${w.overridden.agent ? `"${w.overridden.agent}"` : 'no recommendation'}; rule ${w.overridden.derived.rule} gives "${w.overridden.derived.recommendation}", which is what the PLM got`);
            if (r === 'busy') log(`${pr.plmEcrNumber}: another publisher is writing it; looking again later`);
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
