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
    return p ? { ok: true, text: p.text, retrievedAt: p.retrievedAt } : { ok: false, error: 'not in the recording' };
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
      return { ok: true, text: await res.text(), retrievedAt: opts.today };
    } catch (e) {
      // The message of a fetch failure can carry a URL but never the header; keep it short anyway.
      return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : 'request failed' };
    }
  };
}
