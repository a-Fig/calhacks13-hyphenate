// The text and fingerprint that the module and the worker both use for a stored configuration.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { COMPANY_CONFIG_KEY, canonicalJson, configHash } from '../src/index.ts';

describe('configHash', () => {
  it('is FNV-1a 64 as 16 hex characters (published test vectors)', () => {
    assert.equal(configHash(''), 'cbf29ce484222325');
    assert.equal(configHash('a'), 'af63dc4c8601ec8c');
    assert.equal(configHash('foobar'), '85944171f73967e8');
  });

  it('tells two canonical texts apart and is the same for the same text', () => {
    const a = canonicalJson({ b: 1, a: 2 });
    assert.equal(configHash(a), configHash(canonicalJson({ a: 2, b: 1 })));
    assert.notEqual(configHash(a), configHash(canonicalJson({ a: 2, b: 2 })));
    assert.match(configHash(a), /^[0-9a-f]{16}$/);
  });
});

describe('the stored key', () => {
  it('is company_config', () => assert.equal(COMPANY_CONFIG_KEY, 'company_config'));
});

describe('withDefaults in the module runtime', () => {
  it('does not need structuredClone, which SpacetimeDB modules do not have', async () => {
    const { loadConfigFile, withDefaults } = await import('../src/index.ts');
    const loaded = await loadConfigFile(fileURLToPath(new URL('../../../bowman/norn-config/bowman.config.ts', import.meta.url)));
    assert.ok(loaded.ok);
    const saved = globalThis.structuredClone;
    // @ts-expect-error the module runtime has no such global
    delete globalThis.structuredClone;
    try {
      const filled = withDefaults(loaded.config);
      assert.notEqual(filled, loaded.config);
      assert.deepEqual(withDefaults(filled), filled);
    } finally {
      globalThis.structuredClone = saved;
    }
  });
});
