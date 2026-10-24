// The text and fingerprint that the module and the worker both use for a stored configuration.
import assert from 'node:assert/strict';
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
