#!/usr/bin/env node
// Renames the product from "Norn" to "Fern" wherever a person sees it. Internal identifiers stay.
//
//   node scripts/rename-fern.mjs            apply the rename to the working tree
//   node scripts/rename-fern.mjs --check    change nothing; exit 1 if any file would change
//
// Plain Node, no dependencies, deterministic, and safe to run twice (a second run changes nothing).
// It is a script rather than hand edits so it can be re-run on the latest main right before merging.
//
// What it touches (see FILES): the web app, the agents' prompts and messages, the text Norn writes
// into the PLM and ERP, the module's refusal reasons, the checks' trace text and their fixtures,
// Bowman's configuration text, and the reader-facing docs (README, DEMO, DEVPOST, PROOF, GLOSSARY,
// the package READMEs, CLAUDE.md).
//
// What it replaces: only the capitalised whole word Norn (Norn, Norn's, "Ask Norn"). It never
// matches inside an identifier (NornEvent, useNorn, askNorn, @norn/*, NORN_*, norn.ts), because those
// have no word boundary. In .ts files it replaces only inside string literals, template text and
// regex literals, never in code or comments. In .tsx, .md, .html and .json it works line by line and
// skips comment lines.
//
// What it leaves alone on purpose (PROTECTED below): 'Norn Agent' (an ERP role name), any string
// handed to spawnedBy (a value stored in the database), and the "Norn, for " prefix the web
// parses out of spawnedBy.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CHECK = process.argv.includes('--check');
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0').filter(Boolean);

// ---- which files, and how to read each ----------------------------------------------------------

// mode 'ts': string literals, template text and regex literals only. 'tsx', 'text', 'json': by line.
const FILES = [
  { mode: 'ts', re: /^norn\/.+\.ts$/, not: /^norn\/(bindings|module-test)\/|^norn\/web\/(spike|screenshots)\/|^norn\/workers\/src\/spike\/|\.d\.ts$/ },
  { mode: 'ts', re: /^bowman\/norn-config\/bowman\.config\.ts$/ },
  { mode: 'tsx', re: /^norn\/web\/src\/.+\.tsx$/ },
  { mode: 'text', re: /^norn\/web\/index\.html$/ },
  { mode: 'json', re: /^norn\/web\/src\/assessment\/fixtures\/.+\.json$/ },
  { mode: 'text', re: /^(README\.md|CLAUDE\.md|docs\/(DEMO|DEVPOST|PROOF|GLOSSARY)\.md)$/ },
  { mode: 'text', re: /^(norn|bowman\/norn-config)\/(.+\/)?README\.md$/ },
];

// ---- the replacement ----------------------------------------------------------------------------

// A string that hands the database a value. Never renamed.
const SKIP_IF_BEFORE = /spawnedBy\s*(:|===|!==|=)\s*$/;
// Calls whose lone 'Norn' argument is a spawnedBy value (checks.ts body(spawnedBy), the guard's post(.., spawnedBy)).
const SKIP_EXACT_IF_BEFORE = /(\bbody\(|undefined,)\s*$/;
// Strings that are advice about the stored value itself.
const SKIP_IF_CONTAINS = /spawnedBy/;

// Whole word only; 'Norn Agent' is the ERP role name.
const WORD = /\bNorn\b(?! Agent\b)(?! until 2026-10-25)/g; // "Norn until 2026-10-25" is the glossary saying what the name used to be
const word = (s) => s.replace(WORD, 'Fern');

function inString(text, before) {
  if (SKIP_IF_BEFORE.test(before) || SKIP_IF_CONTAINS.test(text)) return text;
  if (text === 'Norn, for ') return text; // the prefix the web parses out of spawnedBy
  if (text === 'Norn' && SKIP_EXACT_IF_BEFORE.test(before)) return text;
  return word(text);
}

// ---- .ts: a small lexer, so only literals change ------------------------------------------------

function lexTs(src) {
  let out = '', i = 0, mode = 'code', depth = 0, prev = '', seg = '', tplBefore = '';
  const stack = [], n = src.length;
  const before = (k) => src.slice(Math.max(0, k - 80), k);
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && d === '/') { let j = src.indexOf('\n', i); if (j < 0) j = n; out += src.slice(i, j); i = j; continue; }
      if (c === '/' && d === '*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; out += src.slice(i, j); i = j; continue; }
      if (c === "'" || c === '"') {
        let j = i + 1;
        while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
        out += c + inString(src.slice(i + 1, j), before(i)) + (src[j] === c ? c : '');
        i = src[j] === c ? j + 1 : j; prev = c; continue;
      }
      if (c === '`') { mode = 'template'; seg = ''; tplBefore = before(i); out += c; i++; continue; }
      if (c === '/' && (prev === '' || '(,=:[!&|?{};'.includes(prev))) {
        let j = i + 1, cls = false;
        while (j < n && src[j] !== '\n') {
          const ch = src[j];
          if (ch === '\\') { j += 2; continue; }
          if (ch === '[') cls = true; else if (ch === ']') cls = false; else if (ch === '/' && !cls) break;
          j++;
        }
        if (src[j] === '/') { out += '/' + inString(src.slice(i + 1, j), before(i)) + '/'; i = j + 1; prev = '/'; continue; }
      }
      if (c === '{') depth++;
      if (c === '}') {
        if (depth === 0 && stack.length) { depth = stack.pop(); mode = 'template'; seg = ''; tplBefore = ''; out += c; i++; continue; }
        depth--;
      }
      out += c; if (!/\s/.test(c)) prev = c; i++;
    } else {
      if (c === '\\') { seg += c + (d ?? ''); i += 2; continue; }
      if (c === '`') { out += inString(seg, tplBefore) + c; mode = 'code'; prev = '`'; i++; continue; }
      if (c === '$' && d === '{') { out += inString(seg, tplBefore) + '${'; stack.push(depth); depth = 0; mode = 'code'; prev = '{'; i += 2; continue; }
      seg += c; i++;
    }
  }
  return out + (mode === 'template' ? inString(seg, tplBefore) : '');
}

// ---- line by line (.tsx, .md, .html, .json) -----------------------------------------------------

const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|\{\s*\/\*|<!--)/;
const PREFIX = '\u0001FERNPREFIX\u0001';

function lineMode(src, mode) {
  return src.split('\n').map((line) => {
    if (mode !== 'json' && COMMENT_LINE.test(line)) return line;
    let code = line, tail = '';
    if (mode === 'tsx') { const k = line.search(/\s\/\/\s/); if (k >= 0) { code = line.slice(0, k); tail = line.slice(k); } }
    code = code.replaceAll("'Norn, for '", PREFIX);
    code = word(code);
    if (mode === 'tsx') code = code.replace('<h1>NORN</h1>', '<h1>FERN</h1>'); // the connecting screen's heading
    code = code.replace(/(["'>])norn\.(["'<])/g, '$1fern.$2'); // the "norn." wordmark, where one is written out
    return code.replaceAll(PREFIX, "'Norn, for '") + tail;
  }).join('\n');
}

// ---- passages that are about the name itself, rewritten rather than word-swapped -----------------

// The glossary explained Norn by the Norns of Norse myth. That does not carry over to Fern, so the
// entry now says what is true and invents no new etymology.
const GLOSSARY_NAME = /- \*\*Norn\.\*\* Our product's name \(Tyler, 2026-10-24\)\. The Norns of Norse myth know the past, the(\r?\n)  present and the future\. Norn reads a company's history to forecast what a change will do\./;
const GLOSSARY_NAME_NEW = "- **Fern.** Our product's name. It was Norn until 2026-10-25 (Tyler); the code still uses `norn`.$1  Fern reads a company's history to forecast what a change will do.";

// ---- one line to add ----------------------------------------------------------------------------

const NAMING_NOTE = '**The product is named Fern** (renamed from Norn on 2026-10-25). The code, folders and identifiers still say `norn`: `norn/`, `@norn/*`, `NORN_*`, the `norn` database. Only what a person reads was renamed; `scripts/rename-fern.mjs` did it and can be re-run.';

function addNote(src) {
  if (src.includes('**The product is named Fern**')) return src;
  const nl = src.includes('\r\n') ? '\r\n' : '\n';
  const k = src.indexOf(nl);
  return src.slice(0, k) + nl + nl + NAMING_NOTE + src.slice(k);
}

// ---- run ----------------------------------------------------------------------------------------

let changed = 0, lines = 0;
for (const f of tracked) {
  const rule = FILES.find((r) => r.re.test(f) && !(r.not && r.not.test(f)));
  if (!rule) continue;
  const path = join(root, f);
  const src = readFileSync(path, 'utf8');
  let out = src;
  if (f === 'docs/GLOSSARY.md') out = out.replace(GLOSSARY_NAME, GLOSSARY_NAME_NEW);
  out = rule.mode === 'ts' ? lexTs(out) : lineMode(out, rule.mode);
  if (f === 'CLAUDE.md') out = addNote(out);
  if (out === src) continue;
  changed++;
  const a = src.split('\n'), b = out.split('\n');
  for (let k = 0; k < Math.max(a.length, b.length); k++) if (a[k] !== b[k]) lines++;
  if (!CHECK) writeFileSync(path, out);
  console.log(`${CHECK ? 'would change' : 'changed'} ${f}`);
}
console.log(`${changed} file(s) ${CHECK ? 'would change' : 'changed'}, ${lines} line(s)`);
if (CHECK && changed) process.exit(1);
