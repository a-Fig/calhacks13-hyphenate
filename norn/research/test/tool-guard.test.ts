// The leak check on what the agent actually sends: Bright Data search and scrape calls are checked by
// the runner's PreToolUse hook before they go out. A "sent" list stands in for Bright Data.
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { describe, it } from 'node:test';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { bowman } from '../../../bowman/data/index.ts';
import { JobEmitter } from '../../runner/src/events.ts';
import { buildJobHooks } from '../../runner/src/hooks.ts';
import { runJob } from '../../runner/src/run-job.ts';
import { memorySink } from '../../runner/src/sinks.ts';
import { init, resultOk, stream, tmpRoot } from '../../runner/test/fixtures.ts';
import { buildResearchJob, SCRAPE_TOOL, SEARCH_TOOL, type ToolCallRecord } from '../src/job.ts';
import { reviewProposals } from '../src/guardrails.ts';
import { prepare, type Company } from '../src/run.ts';
import { fetcher, good, targets } from './helpers.ts';

const prep = prepare(bowman as unknown as Company, { ecrId: 'ECR-0417', seed: 'norn-seed-1', n: 3 });

/** A session as the runner builds it: the job's hooks in front of a pretend Bright Data that records what reaches it. */
function session() {
  const calls: ToolCallRecord[] = [];
  const denials: string[] = [];
  const job = buildResearchJob(prep.targets, { jobId: 'guard-test', ecr: 'ECR-0417', env: { BRIGHT_DATA_API_TOKEN: 'tok_fake' }, identifiers: prep.identifiers, onToolCall: (c) => calls.push(c) });
  const hooks = buildJobHooks({
    emitter: new JobEmitter('j', 'researcher', job.identity, () => {}),
    jobPrompt: job.prompt,
    maxChars: 1000,
    onFetchDenied: (_id, reason) => denials.push(reason),
    toolInputGuards: job.toolInputGuards,
  });
  const sent: { tool: string; input: unknown }[] = [];
  async function call(tool: string, input: unknown): Promise<'sent' | 'denied'> {
    for (const matcher of hooks.PreToolUse ?? []) {
      for (const h of matcher.hooks) {
        const out = (await h({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input } as never, 'tu1', { signal: new AbortController().signal })) as { hookSpecificOutput?: { permissionDecision?: string } };
        if (out.hookSpecificOutput?.permissionDecision === 'deny') return 'denied';
      }
    }
    sent.push({ tool, input });
    return 'sent';
  }
  return { job, call, sent, calls, denials };
}

describe('search calls are checked before they are sent', () => {
  it('refuses a search that names the supplier, a part number or a person, even if the agent leaves it out of its list of queries', async () => {
    const s = session();
    for (const query of ['Halden Precision machined bracket delivery delay cost', 'BW-5120-210 price', '5120210 bracket', 'Jeff Hargrove', 'Bow​man Aviation scrap', 'Hald​en Precision lead time']) {
      assert.equal(await s.call(SEARCH_TOOL, { query }), 'denied', query);
    }
    assert.deepEqual(s.sent, [], 'nothing reached Bright Data');
    assert.equal(s.denials.length, 6);
    assert.match(s.denials[0]!, /search_engine refused by Norn: the search contains an identifier from the company's data \(supplier/);
    assert.ok(!s.denials.join('\n').includes('Halden'), 'the reason names the kind of identifier, not the text');
  });
  it('checks every argument, not only the query', async () => {
    const s = session();
    assert.equal(await s.call(SEARCH_TOOL, { query: 'aluminum scrap price per pound', geo_location: 'Halden Precision' }), 'denied');
    assert.equal(await s.call(SEARCH_TOOL, { query: 'aluminum scrap price per pound', cursor: 'BW-5120-210' }), 'denied');
    assert.deepEqual(s.sent, []);
  });
  it('lets generic searches through, and tells the caller about each call (kinds only)', async () => {
    const s = session();
    assert.equal(await s.call(SEARCH_TOOL, { query: 'aluminum machine cuts scrap price per pound', engine: 'google' }), 'sent');
    assert.equal(await s.call(SEARCH_TOOL, { query: 'Halden' }), 'denied');
    assert.deepEqual(s.sent.map((x) => x.tool), [SEARCH_TOOL]);
    assert.deepEqual(s.calls, [
      { tool: SEARCH_TOOL, allowed: true, kinds: [] },
      { tool: SEARCH_TOOL, allowed: false, kinds: ['supplier'] },
    ]);
  });
  it('refuses a call with no query, or arguments of the wrong shape', async () => {
    const s = session();
    for (const input of [{}, { query: '' }, { query: 42 }, null, 'text', [1]]) assert.equal(await s.call(SEARCH_TOOL, input), 'denied', JSON.stringify(input));
    assert.deepEqual(s.sent, []);
  });
});

describe('encoded and nested arguments (review round 2)', () => {
  it('refuses a search whose text carries a percent-encoded identifier: "%48%61%6C%64%65%6E" is Halden', async () => {
    const s = session();
    for (const query of [
      'https://example.test/%48%61%6C%64%65%6E',
      '%48%61%6C%64%65%6E',
      '%2548%2561%256C%2564%2565%256E', // encoded twice
      'Jeff+Hargrove price',
      'Jeff%20Hargrove',
      'Bow%E2%80%8Bman Aviation',
      'q=BW%2D5120%2D210',
      '%35%31%32%30%32%31%30',
    ]) assert.equal(await s.call(SEARCH_TOOL, { query }), 'denied', query);
    assert.deepEqual(s.sent, []);
    assert.equal(await s.call(SEARCH_TOOL, { query: 'aluminum scrap 5%25 recovery price 100%' }), 'sent');
    assert.equal(await s.call(SEARCH_TOOL, { query: 'aluminum+scrap+price+per+pound' }), 'sent');
  });
  it('checks strings nested in the arguments, and object keys', async () => {
    const s = session();
    const q = 'aluminum scrap price';
    assert.equal(await s.call(SEARCH_TOOL, { query: q, filters: { a: ['x', { b: 'Halden' }] } }), 'denied');
    assert.equal(await s.call(SEARCH_TOOL, { query: q, Halden: true }), 'denied');
    assert.equal(await s.call(SEARCH_TOOL, { query: q, filters: { region: 'west' } }), 'sent');
  });
  it('refuses arguments nested deeper than it checks, however clean they look, and cyclic ones', async () => {
    const s = session();
    const deep = (n: number, leaf: unknown): unknown => (n === 0 ? leaf : { next: deep(n - 1, leaf) });
    assert.equal(await s.call(SEARCH_TOOL, { query: 'aluminum scrap price', extra: deep(8, 'Halden') }), 'denied');
    assert.equal(await s.call(SEARCH_TOOL, { query: 'aluminum scrap price', extra: deep(8, 'clean') }), 'denied');
    assert.equal(await s.call(SCRAPE_TOOL, { url: 'https://example.test/p', extra: deep(8, 'clean') }), 'denied');
    const cyc: Record<string, unknown> = { query: 'aluminum scrap price' };
    cyc.self = cyc;
    assert.equal(await s.call(SEARCH_TOOL, cyc), 'denied');
    assert.equal(await s.call(SEARCH_TOOL, { query: 'aluminum scrap price', extra: Array.from({ length: 600 }, () => 'x') }), 'denied');
    assert.match(s.denials.at(-1)!, /nested too deeply, or hold too many strings/);
    assert.deepEqual(s.sent, []);
  });
});

describe('page fetches are checked before they are sent', () => {
  it('refuses a URL with an identifier in its path or query', async () => {
    const s = session();
    for (const url of [
      'https://example.test/BW-5120-210?company=Bowman',
      'https://example.test/search?q=Halden%20Precision',
      'https://example.test/parts/5120210',
      'https://example.test/p#Hargrove',
    ]) assert.equal(await s.call(SCRAPE_TOOL, { url }), 'denied', url);
    assert.deepEqual(s.sent, []);
  });
  it('lets a clean URL through, and refuses a call with no URL', async () => {
    const s = session();
    assert.equal(await s.call(SCRAPE_TOOL, { url: 'https://rockawayrecycling.com/metal/al-machine-cuts/' }), 'sent');
    assert.equal(await s.call(SCRAPE_TOOL, {}), 'denied');
    assert.equal(await s.call(SCRAPE_TOOL, { url: 7 }), 'denied');
    assert.equal(s.sent.length, 1);
  });
  it('does not touch other tools', async () => {
    const s = session();
    assert.equal(await s.call('mcp__other__thing', { query: 'Halden' }), 'sent');
  });
});

describe('the guards reach the real session', () => {
  it('runJob gives the research job\'s guards to the session\'s hooks', async () => {
    const root = await tmpRoot();
    const job = buildResearchJob(prep.targets, { jobId: 'guard-run', ecr: 'ECR-0417', env: { BRIGHT_DATA_API_TOKEN: 'tok_fake' }, identifiers: prep.identifiers });
    let hooks: Options['hooks'];
    const res = await runJob(job, {
      sink: memorySink(),
      config: { workRoot: root },
      queryFn: ({ options }) => {
        hooks = options?.hooks;
        return stream([init, resultOk('{"proposals":[],"unresolved":[]}')]);
      },
    });
    assert.equal(res.status, 'succeeded');
    const deny = async (tool: string, input: unknown) => {
      for (const m of hooks!.PreToolUse!) for (const h of m.hooks) {
        const out = (await h({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input } as never, 'tu2', { signal: new AbortController().signal })) as { hookSpecificOutput?: { permissionDecision?: string } };
        if (out.hookSpecificOutput?.permissionDecision === 'deny') return true;
      }
      return false;
    };
    assert.equal(await deny(SEARCH_TOOL, { query: 'Halden Precision' }), true);
    assert.equal(await deny(SCRAPE_TOOL, { url: 'https://example.test/BW-5120-210' }), true);
    assert.equal(await deny(SEARCH_TOOL, { query: 'aluminum scrap price' }), false);
    await rm(root, { recursive: true, force: true });
  });
  it('a job cannot be built without the identifiers to check against', () => {
    // @ts-expect-error identifiers are required
    assert.throws(() => buildResearchJob(prep.targets, { jobId: 'x', ecr: 'e', env: { BRIGHT_DATA_API_TOKEN: 'tok_fake' } }));
  });
});

describe('a proposal\'s source URL is checked before the page is fetched', () => {
  it('rejects the review finding\'s example and fetches nothing', async () => {
    const seen: string[] = [];
    const spy: typeof fetcher = async (u) => { seen.push(u); return fetcher(u); };
    const bowmanCfg = { today: '2026-10-25', identifiers: prep.identifiers };
    const [v] = await reviewProposals([good({ sourceUrl: 'https://example.test/BW-5120-210?company=Bowman' })], targets, spy, bowmanCfg);
    assert.equal(v!.status, 'rejected');
    assert.ok(v!.reasons.some((r) => r.code === 'leak' && /source URL/.test(r.message)));
    assert.deepEqual(seen, []);
  });
});
