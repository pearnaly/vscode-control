import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { openFileObject, revealArgs } from '../../shared/protocol';
import { OPEN_FILE_DESCRIPTION, REVEAL_DESCRIPTION, SERVER_INSTRUCTIONS } from './descriptions';
import { handleTool, type HandleDeps } from './handle';

/** The MCP server with both tools. Strict input schemas: unknown keys are rejected, not dropped. */
export function buildServer(deps: HandleDeps): McpServer {
  const server = new McpServer({ name: 'vscode-control', version: '0.2.0' }, { instructions: SERVER_INSTRUCTIONS });
  server.registerTool(
    'open_file',
    { title: 'Open file in VS Code', description: OPEN_FILE_DESCRIPTION, inputSchema: openFileObject },
    (args) => handleTool('open_file', args, deps),
  );
  server.registerTool(
    'reveal_in_explorer',
    { title: 'Reveal in VS Code Explorer', description: REVEAL_DESCRIPTION, inputSchema: revealArgs },
    (args) => handleTool('reveal_in_explorer', args, deps),
  );
  return server;
}
