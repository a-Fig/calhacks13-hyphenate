// What Norn's state layer stores of a configuration, and how: the key it lives under, the canonical
// JSON text, and a short fingerprint of that text.
//
// This file imports nothing, on purpose. The SpacetimeDB module imports it (to check a stored config
// is canonical and to name it in the action log) and so does the worker (to know whether the stored
// config differs from the file), so both sides agree on the text and the fingerprint. It cannot
// import the schema: the module's TypeScript settings differ from this package's.

/** The key the whole configuration is stored under. */
export const COMPANY_CONFIG_KEY = 'company_config';

/**
 * JSON with sorted keys and no whitespace, so equal configurations give identical text and the same
 * fingerprint. Optional fields that are unset are left out.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`cannot write ${value} as JSON`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v ?? null)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`);
    return `{${fields.join(',')}}`;
  }
  throw new Error(`cannot write a ${typeof value} as JSON`);
}

/**
 * A 16-character fingerprint of a stored text (FNV-1a, 64 bits). It tells two versions of a
 * configuration apart in a log line. It is not a signature and says nothing about who wrote the text.
 */
export function configHash(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    h ^= BigInt(text.charCodeAt(i));
    h = BigInt.asUintN(64, h * 0x100000001b3n);
  }
  return h.toString(16).padStart(16, '0');
}
