// Avatars as data URIs, so Primer's <Avatar> has an image to show. People get initials on an
// engineering palette, Norn its aerospace compass-delta mark, agents a small robot, and the CCB
// a board table.
const COLORS = ['#0b6bcb', '#0d9488', '#3b5bdb', '#1a7f37', '#b45309', '#0e7490', '#6d28d9', '#9a3412', '#15803d', '#1e3a8a'];

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const svg = (body: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`)}`;

export type AvatarKind = 'person' | 'norn' | 'agent' | 'team';

export function avatarSrc(name: string, kind: AvatarKind = 'person'): string {
  if (kind === 'norn') {
    return svg(
      '<rect width="64" height="64" rx="12" fill="#0c2338"/>' +
      '<path d="M32 13 49 48h-6.5L32 26 21.5 48H15L32 13Z" fill="#f0fdfa"/>' +
      '<path d="M19 38a17 17 0 0 0 26 0" fill="none" stroke="#2dd4bf" stroke-width="4" stroke-linecap="round"/>' +
      '<circle cx="32" cy="14" r="3.6" fill="#2dd4bf"/>'
    );
  }
  if (kind === 'team') {
    // CCB board table with seats around it
    return svg(
      '<rect width="64" height="64" rx="12" fill="#e2e8f0"/>' +
      '<rect x="15" y="21" width="34" height="22" rx="6" fill="#fff" stroke="#334155" stroke-width="3.5"/>' +
      '<path d="M22 14h6M36 14h6M22 50h6M36 50h6M9 28v8M55 28v8" fill="none" stroke="#334155" stroke-width="3.8" stroke-linecap="round"/>'
    );
  }
  const base = name.replace(/['\u2019]s agent$/, '');
  const color = COLORS[hash(base) % COLORS.length];
  if (kind === 'agent') {
    return svg(`<rect width="64" height="64" fill="${color}"/><g fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><rect x="16" y="24" width="32" height="24" rx="7"/><path d="M32 24v-8M25 35v2M39 35v2"/></g>`);
  }
  const initials = base.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return svg(`<rect width="64" height="64" fill="${color}"/><text x="32" y="42" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="26" font-weight="600" fill="#fff">${initials}</text>`);
}