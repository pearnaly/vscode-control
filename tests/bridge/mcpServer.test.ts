import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVER_INSTRUCTIONS } from '../../bridge/src/descriptions';
import type { HandleDeps } from '../../bridge/src/handle';
import { buildServer } from '../../bridge/src/mcpServer';
import type { CallRequest } from '../../shared/protocol';

const file = path.resolve(os.tmpdir(), 'a.ts');

async function connect(): Promise<{ client: Client; calls: CallRequest[] }> {
  const calls: CallRequest[] = [];
  const deps: HandleDeps = {
    readWindows: async () => [
      { pid: 7, port: 1007, token: 't'.repeat(64), workspaceFolders: [], windowName: 'w7', lastFocusedAt: 0 },
    ],
    snapshot: async () => ({
      table: new Map([
        [1, { parent: 7, created: 0 }],
        [7, { parent: 0, created: 0 }],
      ]),
      takenAt: Date.now(),
      timed: true,
    }),
    selfPid: 1,
    log: () => undefined,
    cwd: os.tmpdir(),
    callWindow: async (_win, req) => {
      calls.push(req);
      return { ok: true, text: 'done' };
    },
    forgetWindow: async () => undefined,
  };
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await buildServer(deps).connect(serverSide);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientSide);
  return { client, calls };
}

describe('buildServer', () => {
  it('lists both tools with their descriptions', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['open_file', 'reveal_in_explorer']);
    expect(tools.find((t) => t.name === 'open_file')?.description).toContain('walkthrough');
  });

  it('describes the secret flow with a safe file location and the reveal focus honestly', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const open = tools.find((t) => t.name === 'open_file');
    const reveal = tools.find((t) => t.name === 'reveal_in_explorer');
    expect(open?.description).toContain(
      'neither committed nor synced (outside any cloud-synced folder (OneDrive, Dropbox, iCloud…), and gitignored or outside any repository)',
    );
    expect(open?.description).toContain('tell the user not to select the value after typing it');
    expect(reveal?.description).toContain('keyboard focus goes back to the active editor group (normally the chat tab)');
    expect(reveal?.description).toContain('Items hidden by files.exclude are not shown even though the call succeeds.');
    const focus = (reveal?.inputSchema.properties as { focus?: { description?: string } } | undefined)?.focus;
    expect(focus?.description).toContain('keyboard focus goes back to the active editor group (normally the chat tab)');
  });

  it('sends the usage instructions with the handshake', async () => {
    const { client } = await connect();
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    expect(SERVER_INSTRUCTIONS).toContain('open_file');
    expect(SERVER_INSTRUCTIONS).toContain(
      'or to let the user type a secret into a file that is neither committed nor synced (focus true, placeholder selected; wait for "done"; never reopen it with a selection)',
    );
  });

  it('publishes strict input schemas (additionalProperties: false) for both tools', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(2);
    for (const tool of tools) {
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
    }
  });

  it('forwards a valid call', async () => {
    const { client, calls } = await connect();
    const r = await client.callTool({ name: 'open_file', arguments: { path: file, line: 2 } });
    expect(r.isError).toBeFalsy();
    expect(calls).toEqual([{ tool: 'open_file', args: { path: file, line: 2 } }]);
  });

  it.each([
    ['open_file', { path: file, lines: 3 }],
    ['reveal_in_explorer', { path: file, focused: true }],
  ])('%s rejects unknown keys instead of dropping them', async (name, args) => {
    const { client, calls } = await connect();
    // Depending on the SDK version a validation failure is an isError result or a rejected call; both count.
    const outcome = await client
      .callTool({ name, arguments: args })
      .then((r) => (r.isError ? 'error' : 'ok'), () => 'error');
    expect(outcome).toBe('error');
    expect(calls).toEqual([]);
  });
});
