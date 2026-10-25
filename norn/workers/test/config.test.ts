// Offline tests for the start-up config (src/config.ts) and for what the module checks when the
// config is stored (module/src/company-config.ts). No database. The end-to-end check against a
// real module is src/checks-config.ts.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { COMPANY_CONFIG_KEY, canonicalJson, configEntries, configHash, loadConfigFile, type CompanyConfig } from '../../config/src/index.ts';
import { COMPANY_CONFIG_MAX_BYTES, checkCompanyConfig, utf8Length } from '../../module/src/company-config.ts';
import { COMPANY_CONFIG_ENV, applyStartupConfig, changedEntries, loadStartupConfig, refusalLines, type StartupConfig } from '../src/config.ts';
import type { Client } from '../src/connect.ts';

const BOWMAN = join(import.meta.dirname, '..', '..', '..', 'bowman', 'norn-config', 'bowman.config.ts');
const dir = mkdtempSync(join(tmpdir(), 'norn-startup-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const file = (name: string, text: string) => {
  const p = join(dir, name);
  writeFileSync(p, text);
  return p;
};

const loaded = await loadConfigFile(BOWMAN);
assert.ok(loaded.ok, 'the example configuration used by these tests must be valid');
const good: CompanyConfig = loaded.config;
const goodText = canonicalJson(good);
/** The stored text of a copy of the good config with `edit` applied. */
const variant = (edit: (c: Record<string, any>) => void) => {
  const copy = JSON.parse(goodText);
  edit(copy);
  return canonicalJson(copy);
};
const ok = (r: ReturnType<typeof checkCompanyConfig>) => {
  assert.ok(r.ok, r.ok ? '' : r.error);
  return r;
};

describe('loadStartupConfig', () => {
  it('treats an unset or blank variable as no config file', async () => {
    for (const env of [{}, { [COMPANY_CONFIG_ENV]: '' }, { [COMPANY_CONFIG_ENV]: '   ' }]) {
      assert.deepEqual(await loadStartupConfig(env), { kind: 'unset' });
    }
  });

  it('loads and validates a good file, and offers the pairs set_config takes', async () => {
    const c = await loadStartupConfig({ [COMPANY_CONFIG_ENV]: BOWMAN });
    assert.equal(c.kind, 'loaded');
    if (c.kind !== 'loaded') return;
    assert.deepEqual(c.entries, configEntries(good));
    assert.equal(c.entries[0]!.key, COMPANY_CONFIG_KEY);
    assert.equal(c.hash, configHash(goodText));
    assert.equal(c.bytes, Buffer.byteLength(goodText));
  });

  it('refuses a file that does not exist, naming the absolute path it looked at', async () => {
    const c = await loadStartupConfig({ [COMPANY_CONFIG_ENV]: join('nowhere', 'norn.config.ts') });
    assert.equal(c.kind, 'invalid');
    if (c.kind !== 'invalid') return;
    assert.match(c.issues[0]!.message, /no such file/);
    assert.ok(c.file.endsWith(join('nowhere', 'norn.config.ts')) && c.file.length > 'nowhere/norn.config.ts'.length);
  });

  it('refuses a file that is not JSON', async () => {
    const c = await loadStartupConfig({ [COMPANY_CONFIG_ENV]: file('broken.json', '{"schemaVersion": 1,') });
    assert.equal(c.kind, 'invalid');
    if (c.kind === 'invalid') assert.match(c.issues[0]!.message, /not valid JSON/);
  });

  it('refuses a module with no default export', async () => {
    const c = await loadStartupConfig({ [COMPANY_CONFIG_ENV]: file('nodefault.ts', 'export const x = 1;\n') });
    assert.equal(c.kind, 'invalid');
    if (c.kind === 'invalid') assert.match(c.issues[0]!.message, /no default export/);
  });

  it('refuses a config that fails the validator, and lists every problem', async () => {
    const bad = JSON.parse(goodText);
    delete bad.materiality;
    bad.reviewDepth.deepReview.maxPasses = 0;
    bad.surprise = true;
    const c = await loadStartupConfig({ [COMPANY_CONFIG_ENV]: file('invalid.json', JSON.stringify(bad)) });
    assert.equal(c.kind, 'invalid');
    if (c.kind !== 'invalid') return;
    const lines = refusalLines(c);
    assert.match(lines[0]!, new RegExp(`^${COMPANY_CONFIG_ENV}=.*invalid\\.json: 3 problems$`));
    assert.ok(lines.some((l) => l.includes('materiality: required section, but missing')), lines.join('\n'));
    assert.ok(lines.some((l) => l.includes('reviewDepth.deepReview.maxPasses')), lines.join('\n'));
    assert.ok(lines.some((l) => l.includes('surprise: unknown section')), lines.join('\n'));
    assert.equal(lines.length, 5);
    assert.match(lines.at(-1)!, /^Fern did not start/);
  });

  it('says "1 problem" for one', () => {
    const c: Extract<StartupConfig, { kind: 'invalid' }> = { kind: 'invalid', file: '/x.json', issues: [{ path: '', message: 'nope' }] };
    assert.equal(refusalLines(c)[0], `${COMPANY_CONFIG_ENV}=/x.json: 1 problem`);
  });
});

describe('changedEntries', () => {
  const entries = configEntries(good);
  const stored = (m: Record<string, string>) => (key: string) => m[key];
  it('offers every pair when nothing is stored', () => assert.deepEqual(changedEntries(entries, stored({})), entries));
  it('offers nothing when everything matches (a re-run)', () =>
    assert.deepEqual(changedEntries(entries, stored(Object.fromEntries(entries.map((e) => [e.key, e.value])))), []));
  it('offers only the pairs that differ', () => {
    const m = Object.fromEntries(entries.map((e) => [e.key, e.value]));
    m.deep_review_limit = '9';
    assert.deepEqual(changedEntries(entries, stored(m)).map((e) => e.key), ['deep_review_limit']);
  });
});

describe('what the module checks before it stores company_config', () => {
  it("takes the loader's text, and names a first store without the text", () => {
    const r = ok(checkCompanyConfig(goodText, undefined));
    assert.ok(!r.unchanged);
    if (r.unchanged) return;
    assert.match(r.summary, new RegExp(`^company_config: none -> ${configHash(goodText)} \\(\\d+\\.\\d KB\\); 12 sections: `));
    assert.equal(r.detail.from, null);
    assert.deepEqual(r.detail.to, { hash: configHash(goodText), bytes: utf8Length(goodText) });
    assert.ok(r.summary.length < 250, r.summary);
  });

  it('says nothing changed for the same text', () => assert.deepEqual(checkCompanyConfig(goodText, goodText), { ok: true, unchanged: true }));

  it('names the top-level sections that changed, were added or were removed, without embedding the text', () => {
    const next = variant((c) => {
      c.materiality.cutInSlipDays += 1;
      c.reviewDepth.deepReview.maxPasses = 3;
      c.extra = { a: 1 };
      delete c.postingStandards;
    });
    const r = ok(checkCompanyConfig(next, goodText));
    assert.ok(!r.unchanged);
    if (r.unchanged) return;
    assert.deepEqual(r.detail.changed, ['materiality', 'reviewDepth']);
    assert.deepEqual(r.detail.added, ['extra']);
    assert.deepEqual(r.detail.removed, ['postingStandards']);
    assert.match(r.summary, new RegExp(`^company_config: ${configHash(goodText)} -> ${configHash(next)} \\(`));
    assert.match(r.summary, /changed: materiality, reviewDepth; added: extra; removed: postingStandards$/);
    for (const text of [goodText, next]) assert.ok(!r.summary.includes(text.slice(0, 200)) && r.summary.length < 400);
    assert.ok(JSON.stringify(r.detail).length < 500);
  });

  it('keeps a long list of sections short', () => {
    const many = (n: number) => canonicalJson({ schemaVersion: 1, ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`s${String(i).padStart(3, '0')}`, i])) });
    const r = ok(checkCompanyConfig(many(300), many(5)));
    assert.ok(!r.unchanged);
    if (r.unchanged) return;
    assert.match(r.summary, /added: s005, s006, s007, s008, s009, s010, s011, s012 and 287 more$/);
    assert.equal(r.detail.added.length, 50);
  });

  const refused = (value: string, pattern: RegExp) => {
    const r = checkCompanyConfig(value, undefined);
    assert.ok(!r.ok && pattern.test(r.error), JSON.stringify(r));
  };
  it('refuses text that is empty, not JSON, not an object, or has no schemaVersion', () => {
    refused('', /empty/);
    refused('  ', /empty/);
    refused('{"schemaVersion":1', /not valid JSON/);
    refused('[1]', /must be a JSON object/);
    refused('null', /must be a JSON object/);
    refused('"text"', /must be a JSON object/);
    refused('{}', /no schemaVersion/);
    refused('{"schemaVersion":"1"}', /no schemaVersion/);
    refused('{"schemaVersion":0}', /no schemaVersion/);
    refused('{"schemaVersion":1.5}', /no schemaVersion/);
  });

  it('refuses JSON that is not in canonical form, so equal configs are equal text', () => {
    refused(JSON.stringify(JSON.parse(goodText), null, 2), /canonical JSON/);
    refused('{"schemaVersion":1,"a":1,"A":2}', /canonical JSON/);
    refused('{"schemaVersion":1.0}', /canonical JSON/);
  });

  it('limits the size in bytes, not characters', () => {
    const sized = (bytes: number, ch = 'x') => {
      const head = canonicalJson({ schemaVersion: 1, pad: '' });
      const extra = bytes - utf8Length(head);
      const unit = utf8Length(ch);
      assert.equal(extra % unit, 0);
      return canonicalJson({ schemaVersion: 1, pad: ch.repeat(extra / unit) });
    };
    assert.ok(checkCompanyConfig(sized(COMPANY_CONFIG_MAX_BYTES), undefined).ok, 'exactly the limit is accepted');
    refused(sized(COMPANY_CONFIG_MAX_BYTES + 1), /over the limit of 256\.0 KB/);
    // Two-byte characters: under the limit in characters, over it in bytes.
    const wide = sized(COMPANY_CONFIG_MAX_BYTES + 2, 'é');
    assert.ok(wide.length < COMPANY_CONFIG_MAX_BYTES);
    refused(wide, /over the limit/);
  });

  it('counts UTF-8 bytes the way the encoder does', () => {
    for (const s of ['', 'abc', 'é', '€', '😀', 'a😀€é']) assert.equal(utf8Length(s), Buffer.byteLength(s), s);
  });
});

// A stand-in for the connection: the module's write() returns normally when the policy gate denies a
// call and writes the denial to the action log, so setConfig resolves whether or not the value was
// stored. `behave` decides what the call does to the cache and the log.
describe('applyStartupConfig confirms what was stored', () => {
  type Row = { requestId: string; outcome: string; summary: string; policy: string };
  function fake(behave: (args: { key: string; value: string; meta?: { requestId?: string } }, cache: Map<string, string>, log: Row[]) => void, initial: Record<string, string> = {}) {
    const cache = new Map(Object.entries(initial));
    const rows: Row[] = [];
    const calls: string[] = [];
    const conn = {
      db: { nornConfig: { key: { find: (k: string) => (cache.has(k) ? { value: cache.get(k) } : undefined) } }, actionLog: { iter: () => rows } },
      subscriptionBuilder() {
        const b = { onApplied: (cb: () => void) => ((b as any).applied = cb, b), onError: () => b, subscribe: () => (setTimeout(() => (b as any).applied(), 0), { unsubscribe() {} }) };
        return b;
      },
    };
    const R = { setConfig: async (a: any) => (calls.push(a.key), behave(a, cache, rows)) };
    return { client: { conn, R } as unknown as Client, cache, rows, calls };
  }
  const loadedBowman = async () => {
    const c = await loadStartupConfig({ [COMPANY_CONFIG_ENV]: BOWMAN });
    assert.equal(c.kind, 'loaded');
    return c as Extract<StartupConfig, { kind: 'loaded' }>;
  };
  const stores = (a: { key: string; value: string }, cache: Map<string, string>) => void cache.set(a.key, a.value);

  it('reports success only once the values are in norn_config', async () => {
    const f = fake(stores);
    const lines: string[] = [];
    const r = await applyStartupConfig(f.client, await loadedBowman(), (m) => lines.push(m), { timeoutMs: 200 });
    assert.deepEqual(r.stored, [COMPANY_CONFIG_KEY, 'deep_review_mode', 'deep_review_limit']);
    assert.match(lines.join(' | '), /: stored company_config none -> /);
  });

  it("fails with the log's reason when the policy gate denied a call that resolved normally", async () => {
    const f = fake((a, _cache, rows) => {
      rows.push({ requestId: a.meta!.requestId!, outcome: 'denied', summary: 'set_config refused: set_config is not open to an agent working under job j-1', policy: 'deny: job scope' });
    });
    const lines: string[] = [];
    await assert.rejects(
      applyStartupConfig(f.client, await loadedBowman(), (m) => lines.push(m), { timeoutMs: 100 }),
      (e: Error) => /set_config was denied for company_config: set_config refused: set_config is not open to an agent working under job j-1 \(policy: deny: job scope\)/.test(e.message)
    );
    assert.deepEqual(f.calls, [COMPANY_CONFIG_KEY], 'stops at the first pair that did not take');
    assert.deepEqual(lines, [], 'no success is logged');
  });

  it('fails when the value never shows and the log has no refusal', async () => {
    const f = fake(() => {});
    await assert.rejects(
      applyStartupConfig(f.client, await loadedBowman(), () => {}, { timeoutMs: 100 }),
      (e: Error) => /company_config did not show in norn_config within 100 ms .* no refusal for request startup-config-/.test(e.message)
    );
  });

  it('accepts a value that shows up a little after the call returns', async () => {
    const f = fake((a, cache) => void setTimeout(() => cache.set(a.key, a.value), 60));
    const r = await applyStartupConfig(f.client, await loadedBowman(), () => {}, { timeoutMs: 1000 });
    assert.equal(r.stored.length, 3);
  });
});
