#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { JobSpecError } from './config.ts';
import { Runner } from './runner.ts';
import { jsonlFileSink, teeSink } from './sinks.ts';
import type { JobResult, JobSpec, NornEvent } from './types.ts';

const USAGE = `Usage: node src/cli.ts <job.json>... [options]

Runs each job as one Claude Code session and writes every event to a JSONL log.

Options:
  --log <file>         Event log (default: logs/<first job id>-<time>.jsonl)
  --concurrency <n>    Sessions at once when several jobs are given (default 2)
  --model <id>         Use this model for every job, overriding the job files
  --keep-workdir       Keep each job's working directory
  --json               Print the results as JSON instead of the summary
  -h, --help

A job file is the JobSpec as JSON (see examples/job.example.json). MCP servers in a job file
must be stdio, http or sse; in-process servers can only be attached from code.

Exit code: 0 all succeeded, 1 a job failed, 2 a usage limit was hit, 3 timed out,
4 cancelled, 64 bad arguments or job file.`;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(64);
}

async function loadJob(path: string): Promise<JobSpec> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    return fail(`cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  let spec: JobSpec;
  try {
    spec = JSON.parse(raw) as JobSpec;
  } catch (err) {
    return fail(`${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  for (const [name, server] of Object.entries(spec?.mcpServers ?? {})) {
    if ((server as { type?: string } | undefined)?.type === 'sdk') {
      fail(`${path}: mcp server ${JSON.stringify(name)} is in-process; that can only be attached from code`);
    }
  }
  return spec;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function summarize(result: JobResult, toolCalls: Map<string, number>): string {
  const lines: string[] = [];
  lines.push(`job ${result.jobId}  role=${result.role}  model=${result.model}`);
  lines.push(`  actor=${result.identity.actor}  onBehalfOf=${result.identity.onBehalfOf ?? 'null'}  spawnedBy=${result.identity.spawnedBy}`);
  const u = result.usage;
  lines.push(
    `  status: ${result.status}   turns: ${result.numTurns}   time: ${seconds(result.durationMs)}` +
      (u ? `   tokens: in ${u.inputTokens} / out ${u.outputTokens} / cache read ${u.cacheReadInputTokens}` : ''),
  );
  const calls = [...toolCalls].map(([name, n]) => `${name} x${n}`).join(', ');
  lines.push(`  tool calls: ${calls || 'none'}${result.permissionDenials.length ? `   denied: ${result.permissionDenials.map((d) => d.tool).join(', ')}` : ''}`);
  if (result.error) {
    lines.push(`  error: [${result.error.kind}] ${result.error.message}`);
    if (result.error.kind === 'usage_limit') {
      lines.push(`  usage limit hit; resets ${result.error.resetsAt ?? 'at an unknown time'}. Run the job again after that.`);
    }
  }
  if (result.result) lines.push(`  result: ${result.result.length > 600 ? `${result.result.slice(0, 600)}... (full text in the log)` : result.result}`);
  return lines.join('\n');
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      log: { type: 'string' },
      concurrency: { type: 'string' },
      model: { type: 'string' },
      'keep-workdir': { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const files = positionals[0] === 'run' ? positionals.slice(1) : positionals;
  if (files.length === 0) fail(USAGE);

  const concurrency = values.concurrency === undefined ? 2 : Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1) fail('--concurrency must be a positive integer');

  const specs = await Promise.all(files.map(loadJob));
  if (values.model) for (const spec of specs) spec.model = values.model;

  const logPath = resolve(values.log ?? `logs/${specs[0]?.id ?? 'job'}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  const log = jsonlFileSink(logPath);
  const toolCalls = new Map<string, Map<string, number>>();
  const counter = (event: NornEvent) => {
    if (event.type !== 'tool_call') return;
    const counts = toolCalls.get(event.jobId) ?? new Map<string, number>();
    counts.set(event.tool, (counts.get(event.tool) ?? 0) + 1);
    toolCalls.set(event.jobId, counts);
  };

  const runner = new Runner({
    sink: teeSink(log, counter),
    config: { concurrency, keepWorkDirs: values['keep-workdir'] ?? false },
  });
  let interrupted = false;
  process.on('SIGINT', () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    process.stderr.write('\nCancelling jobs (press Ctrl+C again to exit now)...\n');
    runner.cancelAll();
  });

  let results: JobResult[];
  try {
    results = await Promise.all(specs.map((spec) => runner.submit(spec).result));
  } catch (err) {
    await log.close();
    if (err instanceof JobSpecError) fail(err.message);
    throw err;
  }
  await log.close();

  if (values.json) {
    process.stdout.write(`${JSON.stringify({ log: logPath, results }, null, 2)}\n`);
  } else {
    for (const result of results) process.stdout.write(`${summarize(result, toolCalls.get(result.jobId) ?? new Map())}\n`);
    process.stdout.write(`event log: ${logPath}\n`);
  }

  const statuses = new Set(results.map((r) => r.status));
  if (results.some((r) => r.error?.kind === 'usage_limit')) return 2;
  if (statuses.has('failed')) return 1;
  if (statuses.has('timed_out')) return 3;
  if (statuses.has('cancelled')) return 4;
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`norn-runner: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exit(1);
  },
);
