import { promises as dns } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';

/**
 * WebFetch is how a research agent uses the web like a person would. Claude Code itself refuses
 * only `localhost` and names without a dot, so on a server inside a private network the tool
 * could still reach a LAN host, a Tailscale peer or a cloud metadata address. This guard runs
 * before each WebFetch call, resolves the host, and denies the call when any address it resolves
 * to is not on the public internet.
 *
 * Limit: the check and Claude Code's own fetch each resolve the name, so a name whose answer
 * changes between the two (DNS rebinding) can still get through. Network rules on the server are
 * the second layer that closes that.
 */

const blocked = new BlockList();
const V4: [string, number][] = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT, which is where Tailscale addresses live
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, and the broadcast address
];
for (const [net, prefix] of V4) blocked.addSubnet(net, prefix, 'ipv4');
const V6: [string, number][] = [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['fc00::', 7], // unique local, which includes Tailscale's fd7a:115c:a1e0::/48
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
  ['2001:db8::', 32], // documentation
  ['2001::', 32], // Teredo tunnelling
  ['100::', 64], // discard-only
];
for (const [net, prefix] of V6) blocked.addSubnet(net, prefix, 'ipv6');

/** Dotted quad for the IPv4 address embedded in an IPv6 form, or null. */
function embeddedV4(ip: string): string | null {
  const lower = ip.toLowerCase();
  // ::ffff:a.b.c.d and ::ffff:aabb:ccdd (IPv4-mapped), 64:ff9b::/96 (NAT64), 2002::/16 (6to4)
  const dotted = lower.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1]!;
  const hex = lower.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) return hexPairToV4(hex[1]!, hex[2]!);
  const sixToFour = lower.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/);
  if (sixToFour) return hexPairToV4(sixToFour[1]!, sixToFour[2]!);
  return null;
}
function hexPairToV4(a: string, b: string): string {
  const hi = parseInt(a, 16);
  const lo = parseInt(b, 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** True for an address that is not a public internet address. Anything unparseable counts as non-public. */
export function isNonPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return blocked.check(ip, 'ipv4');
  if (kind === 6) {
    const v4 = embeddedV4(ip);
    if (v4 && isIP(v4) === 4 && blocked.check(v4, 'ipv4')) return true;
    return blocked.check(ip, 'ipv6');
  }
  return true;
}

/** Names that are local by convention; refused without asking DNS. */
function isLocalName(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return (
    !h.includes('.') ||
    h === 'localhost' ||
    /\.(localhost|local|localdomain|internal|lan|home|home\.arpa|intranet|corp|private)$/.test(h) ||
    /\.ts\.net$/.test(h) // Tailscale MagicDNS names
  );
}

export type Resolver = (host: string) => Promise<string[]>;

const defaultResolver: Resolver = async (host) => {
  const answers = await dns.lookup(host, { all: true, verbatim: true });
  return answers.map((a) => a.address);
};

export interface FetchVerdict {
  allowed: boolean;
  reason: string;
}

/** An allowed fetch target: the address that was checked, which a caller that connects itself must connect to. */
export type PublicTarget = { allowed: true; reason: string; host: string; address: string; family: 4 | 6 } | { allowed: false; reason: string };

/**
 * Decides whether `rawUrl` may be fetched and, when it may, says which address was checked, so a caller that opens the
 * connection itself can connect to exactly that address (a name looked up a second time can answer differently:
 * DNS rebinding). Resolves once. Fails closed.
 */
export async function resolvePublicTarget(rawUrl: unknown, resolve: Resolver = defaultResolver): Promise<PublicTarget> {
  const deny = (reason: string): PublicTarget => ({ allowed: false, reason });
  if (typeof rawUrl !== 'string') return deny('WebFetch call has no url');
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return deny('the url does not parse');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return deny(`scheme ${url.protocol} is not fetched`);
  if (url.username || url.password) return deny('urls with credentials are not fetched');
  // The URL parser has already turned 2130706433, 0x7f.1 and 0177.0.0.1 into 127.0.0.1.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    return isNonPublicAddress(host) ? deny(`${host} is not a public internet address`) : { allowed: true, reason: 'public address', host, address: host, family: isIP(host) === 6 ? 6 : 4 };
  }
  if (isLocalName(host)) return deny(`${host} is a local name`);
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return deny(`${host} could not be resolved, so it could not be checked`);
  }
  if (addresses.length === 0) return deny(`${host} resolved to no address`);
  const bad = addresses.find(isNonPublicAddress);
  if (bad) return deny(`${host} resolves to ${bad}, which is not a public internet address`);
  // Every answer is public; connect to the first.
  const first = addresses[0]!;
  return { allowed: true, reason: 'resolves to public addresses only', host, address: first, family: isIP(first) === 6 ? 6 : 4 };
}

/** Decides whether WebFetch may fetch `rawUrl`. Fails closed. */
export async function checkFetchUrl(rawUrl: unknown, resolve: Resolver = defaultResolver): Promise<FetchVerdict> {
  const t = await resolvePublicTarget(rawUrl, resolve);
  return { allowed: t.allowed, reason: t.reason };
}

/**
 * A PreToolUse hook for WebFetch. `onDeny` lets the runner put the denial in the action log:
 * hook denials do not appear in the SDK's own permission-denial reports.
 */
export function webFetchGuard(
  onDeny: (toolUseId: string | undefined, reason: string) => void,
  resolve: Resolver = defaultResolver,
): HookCallback {
  return async (input, toolUseId) => {
    if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'WebFetch') return {};
    let verdict: FetchVerdict;
    try {
      verdict = await checkFetchUrl((input.tool_input as { url?: unknown } | null)?.url, resolve);
    } catch (err) {
      verdict = { allowed: false, reason: `the address check failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (verdict.allowed) return {};
    const reason = `WebFetch refused by Norn: ${verdict.reason}`;
    onDeny(toolUseId, reason);
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
  };
}
