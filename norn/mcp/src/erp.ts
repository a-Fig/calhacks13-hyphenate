// The seam for the ERP history tools. Not built.
//
// The ERPNext connector (#40) will give Norn read access to purchase history, quotes, stock and
// standard costs. When it lands, register its read tools here (for example `get_purchase_history`
// and `get_stock`), each with an evidence class of fact and a source, and add their names to
// READ_TOOLS in client.ts so a job can allow them. Everything an agent does here is already scoped
// by the token, so the connector only has to answer reads; it needs no identity handling.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from './tools.ts';

export function registerErpTools(_server: McpServer, _ctx: ToolContext): void {
  // Intentionally empty.
}
