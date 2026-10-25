// The leak check: a search query may not carry anything that identifies the company, its parts,
// suppliers, people, programs or change records. Web search goes to a third party, and Bowman's
// facts are not on the web anyway (the agent researches the world, not the company).
//
// Pure and deterministic. Text is first folded: zero-width, soft-hyphen and bidi characters are
// removed, NFKC applied, accents stripped, case and punctuation dropped. Then two matches run:
//   - whole words, so 'bw-5120-210' and 'BW 5120 210' hit the item code, and 'shaldenx' does not
//     hit Halden;
//   - compact forms, with every separator and space removed, for part numbers, record ids and
//     multi-word names, so '5120210', 'BW5120210' and 'JeffHargrove' hit too. A digit at the edge
//     of such a match must be the edge of a number in the text (15120210 is not part 5120-210).
// The check errs towards rejecting: a distinctive first word of a supplier or a surname also
// counts. A word that is also an ordinary term (cobalt, the metal) goes in `allow`. Not covered:
// look-alike letters from another script (a Cyrillic "a" in "Halden").

import { domainToUnicode } from 'node:url';
import { compactForm, stripInvisible, wordForm, stemForm } from './text.ts';

/** The parts of a company dataset the leak check reads. Bowman's dataset satisfies it as is. */
export interface IdentifierSource {
  company?: { name?: string; short?: string };
  items?: { code: string }[];
  suppliers?: { id: string; name: string }[];
  people?: { id?: string; name: string; email?: string }[];
  programs?: { id: string; name: string }[];
  ecrs?: { id: string; originatingNcr?: string; supplierQuotes?: { id: string }[] }[];
  ncrs?: { id: string }[];
  history?: { id: string; ecr?: string }[];
}

export interface Identifier {
  text: string;
  kind: 'company' | 'item' | 'supplier' | 'person' | 'program' | 'record';
}

export interface Leak {
  identifier: string;
  kind: Identifier['kind'];
  query: string;
}

/** Record ids look like BW-5120-210, ECR-0417, SUP-HALDEN, Q-HAL-26-1187: a prefix, a dash and something with a digit. */
const RECORD_ID = /\b(?:BW|ECR|ECO|NCR|SUP|EMP|CCB|PO|Q)-[A-Z0-9-]*\d[A-Z0-9-]*/i;

/** Words that are ordinary English or ordinary materials even though a supplier's name starts with them. */
export const DEFAULT_ALLOW: readonly string[] = ['cobalt'];

const firstWord = (s: string) => s.trim().split(/[\s,.&-]+/)[0] ?? '';

export function collectIdentifiers(src: IdentifierSource): Identifier[] {
  const out: Identifier[] = [];
  const add = (text: string | undefined, kind: Identifier['kind']) => {
    const t = (text ?? '').trim();
    if (t.length >= 3) out.push({ text: t, kind });
  };
  add(src.company?.name, 'company');
  add(src.company?.short, 'company');
  for (const i of src.items ?? []) {
    add(i.code, 'item');
    const tail = i.code.replace(/^[A-Za-z]+-/, ''); // 5120-210: a part number given without its prefix
    if (tail !== i.code && /\d/.test(tail) && tail.length >= 6) add(tail, 'item');
  }
  for (const s of src.suppliers ?? []) {
    add(s.id, 'supplier');
    add(s.id.replace(/^SUP-/i, ''), 'supplier');
    add(s.name, 'supplier');
    const w = firstWord(s.name);
    if (w.length >= 4) add(w, 'supplier');
  }
  for (const p of src.people ?? []) {
    add(p.name, 'person');
    add(p.id, 'person');
    add(p.email, 'person');
    const parts = p.name.trim().split(/\s+/);
    for (const w of [parts[0], parts[parts.length - 1]]) if (w && w.length >= 4) add(w, 'person');
  }
  for (const p of src.programs ?? []) {
    add(p.id, 'program');
    add(p.name, 'program');
    const w = firstWord(p.name);
    if (w.length >= 4) add(w, 'program');
  }
  for (const e of src.ecrs ?? []) {
    add(e.id, 'record');
    add(e.originatingNcr, 'record');
    for (const q of e.supplierQuotes ?? []) add(q.id, 'record');
  }
  for (const n of src.ncrs ?? []) add(n.id, 'record');
  for (const h of src.history ?? []) {
    add(h.id, 'record');
    add(h.ecr, 'record');
  }
  // One entry per distinct spelling.
  const seen = new Set<string>();
  return out.filter((x) => {
    const k = wordForm(x.text);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The compact form of `text` with, for each character, whether it opens or closes a token of the text. */
function compactWithEdges(text: string): { chars: string; opens: boolean[]; closes: boolean[] } {
  const tokens = wordForm(text).trim().split(' ').filter((t) => t !== '');
  let chars = '';
  const opens: boolean[] = [];
  const closes: boolean[] = [];
  for (const t of tokens) {
    for (let i = 0; i < t.length; i++) {
      chars += t[i];
      opens.push(i === 0);
      closes.push(i === t.length - 1);
    }
  }
  return { chars, opens, closes };
}

const isDigitChar = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';

/** Does `needle` (compact) occur in the compact haystack without cutting a number in two? */
function compactHit(hay: ReturnType<typeof compactWithEdges>, needle: string): boolean {
  for (let at = hay.chars.indexOf(needle); at >= 0; at = hay.chars.indexOf(needle, at + 1)) {
    const end = at + needle.length;
    if (isDigitChar(needle[0]) && isDigitChar(hay.chars[at - 1]) && !hay.opens[at]) continue;
    if (isDigitChar(needle[needle.length - 1]) && isDigitChar(hay.chars[end]) && !hay.closes[end - 1]) continue;
    return true;
  }
  return false;
}

function scanLeaks(text: string, ids: Identifier[], allow: readonly string[]): Leak[] {
  const hay = wordForm(text);
  const hayStem = stemForm(text);
  const compactHay = compactWithEdges(text);
  const allowed = new Set(allow.map((w) => wordForm(w)));
  const leaks: Leak[] = [];
  for (const id of ids) {
    const needle = wordForm(id.text);
    if (allowed.has(needle)) continue;
    // Part numbers, record ids and names of several words are also matched with every separator
    // removed: '5120210', 'BW5120210', 'JeffHargrove'.
    const compact = compactForm(id.text);
    const multi = needle.trim().includes(' ');
    const byCompact = (id.kind === 'item' || id.kind === 'record' || multi) && compact.length >= 7 && compactHit(compactHay, compact);
    if (hay.includes(needle) || byCompact || (needle.trim().length >= 4 && hayStem.includes(stemForm(id.text)))) leaks.push({ identifier: id.text, kind: id.kind, query: text });
  }
  const m = RECORD_ID.exec(stripInvisible(text));
  if (m && !leaks.some((l) => wordForm(l.identifier) === wordForm(m[0]))) leaks.push({ identifier: m[0], kind: 'record', query: text });
  return leaks;
}

/**
 * Every identifier found in `text`, as written and after decoding: percent-escapes are decoded
 * (repeatedly, at most 3 passes, so a double-encoded name is read too), with and without `+` read
 * as a space (a form-encoded query), and every form is folded as described at the top of this
 * file. Empty: clean. "%48%61%6C%64%65%6E" is Halden.
 */
export function findLeaks(text: string, ids: Identifier[], allow: readonly string[] = DEFAULT_ALLOW): Leak[] {
  const forms = new Set<string>([text, decodeAll(text), decodeAll(text.replace(/[+]/g, ' '))]);
  const out: Leak[] = [];
  for (const f of forms) for (const l of scanLeaks(f, ids, allow)) if (!out.some((o) => o.identifier === l.identifier)) out.push({ ...l, query: text });
  return out;
}

/** Percent-decodes as far as it goes (at most 3 passes, in case of double encoding); a malformed escape is left as written. */
function decodeAll(s: string): string {
  let cur = s;
  for (let i = 0; i < 3; i++) {
    let next: string;
    try {
      next = decodeURIComponent(cur);
    } catch {
      next = cur.replace(/%([0-9a-f]{2})/gi, (m, h: string) => String.fromCharCode(parseInt(h, 16)));
    }
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

/**
 * Every identifier found in a URL: its host, credentials, path, query and fragment, as written and
 * percent-decoded. A URL is sent to a third party when it is fetched, so it is held to the same rule
 * as a search query.
 */
export function findUrlLeaks(rawUrl: string, ids: Identifier[], allow: readonly string[] = DEFAULT_ALLOW): Leak[] {
  const forms = new Set<string>([rawUrl, decodeAll(rawUrl), decodeAll(rawUrl.replace(/[+]/g, ' '))]);
  try {
    const u = new URL(rawUrl);
    forms.add(decodeAll(`${u.username} ${u.password} ${domainToUnicode(u.hostname)} ${u.pathname} ${u.search} ${u.hash}`));
  } catch {
    // Not a URL: the raw and decoded text above are still checked.
  }
  const out: Leak[] = [];
  for (const f of forms) for (const l of findLeaks(f, ids, allow)) if (!out.some((o) => o.identifier === l.identifier)) out.push({ ...l, query: rawUrl });
  return out;
}
