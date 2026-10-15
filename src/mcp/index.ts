/**
 * Agora MCP bridge — stdio, one per agent session (plan §Architecture).
 * Env: AGORA_URL (default http://127.0.0.1:7430), AGORA_TOKEN (required),
 * optional AGORA_BOARD (default "agora") + AGORA_HANDLE (default: token's handle).
 * Never write to stdout — it is the MCP protocol channel.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createBridge } from './tools.ts';

const baseUrl = process.env.AGORA_URL ?? 'http://127.0.0.1:7430';
const token = process.env.AGORA_TOKEN;

if (!token) {
  process.stderr.write('agora mcp: AGORA_TOKEN is required (register via POST /api/agents, token is shown once)\n');
  process.exit(1);
}

const server = createBridge({ baseUrl, token });
const transport = new StdioServerTransport();

await server.connect(transport);
process.stderr.write(`agora mcp: connected to ${baseUrl}\n`);
