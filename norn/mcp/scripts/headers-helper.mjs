// Prints the MCP request headers for a token kept in a file, as Claude Code's `headersHelper`
// expects (a JSON object on stdout). The token is read from the file, so it never appears in a
// command line. Usage: node headers-helper.mjs <token file>
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node headers-helper.mjs <token file>');
  process.exit(64);
}
process.stdout.write(JSON.stringify({ Authorization: `Bearer ${readFileSync(file, 'utf8').trim()}` }));
