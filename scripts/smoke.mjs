// End-to-end check through the real bridge and the real VS Code window.
// Usage: node scripts/smoke.mjs                      → list tools, open README.md lines 1–3, reveal README.md
//        node scripts/smoke.mjs <tool> '<json args>' → one call
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [tool, json] = process.argv.slice(2);

// Parse before starting the bridge, so a typo in the JSON costs no subprocess and is explained.
let toolArgs = {};
if (tool) {
  try {
    toolArgs = JSON.parse(json ?? '{}');
  } catch (e) {
    console.error(`usage: node scripts/smoke.mjs [<tool> '<json args>']\n${e.message}`);
    process.exit(1);
  }
}

const client = new Client({ name: 'vscode-control-smoke', version: '0.0.0' });
await client.connect(
  new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'bridge', 'dist', 'index.js')] }),
);

const { tools } = await client.listTools();
console.log(`tools: ${tools.map((t) => t.name).join(', ')}`);

const readme = path.join(root, 'README.md');
const calls = tool
  ? [[tool, toolArgs]]
  : [
      ['open_file', { path: readme, line: 1, endLine: 3 }],
      ['reveal_in_explorer', { path: readme }],
    ];

for (const [name, args] of calls) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content.map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n');
  console.log(`${name}: ${r.isError ? 'ERROR ' : ''}${text}`);
}
await client.close();
