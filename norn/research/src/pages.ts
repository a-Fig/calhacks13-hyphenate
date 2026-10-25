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

import { DEFAULT_TOKEN_ENV } from './job.ts';
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

export interface PlainFetcherOptions {
  fetchImpl?: typeof fetch;
  today: string;
  timeoutMs?: number;
  /** Pages larger than this are cut (the quote is a sentence; a book is not needed). Default 2,000,000 characters. */
  maxChars?: number;
  /** The public-address check; default the runner's, the one WebFetch is held to. */
  check?: (url: string) => Promise<{ allowed: boolean; reason: string }>;
  /** Redirects followed, each checked again. Default 3. */
  maxRedirects?: number;
}

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
 * The first reader of a page for quote verification: a plain HTTPS GET with a timeout, only after the same public-address
 * check WebFetch is held to (each redirect again). It stands for "the page as a person with a browser would get it". Failure,
 * an HTTP error or a block, an empty page or a block page come back as not ok, with why.
 */
export function plainFetcher(opts: PlainFetcherOptions): PageFetcher {
  const doFetch = opts.fetchImpl ?? fetch;
  const maxChars = opts.maxChars ?? 2_000_000;
  const maxRedirects = opts.maxRedirects ?? 3;
  const check = opts.check ?? (async (u: string) => (await import('../../runner/src/fetch-guard.ts')).checkFetchUrl(u));
  return async (url: string): Promise<PageResult> => {
    try {
      let current = url;
      for (let hop = 0; hop <= maxRedirects; hop++) {
        if (!/^https:\/\//i.test(current)) return { ok: false, error: 'only https pages are fetched directly' };
        const verdict = await check(current);
        if (!verdict.allowed) return { ok: false, error: `not fetched directly: ${verdict.reason}` };
        const res = await doFetch(current, {
          method: 'GET',
          redirect: 'manual',
          headers: { accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5', 'user-agent': 'Mozilla/5.0 (compatible; NornResearch/1.0)' },
          signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
        });
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get('location');
          if (!loc) return { ok: false, error: `HTTP ${res.status} without a location` };
          current = new URL(loc, current).toString();
          continue;
        }
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        const type = res.headers.get('content-type') ?? '';
        if (type && !/text\/|html|xml|json/i.test(type)) return { ok: false, error: `content type ${type.slice(0, 60)} is not text` };
        const raw = (await res.text()).slice(0, maxChars);
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
    const b = await fallback(url);
    if (b.ok && b.text !== undefined) return b;
    return { ok: false, error: `plain fetch: ${a.error ?? 'no text'}; Bright Data: ${b.error ?? 'no text'}` };
  };
}
