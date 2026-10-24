// The ERP change package on a released ECO (#72). When an ECR is released in Norn (status merged) and
// the PLM has given its change order number (eco_release), the worker works out what the ECO changes
// in the ERP from the ECR's last assessment (release.ts), has the ERPNext connector turn that into the
// lines a person enters, and records the package with record_erp_package. On each new ERP read it
// checks the package again, so each line shows whether it has been entered. Norn never writes to the
// ERP (#71): the connector only reads.
import type { DbConnection } from '@norn/bindings';
import { costCheck, costCheckRows, type ChangeRequest, type CostCheckResult } from '../../checks/src/index.ts';
import { planEcoRelease, type EcoRelease, type ErpnextConnection, type ErpnextSettings } from '../../connectors/erpnext/src/index.ts';
import type { BaselineStore } from './baseline.ts';
import type { Client } from './connect.ts';
import { assumptionsOf, provenanceOf, type Inputs } from './impact.ts';
import { releaseOf } from './release.ts';
import { AbortedError } from './stages.ts';

/** What the connector made of a release: the package as stored, and its counts. */
export type PlannedPackage = { packageJson: string; lines: number; entered: number; conflicts: number; problems: string[] };
export type Planner = (release: EcoRelease) => Promise<PlannedPackage>;

/** The connector's planner on the company's ERPNext. It reads; it never writes. */
export function erpPlanner(connection: ErpnextConnection, settings: ErpnextSettings): Planner {
  return async release => {
    const plan = await planEcoRelease(connection, settings, release);
    return {
      packageJson: JSON.stringify(plan),
      lines: plan.steps.length,
      entered: plan.steps.filter(s => s.status === 'done').length,
      conflicts: plan.steps.filter(s => s.status === 'conflict').length,
      problems: plan.problems,
    };
  };
}

export type PackageOptions = {
  /** Where Norn's ECR pages are, for the trace on every line, e.g. https://norn.example.com. */
  webUrl: string;
  /** The company's time zone, for the release day. */
  timeZone?: string;
};

/** The stored rows an assessment computed again is compared on: its totals. A worker subscribes to just these. */
export const GUARD_KEYS = ['one_time_total', 'net_total_year_one'];
type Row = { key: string; p10: number; p50: number; p90: number };
const sameRows = (a: Row[], b: Row[]) => a.length === b.length && a.every((r, i) => r.key === b[i]!.key && r.p10 === b[i]!.p10 && r.p50 === b[i]!.p50 && r.p90 === b[i]!.p90);
const dayIn = (micros: bigint, timeZone?: string) => new Date(Number(micros / 1000n)).toLocaleDateString('en-CA', timeZone ? { timeZone } : { timeZone: 'UTC' });

/**
 * The assessment a finished s2 run produced, computed again on exactly the inputs it names. The
 * library is deterministic on them, so it is the same assessment: the stored rows are compared to be sure.
 */
export async function assessmentOf(conn: DbConnection, baselines: BaselineStore, runId: bigint, log: (m: string) => void): Promise<{ cr: ChangeRequest; result: CostCheckResult } | string> {
  const run = conn.db.checkRun.id.find(runId);
  if (!run) return `run ${runId} is not in the cache`;
  const inputs = JSON.parse(run.inputsJson) as Inputs;
  if (inputs.revision === undefined || !inputs.erpBaseline || !inputs.seed) return `run ${runId} was not computed on a change request and an ERP baseline`;
  const rev = [...conn.db.ecrRevision.prId.filter(run.prId)].find(r => r.seq === inputs.revision);
  if (!rev || rev.digest !== inputs.overlay) return `the change request revision run ${runId} names is not in the cache`;
  const baseline = await baselines.get(inputs.erpBaseline, log).catch(() => undefined);
  if (!baseline) return `ERP baseline ${inputs.erpBaseline.slice(0, 12)}, which run ${runId} computed on, is not cached on this worker`;
  let overrides;
  try {
    overrides = assumptionsOf(conn, inputs).overrides;
  } catch (e) {
    if (e instanceof AbortedError) return `an assumption run ${runId} names is not in the cache`;
    throw e;
  }
  const cr = JSON.parse(rev.changeRequestJson) as ChangeRequest;
  const result = costCheck(baseline, cr, { seed: inputs.seed, assumptions: overrides, provenance: provenanceOf(inputs) });
  const guard = (rows: Row[]) => GUARD_KEYS.map(k => rows.find(r => r.key === k)).filter((r): r is Row => !!r);
  const stored = guard([...conn.db.checkResult.iter()].filter(r => r.checkRunId === runId));
  if (!stored.length || !sameRows(stored, guard(costCheckRows(result)))) return `computing run ${runId} again did not give its stored totals`;
  return { cr, result };
}

/** Build or re-check the package of every released ECO that needs it. Returns what it did, for the log. */
export async function packageOnce(conn: DbConnection, R: Client['R'], baselines: BaselineStore, planner: Planner, opts: PackageOptions, log: (m: string) => void) {
  const out = { built: 0, unchanged: 0, skipped: [] as string[] };
  const base = [...conn.db.baselineSnapshot.iter()].find(b => b.current);
  if (!base) return out;
  for (const pr of conn.db.pullRequest.iter()) {
    if (pr.status !== 'merged') continue;
    const eco = conn.db.ecoRelease.prId.find(pr.id);
    if (!eco) continue;
    // The assessment the ECR was released on: its newest finished cost run.
    const s2 = [...conn.db.checkRun.prId.filter(pr.id)].filter(r => r.stage === 's2_cost' && r.status === 'done').sort((a, b) => Number(b.id - a.id))[0];
    if (!s2) {
      out.skipped.push(`${pr.plmEcrNumber}: no finished cost assessment`);
      continue;
    }
    const prev = conn.db.erpPackage.prId.find(pr.id);
    if (prev && prev.s2RunId === s2.id && prev.erpBaseline === base.hash) continue; // checked on this ERP read already
    const a = await assessmentOf(conn, baselines, s2.id, log);
    if (typeof a === 'string') {
      out.skipped.push(`${pr.plmEcrNumber}: ${a}`);
      continue;
    }
    const { release, notes } = releaseOf(a.cr, a.result, {
      eco: eco.ecoNumber,
      decision: { id: `${pr.plmEcrNumber} (assessment run ${s2.id})`, url: `${opts.webUrl.replace(/\/+$/, '')}/ecr/${encodeURIComponent(pr.plmEcrNumber)}` },
      releasedOn: dayIn(eco.recordedAt.microsSinceUnixEpoch, opts.timeZone),
    });
    const planned = await planner(release);
    await R.recordErpPackage({
      prId: pr.id,
      ecoNumber: eco.ecoNumber,
      s2RunId: s2.id,
      erpBaseline: base.hash,
      releaseJson: JSON.stringify(release),
      packageJson: planned.packageJson,
      lines: planned.lines,
      entered: planned.entered,
      conflicts: planned.conflicts,
      notesJson: JSON.stringify({ notes, problems: planned.problems }),
    });
    const changed = !prev || prev.packageJson !== planned.packageJson || prev.s2RunId !== s2.id;
    if (changed) {
      out.built++;
      log(`ERP change package for ${eco.ecoNumber} (${pr.plmEcrNumber}): ${planned.entered} of ${planned.lines} line(s) entered${planned.conflicts ? `, ${planned.conflicts} in conflict` : ''}${planned.problems.length ? `, ${planned.problems.length} problem(s)` : ''}`);
    } else out.unchanged++;
  }
  return out;
}
