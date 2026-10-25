// Page fetchers for quote verification.
//
// recordedFetcher: serves pages from a recording; used by tests and --replay. No network.
// brightDataFetcher: the live one. It asks Bright Data's Web Unlocker for the page as markdown with
// the same request the MCP server's scrape_as_markdown tool makes (brightdata-mcp server.js,
// tool 'scrape_as_markdown': POST https://api.brightdata.com/request with
// {url, zone: WEB_UNLOCKER_ZONE || 'mcp_unlocker', format: 'raw', data_format: 'markdown'} and
// 'authorization: Bearer <API_TOKEN>'), so the check reads the page itself rather than trusting
// the agent's report of it. Not run from this environment (no token, no route): see NOTES.md.
// The token is read from the environment by name and is never printed.

import https from 'node:https';
import { isIP } from 'node:net';
import { resolvePublicTarget, type Resolver } from '../../runner/src/fetch-guard.ts';
import { DEFAULT_TOKEN_ENV } from './job.ts';
import { findUrlLeaks, type Identifier } from './leak.ts';
import type { PageFetcher, PageResult } from './types.ts';

export interface RecordedPage {
  url: string;
  retrievedAt: string;
  /** Who fetched it and how, in words. Shown in the replay's output. */
  fetchedBy: string;
  /** True when `text` is an excerpt (the fragments the fetcher returned), not the whole page. */
  excerpt: boolean;
  text: string;
}

export function recordedFetcher(pages: RecordedPage[]): PageFetcher {
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  return async (url: string): Promise<PageResult> => {
    const p = byUrl.get(url);
    return p ? { ok: true, text: p.text, retrievedAt: p.retrievedAt, via: 'recorded' as const } : { ok: false, error: 'not in the recording' };
  };
}

export interface BrightDataFetcherOptions {
  env?: Record<string, string | undefined>;
  tokenEnv?: string;
  fetchImpl?: typeof fetch;
  /** The date to stamp on a page, from the caller's clock (the fetcher keeps no clock of its own). */
  today: string;
  timeoutMs?: number;
}

export function brightDataFetcher(opts: BrightDataFetcherOptions): PageFetcher {
  const env = opts.env ?? process.env;
  const tokenEnv = opts.tokenEnv ?? DEFAULT_TOKEN_ENV;
  const doFetch = opts.fetchImpl ?? fetch;
  return async (url: string): Promise<PageResult> => {
    const token = env[tokenEnv];
    if (!token) return { ok: false, error: `${tokenEnv} is not set` };
    try {
      const res = await doFetch('https://api.brightdata.com/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ url, zone: env.WEB_UNLOCKER_ZONE || 'mcp_unlocker', format: 'raw', data_format: 'markdown' }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
      });
      if (!res.ok) return { ok: false, error: `Bright Data answered HTTP ${res.status}` };
      return { ok: true, text: await res.text(), retrievedAt: opts.today, via: 'brightdata' };
    } catch (e) {
      // The message of a fetch failure can carry a URL but never the header; keep it short anyway.
      return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : 'request failed' };
    }
  };
}

// ---------------------------------------------------------------------------------------------
// Web first, Bright Data as the fallback.

export interface PlainResponse {
  status: number;
  /** Lower-case header names. */
  headers: Record<string, string | undefined>;
  body: string;
}
/** What the transport is told to do: connect to `address` (already checked) and ask `url.host` for `url.pathname + url.search`. */
export interface PlainRequest {
  url: URL;
  address: string;
  family: 4 | 6;
  headers: Record<string, string>;
  timeoutMs: number;
  maxChars: number;
}
export type PlainTransport = (req: PlainRequest) => Promise<PlainResponse>;

export interface PlainFetcherOptions {
  today: string;
  timeoutMs?: number;
  /** Pages larger than this are cut (the quote is a sentence; a book is not needed). Default 2,000,000 characters. */
  maxChars?: number;
  /** Resolves a host name; default the system's. The one answer is what the connection is pinned to. */
  resolve?: Resolver;
  /** Opens the connection and reads the response. Default: node:https with the lookup pinned to the checked address. */
  transport?: PlainTransport;
  /** Redirects followed, each checked again. Default 3. */
  maxRedirects?: number;
  /**
   * Said of every address before the name is looked up or anything is sent, the first one and each redirect's `Location`:
   * the reason it carries an identifier from the company's data, or null. A refusal comes back as `refused`, which the
   * guardrails turn into a rejection and which is never retried through Bright Data.
   */
  leakCheck?: (url: string) => string | null;
}

/** A `leakCheck` from the company's identifiers: the address as written and decoded (percent-escapes, `+`), host, path and query. */
export function urlLeakCheck(identifiers: Identifier[], allowTerms?: readonly string[]): (url: string) => string | null {
  return (url) => {
    const leaks = findUrlLeaks(url, identifiers, allowTerms);
    return leaks.length ? `contains an identifier from the company's data (${[...new Set(leaks.map((l) => l.kind))].join(', ')})` : null;
  };
}

/**
 * A `lookup` for node:https that answers with one address and nothing else. The address was checked by `resolvePublicTarget`;
 * a second name lookup by the socket could answer differently (DNS rebinding), so the connection is pinned to the one checked.
 * TLS still verifies the certificate against the host name, because `servername` and `Host` stay the name.
 */
export function pinnedLookup(address: string, family: 4 | 6) {
  return (_host: string, optionsOrCb: unknown, maybeCb?: unknown): void => {
    const cb = (typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb) as (err: Error | null, a: string | { address: string; family: number }[], f?: number) => void;
    const options = (typeof optionsOrCb === 'function' ? {} : optionsOrCb) as { all?: boolean };
    if (options?.all) cb(null, [{ address, family }]);
    else cb(null, address, family);
  };
}

function lowerHeaders(h: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(', ') : v]));
}

/** The default transport: an https request to the checked address, the host name on the certificate check, a hard time limit. */
export const httpsTransport: PlainTransport = (req) =>
  new Promise((resolve, reject) => {
    const host = req.url.hostname.replace(/^\[|\]$/g, '');
    let done = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (f: () => void) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        f();
      }
    };
    const r = https.request(
      {
        host,
        port: req.url.port || 443,
        path: `${req.url.pathname}${req.url.search}`,
        method: 'GET',
        headers: { ...req.headers, host: req.url.host },
        ...(isIP(host) ? {} : { servername: host }),
        lookup: pinnedLookup(req.address, req.family) as never,
      },
      (res) => {
        res.setEncoding('utf8');
        let body = '';
        res.on('data', (chunk: string) => {
          body += chunk;
          if (body.length > req.maxChars) {
            body = body.slice(0, req.maxChars);
            res.destroy();
            finish(() => resolve({ status: res.statusCode ?? 0, headers: lowerHeaders(res.headers), body }));
          }
        });
        res.on('end', () => finish(() => resolve({ status: res.statusCode ?? 0, headers: lowerHeaders(res.headers), body })));
        res.on('error', (e) => finish(() => reject(e)));
      },
    );
    timer = setTimeout(() => r.destroy(new Error(`timed out after ${req.timeoutMs} ms`)), req.timeoutMs);
    r.on('error', (e) => finish(() => reject(e)));
    r.end();
  });

/** Text of an HTML page: scripts, styles and tags out, the common entities decoded, whitespace folded. */
export function htmlToText(html: string): string {
  const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"' };
  return html
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|br|table|section|article)\s*>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' ';
      }
      return ENT[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Signs that a page is a wall and not the page: a bot check, a captcha, a request to switch on JavaScript. */
const BLOCKED = /\b(captcha|are you a robot|verify you are (a )?human|access denied|just a moment|enable javascript|attention required|unusual traffic|request blocked|checking your browser)\b/i;
const MIN_USABLE = 200;

/** Whether the text of a response is empty or a block page, and so worth a second try through Bright Data. */
export function looksBlockedOrEmpty(text: string): string | null {
  if (text.trim().length < MIN_USABLE) return `the page text is empty or very short (${text.trim().length} characters)`;
  // A real page that mentions "captcha" once is fine; a wall is short and says it.
  if (text.length < 5000 && BLOCKED.test(text)) return 'the page looks like a bot check or a block page';
  return null;
}

/**
 * The first reader of a page for quote verification: a plain HTTPS GET with a timeout. Every address (the first and each
 * redirect's `Location`) goes through the identifier check, then is resolved once and checked to be public, and the
 * connection is pinned to the address that was checked. Failure, an HTTP error or a block, an empty page or a block page
 * come back as not ok, with why; an address that carries an identifier comes back `refused`.
 */
export function plainFetcher(opts: PlainFetcherOptions): PageFetcher {
  const transport = opts.transport ?? httpsTransport;
  const maxChars = opts.maxChars ?? 2_000_000;
  const maxRedirects = opts.maxRedirects ?? 3;
  return async (url: string): Promise<PageResult> => {
    try {
      let current = url;
      for (let hop = 0; hop <= maxRedirects; hop++) {
        // Before anything is looked up or sent: the name server and the site learn what is being asked for.
        const leak = opts.leakCheck?.(current);
        if (leak) return { ok: false, error: `not fetched: the address ${leak}`, refused: leak };
        if (!/^https:\/\//i.test(current)) return { ok: false, error: 'only https pages are fetched directly' };
        const target = await resolvePublicTarget(current, opts.resolve);
        if (!target.allowed) return { ok: false, error: `not fetched directly: ${target.reason}` };
        const res = await transport({
          url: new URL(current),
          address: target.address,
          family: target.family,
          headers: { accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5', 'user-agent': 'Mozilla/5.0 (compatible; NornResearch/1.0)' },
          timeoutMs: opts.timeoutMs ?? 20_000,
          maxChars,
        });
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.location;
          if (!loc) return { ok: false, error: `HTTP ${res.status} without a location` };
          current = new URL(loc, current).toString();
          continue;
        }
        if (res.status < 200 || res.status >= 300) return { ok: false, error: `HTTP ${res.status}` };
        const type = res.headers['content-type'] ?? '';
        if (type && !/text\/|html|xml|json/i.test(type)) return { ok: false, error: `content type ${type.slice(0, 60)} is not text` };
        const raw = res.body.slice(0, maxChars);
        const text = /html|xml/i.test(type) || /^\s*<(!doctype|html)/i.test(raw) ? htmlToText(raw) : raw;
        const why = looksBlockedOrEmpty(text);
        return why ? { ok: false, error: why } : { ok: true, text, retrievedAt: opts.today, via: 'fetch' };
      }
      return { ok: false, error: 'too many redirects' };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : 'request failed' };
    }
  };
}

/**
 * Normal web first, Bright Data only when that fails: the plain fetch, and when it does not give a usable page the
 * Bright Data scrape. The result says which one read the page (`via`). A failure of both names both reasons.
 */
export function webFirstFetcher(first: PageFetcher, fallback: PageFetcher): PageFetcher {
  return async (url: string): Promise<PageResult> => {
    const a = await first(url);
    if (a.ok && a.text !== undefined) return a;
    if (a.refused) return a; // an address that carries an identifier is not tried again through Bright Data
    const b = await fallback(url);
    if (b.ok && b.text !== undefined) return b;
    return { ok: false, error: `plain fetch: ${a.error ?? 'no text'}; Bright Data: ${b.error ?? 'no text'}` };
  };
}
