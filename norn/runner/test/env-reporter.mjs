// A minimal stdio MCP server for the smoke test. At start it writes the NAMES (never the values)
// of the environment variables it received to the file named by its own NORN_REPORT_FILE, then
// answers just enough MCP (initialize, tools/list) for Claude Code to mark it connected.
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const file = process.env.NORN_REPORT_FILE;
if (file) writeFileSync(file, JSON.stringify(Object.keys(process.env).sort()));

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
createInterface({ input: process.stdin }).on('line', (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  if (request.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: request.id,
      result: { protocolVersion: request.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'env-reporter', version: '0.0.1' } },
    });
  } else if (request.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'ping', description: 'Does nothing.', inputSchema: { type: 'object', properties: {} } }] } });
  } else if (request.id !== undefined) {
    send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'not supported' } });
  }
});
