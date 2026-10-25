#!/usr/bin/env node
// Norn research agent, command line.
//
//   node src/cli.ts --replay recordings/ecr-0417.recording.json [--json out.json] [--timeline]
//       Offline. Reads a recorded agent output and recorded pages, runs the guardrails and the
//       checks, prints the report. Everything it prints is labelled RECORDED.
//   node src/cli.ts --live ECR-0417 [--seed s] [--n 3] [--print-job] [--save-recording f] [--json out.json]
//       Builds the runner job with Bright Data's MCP server, runs it as a Claude Code session, checks
//       the proposals against pages fetched through Bright Data, and prints the report. Needs
//       BRIGHT_DATA_API_TOKEN in the environment and a Claude login on this machine.
//       --print-job prints the job (token redacted) and stops.

import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { bowman } from '../../../bowman/data/index.ts';
import { renderReport } from './report.ts';
import { AgentOutputError, buildResearchJob, DEFAULT_TOKEN_ENV, MissingTokenError, parseAgentOutput, redactJob, type ToolCallRecord } from './job.ts';
import { brightDataFetcher, plainFetcher, recordedFetcher, webFirstFetcher, type RecordedPage } from './pages.ts';
import { loadRecording, type Recording } from './recording.ts';
import { finish, prepare, type Company } from './run.ts';
import type { PageFetcher } from './types.ts';

const company = bowman as unknown as Company;

/** Printed first on every run, recorded or live: the company in the dataset is made up. */
const FICTIONAL_NOTICE =
  'Bowman Aviation and everything about it (its parts, suppliers, people, programs and figures) is FICTIONAL: a demonstration dataset, not a real company.';
const LIVE_NOTICE = `${FICTIONAL_NOTICE} The web research in this run is real; the change it prices is made up.`;

const USAGE = `Usage:
  node src/cli.ts --replay <recording.json> [--json <out.json>] [--timeline]
  node src/cli.ts --live <ECR-id> [--seed <s>] [--n <targets>] [--print-job] [--save-recording <file>] [--json <out.json>]`;

function die(msg: string, code = 64): never {
  process.stderr.write(`${msg}\n`);
  process.exit(code);
}

async function replay(path: string, o: { json?: string; timeline: boolean }): Promise<number> {
  const rec: Recording = await loadRecording(path);
  const prep = prepare(company, { ecrId: rec.ecr, seed: rec.seed, n: rec.n, timeline: o.timeline, ...(rec.context ? { context: rec.context } : {}) });
  const planted = Object.entries(rec.planted).map(([i, what]) => `RECORDED: proposal #${Number(i) + 1} is planted to test the guardrails: ${what}`);
  const { report } = await finish(prep, {
    mode: 'RECORDED',
    provenance: [
      FICTIONAL_NOTICE,
      rec.label,
      ...rec.provenance,
      ...[...new Set(rec.pages.map((p) => p.fetchedBy))].map((f) => `Pages fetched by: ${f}`),
      ...rec.pages.map((p) => `Page: ${p.url} (retrieved ${p.retrievedAt.slice(0, 10)}${p.excerpt ? ', excerpt' : ''})`),
      ...planted,
    ],
    agentOutput: rec.agentOutput,
    fetcher: recordedFetcher(rec.pages),
    guardrails: { today: rec.recordedOn },
  });
  console.log(renderReport(report));
  if (o.json) {
    await mkdir(dirname(resolve(o.json)), { recursive: true });
    await writeFile(o.json, JSON.stringify(report, null, 2) + '\n');
  }
  return 0;
}

async function live(ecrId: string, o: { seed: string; n: number; printJob: boolean; save?: string; json?: string }): Promise<number> {
  console.error(LIVE_NOTICE);
  const prep = prepare(company, { ecrId, seed: o.seed, n: o.n });
  const calls: ToolCallRecord[] = [];
  let job;
  try {
    job = buildResearchJob(prep.targets, { jobId: `research-${ecrId}-${Date.now()}`, ecr: ecrId, identifiers: prep.identifiers, onToolCall: (c) => calls.push(c) });
  } catch (e) {
    if (e instanceof MissingTokenError) die(e.message);
    throw e;
  }
  if (o.printJob) {
    console.log(JSON.stringify(redactJob(job), null, 2));
    return 0;
  }
  const today = new Date().toISOString().slice(0, 10);
  const { Runner, jsonlFileSink } = await import('../../runner/src/index.ts');
  const log = join(tmpdir(), `norn-research-${ecrId}.jsonl`);
  const runner = new Runner({ sink: jsonlFileSink(log) });
  console.error(`LIVE: running the research agent (event log: ${log})`);
  const result = await runner.run(job);
  if (result.status !== 'succeeded' || !result.result) {
    console.error(`LIVE: the agent job ${result.status}${result.error ? `: ${result.error.kind}: ${result.error.message}` : ''}`);
    return result.error?.kind === 'usage_limit' ? 2 : 1;
  }
  let agentOutput;
  try {
    agentOutput = parseAgentOutput(result.result);
  } catch (e) {
    if (e instanceof AgentOutputError) die(`LIVE: ${e.message}`, 1);
    throw e;
  }
  // Fetch each page again, by a plain HTTPS fetch first and through Bright Data when that fails, and keep what came back for --save-recording.
  const base = webFirstFetcher(plainFetcher({ today }), brightDataFetcher({ today }));
  const seen: RecordedPage[] = [];
  const fetcher: PageFetcher = async (url) => {
    const r = await base(url);
    if (r.ok && r.text !== undefined) seen.push({ url, retrievedAt: today, fetchedBy: r.via === 'fetch' ? 'a plain HTTPS fetch (text of the HTML), fetched by the guardrails' : 'Bright Data Web Unlocker (markdown), fetched by the guardrails', excerpt: false, text: r.text });
    return r;
  };
  const refused = calls.filter((c) => !c.allowed);
  const { report } = await finish(prep, {
    mode: 'LIVE',
    provenance: [
      LIVE_NOTICE,
      `web calls checked for company identifiers before they were sent: ${calls.length}; refused: ${refused.length}${refused.length ? ` (${refused.map((c) => `${c.tool.replace('mcp__brightdata__', '')}: ${c.kinds.join(', ') || 'malformed'}`).join('; ')})` : ''}`,
      `agent: Claude Code session ${result.sessionId ?? '?'} (${result.model}) with WebSearch and WebFetch first and Bright Data MCP as the fallback (${DEFAULT_TOKEN_ENV} from the environment); pages re-fetched by the guardrails by a plain HTTPS fetch first, through Bright Data when that fails`,
    ],
    agentOutput,
    fetcher,
    guardrails: { today },
  });
  console.log(renderReport(report));
  if (o.json) await writeFile(o.json, JSON.stringify(report, null, 2) + '\n');
  if (o.save) {
    const rec: Recording = {
      kind: 'norn-research-recording', version: 1,
      label: `Recorded from a live run on ${today}; replays what the agent proposed and the pages it was checked against.`,
      ecr: ecrId, seed: o.seed, n: o.n, recordedOn: today,
      provenance: [`agent output as returned by Claude Code session ${result.sessionId ?? '?'}`],
      agentOutput, planted: {}, pages: seen,
    };
    await writeFile(o.save, JSON.stringify(rec, null, 2) + '\n');
    console.error(`saved a recording to ${o.save}`);
  }
  return 0;
}

const { values } = parseArgs({
  options: {
    replay: { type: 'string' }, live: { type: 'string' }, seed: { type: 'string', default: 'norn-seed-1' }, n: { type: 'string', default: '3' },
    json: { type: 'string' }, 'print-job': { type: 'boolean', default: false }, 'save-recording': { type: 'string' }, timeline: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h' },
  },
  strict: true,
});
if (values.help || (!values.replay && !values.live)) die(USAGE, values.help ? 0 : 64);
const code = values.replay
  ? await replay(values.replay, { ...(values.json ? { json: values.json } : {}), timeline: values.timeline! })
  : await live(values.live!, { seed: values.seed!, n: Number(values.n), printJob: values['print-job']!, ...(values['save-recording'] ? { save: values['save-recording'] } : {}), ...(values.json ? { json: values.json } : {}) });
process.exit(code);
