// Avatars as data URIs, so Primer's <Avatar> has an image to show. People get initials on a
// colour from GitHub's palette, Norn the dark mark GitHub gives bots, agents a small robot.
const COLORS = ['#0969da', '#8250df', '#bf3989', '#1a7f37', '#bc4c00', '#0550ae', '#6639ba', '#953800', '#116329', '#0a3069'];

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const svg = (body: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`)}`;

export type AvatarKind = 'person' | 'norn' | 'agent' | 'team';

export function avatarSrc(name: string, kind: AvatarKind = 'person'): string {
  if (kind === 'norn') {
    return '/norn-mark.svg';
  }
  if (kind === 'team') {
    return svg('<rect width="64" height="64" fill="#d1d9e0"/><g fill="none" stroke="#59636e" stroke-width="4" stroke-linecap="round"><circle cx="25" cy="25" r="7"/><circle cx="43" cy="27" r="6"/><path d="M12 47c1-8 6-12 13-12s12 4 13 12M38 36c7-1 12 3 14 11"/></g>');
  }
  const base = name.replace(/['’]s agent$/, '');
  const color = COLORS[hash(base) % COLORS.length];
  if (kind === 'agent') {
    return svg(`<rect width="64" height="64" fill="${color}"/><g fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><rect x="16" y="24" width="32" height="24" rx="7"/><path d="M32 24v-8M25 35v2M39 35v2"/></g>`);
  }
  const initials = base.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return svg(`<rect width="64" height="64" fill="${color}"/><text x="32" y="42" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="26" font-weight="600" fill="#fff">${initials}</text>`);
}
