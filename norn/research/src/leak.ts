// The leak check: a search query may not carry anything that identifies the company, its parts,
// suppliers, people, programs or change records. Web search goes to a third party, and Bowman's
// facts are not on the web anyway (the agent researches the world, not the company).
//
// Pure and deterministic. Matching is by whole words after folding case and punctuation, so
// 'bw-5120-210', 'BW 5120 210' and 'BW5120-210 bracket' all hit the item code. The check errs
// towards rejecting: a distinctive first word of a supplier or a surname also counts. A word that
// is also an ordinary term (cobalt, the metal) goes in `allow`.

import { wordForm } from './text.ts';

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

/** Every identifier found in `text`. Empty: clean. */
export function findLeaks(text: string, ids: Identifier[], allow: readonly string[] = DEFAULT_ALLOW): Leak[] {
  const hay = wordForm(text);
  const allowed = new Set(allow.map((w) => wordForm(w)));
  const leaks: Leak[] = [];
  for (const id of ids) {
    const needle = wordForm(id.text);
    if (allowed.has(needle)) continue;
    // Compare with the digits and letters of an item code run together as well, for 'BW5120210'.
    const squashed = needle.replace(/ /g, '');
    if (hay.includes(needle) || (id.kind === 'item' && squashed.length >= 8 && hay.replace(/ /g, '').includes(squashed))) {
      leaks.push({ identifier: id.text, kind: id.kind, query: text });
    }
  }
  const m = RECORD_ID.exec(text);
  if (m && !leaks.some((l) => wordForm(l.identifier) === wordForm(m[0]))) leaks.push({ identifier: m[0], kind: 'record', query: text });
  return leaks;
}
