// Adds NORN_MCP_SIGNING_KEY (32 random bytes, hex) to the untracked root `.env` of the main
// checkout if it is not there yet. Appends only; never prints the key or any other line.
//   npm run key:ensure -w @norn/mcp          (NORN_ENV_FILE=<path> picks another file)
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = 'NORN_MCP_SIGNING_KEY';
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

function target() {
  if (process.env.NORN_ENV_FILE) return resolve(process.env.NORN_ENV_FILE);
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (common) return join(dirname(common), '.env');
  } catch {}
  return join(repoRoot, '.env');
}

const file = target();
const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
const has = text.split(/\r?\n/).some(l => new RegExp(`^\\s*(?:export\\s+)?${NAME}\\s*=\\s*\\S`).test(l));
if (has) {
  console.log(`${NAME} is already set in ${file}`);
} else {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lead = text === '' || text.endsWith('\n') ? '' : eol;
  const line = `${lead}${NAME}=${randomBytes(32).toString('hex')}${eol}`;
  if (text === '') writeFileSync(file, line, { mode: 0o600 });
  else appendFileSync(file, line);
  console.log(`${NAME} added to ${file}`);
}
