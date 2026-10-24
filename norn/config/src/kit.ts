// A small schema kit: one definition gives both the TypeScript type and the runtime check, so the
// two cannot drift apart. It exists to give Norn's config loader error messages that name the path
// of the bad field and report every problem in one pass. No runtime dependencies.
//
// Plain functions and interfaces only (erasable syntax): Node 24 strips the types.

export interface Issue {
  /** Where the problem is, e.g. 'approval.tiers[1].upToUsd'. Empty for the file as a whole. */
  path: string;
  message: string;
}

export interface Schema<T> {
  /** Phantom field that carries the accepted type. Never set at runtime. */
  readonly _type?: T;
  /**
   * Checks `value` and pushes one issue per problem found. Returns true when everything under
   * `path` is clean, so a caller can skip checks that need a well-formed value.
   */
  check(value: unknown, path: string, issues: Issue[]): boolean;
}

export interface OptionalSchema<T> extends Schema<T | undefined> {
  readonly optional: true;
}

export type Infer<S> = S extends Schema<infer T> ? T : never;

type Shape = Record<string, Schema<any>>;
type OptionalKeys<S extends Shape> = { [K in keyof S]: S[K] extends OptionalSchema<any> ? K : never }[keyof S];
type Simplify<T> = { [K in keyof T]: T[K] } & {};
export type InferShape<S extends Shape> = Simplify<
  { [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]> } & {
    [K in OptionalKeys<S>]?: Exclude<Infer<S[K]>, undefined>;
  }
>;

// ---------------------------------------------------------------- messages

/** How a bad value is shown in "got ...". */
export function describe(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value.length > 40 ? value.slice(0, 37) + '...' : value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object') return 'an object';
  return `a ${typeof value}`;
}

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length]!;
}

/** ' (did you mean "tiers"?)' when `input` is a near miss for one of `candidates`, else ''. */
export function didYouMean(input: string, candidates: readonly string[]): string {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const c of candidates) {
    const d = distance(input.toLowerCase(), c.toLowerCase());
    if (d < bestDistance) [best, bestDistance] = [c, d];
  }
  return best !== undefined && bestDistance <= Math.max(2, Math.floor(best.length / 3)) ? ` (did you mean "${best}"?)` : '';
}

// ---------------------------------------------------------------- leaves

export function str(options: { pattern?: RegExp; expected?: string } = {}): Schema<string> {
  return {
    check(value, path, issues) {
      if (typeof value !== 'string' || value.trim() === '') {
        issues.push({ path, message: `expected ${options.expected ?? 'a non-empty string'}, got ${describe(value)}` });
        return false;
      }
      if (options.pattern && !options.pattern.test(value)) {
        issues.push({ path, message: `expected ${options.expected ?? `text matching ${options.pattern}`}, got ${describe(value)}` });
        return false;
      }
      return true;
    },
  };
}

/** A short identifier that other parts of the file refer to: no spaces, so it is safe in a key or a URL. */
export function id(): Schema<string> {
  return str({ pattern: /^[A-Za-z0-9][A-Za-z0-9_.-]*$/, expected: 'an id (letters, digits, "_", "-" or "."; no spaces)' });
}

export function num(options: { min?: number; above?: number; max?: number; integer?: boolean } = {}): Schema<number> {
  const base = options.integer ? 'a whole number' : 'a number';
  let expected = base;
  if (options.above !== undefined && options.max !== undefined) expected = `${base} above ${options.above} and up to ${options.max}`;
  else if (options.above !== undefined) expected = `${base} above ${options.above}`;
  else if (options.min !== undefined && options.max !== undefined) expected = `${base} from ${options.min} to ${options.max}`;
  else if (options.min !== undefined) expected = `${base} of at least ${options.min}`;
  else if (options.max !== undefined) expected = `${base} of at most ${options.max}`;
  return {
    check(value, path, issues) {
      const ok =
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (!options.integer || Number.isInteger(value)) &&
        (options.min === undefined || value >= options.min) &&
        (options.above === undefined || value > options.above) &&
        (options.max === undefined || value <= options.max);
      if (!ok) issues.push({ path, message: `expected ${expected}, got ${describe(value)}` });
      return ok;
    },
  };
}

export function bool(): Schema<boolean> {
  return {
    check(value, path, issues) {
      if (typeof value === 'boolean') return true;
      issues.push({ path, message: `expected true or false, got ${describe(value)}` });
      return false;
    },
  };
}

/** A calendar date, 'YYYY-MM-DD'. */
export function date(): Schema<string> {
  return {
    check(value, path, issues) {
      const ok = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value + 'T00:00:00Z').toISOString().startsWith(value);
      if (!ok) issues.push({ path, message: `expected a date as YYYY-MM-DD, got ${describe(value)}` });
      return ok;
    },
  };
}

export function oneOf<const T extends readonly (string | number)[]>(values: T): Schema<T[number]> {
  return {
    check(value, path, issues) {
      if (values.includes(value as T[number])) return true;
      const hint = typeof value === 'string' ? didYouMean(value, values.map(String)) : '';
      issues.push({ path, message: `expected one of ${values.map((v) => JSON.stringify(v)).join(', ')}, got ${describe(value)}${hint}` });
      return false;
    },
  };
}

// ---------------------------------------------------------------- wrappers

export function opt<T>(inner: Schema<T>): OptionalSchema<T> {
  return {
    optional: true,
    check: (value, path, issues) => value === undefined || inner.check(value, path, issues),
  };
}

export function nullable<T>(inner: Schema<T>): Schema<T | null> {
  return { check: (value, path, issues) => value === null || inner.check(value, path, issues) };
}

/**
 * Adds a rule that needs the whole value. It runs only when `inner` found nothing wrong, so the rule
 * can rely on the shape, and it reports through `issues` like everything else.
 */
export function refine<T>(inner: Schema<T>, rule: (value: T, path: string, issues: Issue[]) => void): Schema<T> {
  return {
    check(value, path, issues) {
      if (!inner.check(value, path, issues)) return false;
      const before = issues.length;
      rule(value as T, path, issues);
      return issues.length === before;
    },
  };
}

// ---------------------------------------------------------------- containers

/** Joins a parent path and a child key: 'a' + 'b' -> 'a.b'; '' + 'b' -> 'b'. */
export const join = (path: string, key: string): string => (path === '' ? key : `${path}.${key}`);

/** `uniqueBy` names a field that must differ between objects in the list. `unique` makes plain entries differ. */
export function arr<T>(item: Schema<T>, options: { min?: number; uniqueBy?: string; unique?: boolean } = {}): Schema<T[]> {
  return {
    check(value, path, issues) {
      if (!Array.isArray(value)) {
        issues.push({ path, message: `expected a list, got ${describe(value)}` });
        return false;
      }
      let ok = true;
      if (options.min !== undefined && value.length < options.min) {
        issues.push({ path, message: `expected at least ${options.min} ${options.min === 1 ? 'entry' : 'entries'}, got ${value.length}` });
        ok = false;
      }
      value.forEach((entry, i) => {
        if (!item.check(entry, `${path}[${i}]`, issues)) ok = false;
      });
      if (ok && options.uniqueBy) {
        const key = options.uniqueBy;
        const seen = new Map<unknown, number>();
        value.forEach((entry, i) => {
          const k = (entry as Record<string, unknown>)[key];
          const first = seen.get(k);
          if (first === undefined) seen.set(k, i);
          else {
            issues.push({ path: `${path}[${i}].${key}`, message: `duplicate ${key} ${describe(k)}, already used at ${path}[${first}].${key}` });
            ok = false;
          }
        });
      }
      if (ok && options.unique) {
        const seen = new Map<unknown, number>();
        value.forEach((entry, i) => {
          const first = seen.get(entry);
          if (first === undefined) seen.set(entry, i);
          else {
            issues.push({ path: `${path}[${i}]`, message: `duplicate entry ${describe(entry)}, already listed at ${path}[${first}]` });
            ok = false;
          }
        });
      }
      return ok;
    },
  };
}

export function obj<S extends Shape>(shape: S): Schema<InferShape<S>> {
  const keys = Object.keys(shape);
  return {
    check(value, path, issues) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        issues.push({ path, message: `expected an object, got ${describe(value)}` });
        return false;
      }
      const record = value as Record<string, unknown>;
      let ok = true;
      for (const key of keys) {
        const child = shape[key]!;
        if (record[key] === undefined) {
          if (!(child as Partial<OptionalSchema<unknown>>).optional) {
            issues.push({ path: join(path, key), message: 'required, but missing' });
            ok = false;
          }
          continue;
        }
        if (!child.check(record[key], join(path, key), issues)) ok = false;
      }
      for (const key of Object.keys(record)) {
        if (!keys.includes(key)) {
          issues.push({ path: join(path, key), message: `unknown field${didYouMean(key, keys)}` });
          ok = false;
        }
      }
      return ok;
    },
  };
}
