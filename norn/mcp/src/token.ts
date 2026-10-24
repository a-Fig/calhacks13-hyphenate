// Bearer credentials for Norn's MCP server: a signed claim set, HMAC-SHA256, no external service.
//
//   nmt1.<base64url(claims JSON)>.<base64url(HMAC-SHA256(key, "nmt1." + payload))>
//
// The server believes nothing about an agent except what a verified token says. The key lives only
// in NORN_MCP_SIGNING_KEY (env.ts); whoever holds it can mint any identity, so it stays out of the
// agents' reach (the runner's environment allowlist already keeps it out of their processes).
import { createHmac, timingSafeEqual } from 'node:crypto';

export const TOKEN_PREFIX = 'nmt1';

/** A job token is minted per runner job; a person_agent token is for someone's own agent (M5). */
export type TokenKind = 'job' | 'person_agent';

export interface Claims {
  v: 1;
  kind: TokenKind;
  /** The runner job id, or for a person's agent an id for the credential. Names the scope grant. */
  jobId: string;
  /** What the agent is for (`level1-writeup`, ...), or `person-agent`. */
  role: string;
  /** The principal's name in Norn, e.g. `agent:norn/level1/BWM-ECR-0417`. */
  actor: string;
  /** The person it acts for. Required for person_agent; null when Norn acts on its own. */
  onBehalfOf: string | null;
  /** What started it: `norn`, a parent job id, or for a person's agent the person. */
  spawnedBy: string;
  /** PLM numbers of the ECRs it may write to. `['*']` means any ECR (person_agent only). */
  ecrs: string[];
  /** Issued at and expiry, in whole seconds since the Unix epoch. */
  iat: number;
  exp: number;
}

export type NewClaims = Omit<Claims, 'v' | 'iat' | 'exp'>;

/** Longest a token may live. A job token should cover about one job; a person's, a working week or so. */
export const MAX_TTL_SECONDS: Record<TokenKind, number> = { job: 6 * 3600, person_agent: 30 * 86400 };

export type TokenErrorCode = 'malformed' | 'bad_signature' | 'expired' | 'not_yet_valid' | 'invalid_claims';

/** Thrown for any credential problem. The message is safe to send to the caller (it never contains the token). */
export class TokenError extends Error {
  constructor(
    readonly code: TokenErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'TokenError';
  }
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
// Names (actor, job id, role, person, ECR number): up to 64 of these characters, nothing else. The module caps names at 64.
const NAME = /^[A-Za-z0-9:_./@+-]{1,64}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
const B64URL_SIG = /^[A-Za-z0-9_-]{43}$/; // 32 bytes, no padding
const CLAIM_FIELDS = new Set(['v', 'kind', 'jobId', 'role', 'actor', 'onBehalfOf', 'spawnedBy', 'ecrs', 'iat', 'exp']);

function sign(key: string, signingInput: string): Buffer {
  return createHmac('sha256', key).update(signingInput).digest();
}

function requireKey(key: string | undefined): string {
  if (!key || key.length < 32) throw new TokenError('invalid_claims', 'the signing key is missing or shorter than 32 characters');
  return key;
}

/** Checks the shape of a claim set. Throws TokenError('invalid_claims'). Returns the typed claims. */
export function parseClaims(raw: unknown): Claims {
  const bad = (why: string): never => {
    throw new TokenError('invalid_claims', `the token's claims are invalid: ${why}`);
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('not an object');
  const c = raw as Record<string, unknown>;
  for (const k of Object.keys(c)) if (!CLAIM_FIELDS.has(k)) bad(`unknown field '${k.slice(0, 20)}'`);
  if (c.v !== 1) bad('unknown version');
  if (c.kind !== 'job' && c.kind !== 'person_agent') bad('kind must be job or person_agent');
  for (const f of ['jobId', 'role', 'actor', 'spawnedBy'] as const) {
    if (typeof c[f] !== 'string' || !NAME.test(c[f] as string)) bad(`${f} must be 1 to 64 letters, digits or : _ . / @ + -`);
  }
  if (c.onBehalfOf !== null && (typeof c.onBehalfOf !== 'string' || !NAME.test(c.onBehalfOf))) bad('onBehalfOf must be a name or null');
  if (c.kind === 'person_agent' && c.onBehalfOf === null) bad('a person_agent token must name the person it acts for');
  if (!Array.isArray(c.ecrs) || c.ecrs.length > 50 || c.ecrs.some(e => typeof e !== 'string' || (e !== '*' && !NAME.test(e)))) bad('ecrs must be a list of at most 50 ECR numbers');
  const ecrs = c.ecrs as string[];
  if (ecrs.includes('*') && (c.kind !== 'person_agent' || ecrs.length !== 1)) bad("'*' (any ECR) is only for a person_agent token, and only on its own");
  if (!Number.isInteger(c.iat) || !Number.isInteger(c.exp)) bad('iat and exp must be whole seconds');
  const iat = c.iat as number;
  const exp = c.exp as number;
  if (exp <= iat) bad('exp must be after iat');
  if (exp - iat > MAX_TTL_SECONDS[c.kind as TokenKind]) bad(`a ${c.kind} token may live at most ${MAX_TTL_SECONDS[c.kind as TokenKind]} seconds`);
  return {
    v: 1,
    kind: c.kind as TokenKind,
    jobId: c.jobId as string,
    role: c.role as string,
    actor: c.actor as string,
    onBehalfOf: c.onBehalfOf as string | null,
    spawnedBy: c.spawnedBy as string,
    ecrs: [...new Set(ecrs)],
    iat,
    exp,
  };
}

/** Mint a token. `ttlSeconds` is clamped by validation: asking for more than the kind allows throws. */
export function signToken(claims: NewClaims & { ttlSeconds: number }, key: string | undefined, nowMs = Date.now()): string {
  const k = requireKey(key);
  const { ttlSeconds, ...rest } = claims;
  const iat = Math.floor(nowMs / 1000);
  const full = parseClaims({ v: 1, ...rest, iat, exp: iat + Math.floor(ttlSeconds) });
  const payload = `${TOKEN_PREFIX}.${b64(JSON.stringify(full))}`;
  return `${payload}.${b64(sign(k, payload))}`;
}

/** Verify signature, shape and time window. Throws TokenError. */
export function verifyToken(token: string, key: string | undefined, nowMs = Date.now()): Claims {
  const k = requireKey(key);
  const parts = token.split('.');
  // Strict shape first: base64url without padding or stray characters, so there is exactly one
  // string for a given signature and a lenient decoder cannot make an edited token verify.
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX || !B64URL.test(parts[1] ?? '') || !B64URL_SIG.test(parts[2] ?? '')) throw new TokenError('malformed', 'not a Norn token');
  const given = Buffer.from(parts[2]!);
  const want = Buffer.from(b64(sign(k, `${parts[0]}.${parts[1]}`)));
  if (given.length !== want.length || !timingSafeEqual(given, want)) throw new TokenError('bad_signature', 'the token was not signed with this server\'s key');
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new TokenError('malformed', 'the token payload is not JSON');
  }
  const claims = parseClaims(raw);
  const now = Math.floor(nowMs / 1000);
  if (claims.exp <= now) throw new TokenError('expired', 'the token has expired');
  if (claims.iat > now + 60) throw new TokenError('not_yet_valid', 'the token was issued in the future');
  return claims;
}
