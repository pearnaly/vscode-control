import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleTool, NO_WINDOW, type HandleDeps } from '../../bridge/src/handle';
import type { CallRequest, WindowRecord } from '../../shared/protocol';

const file = path.resolve(os.tmpdir(), 'a.ts');
const win = (pid: number, workspaceFolders: string[] = []): WindowRecord => ({
  pid, port: 1000 + pid, token: 't'.repeat(64), workspaceFolders, windowName: `w${pid}`, lastFocusedAt: 0,
});

type TestDeps = HandleDeps & { calls: Array<{ pid: number; req: CallRequest }>; forgotten: number[] };

function makeDeps(over: Partial<HandleDeps> = {}): TestDeps {
  const calls: Array<{ pid: number; req: CallRequest }> = [];
  const forgotten: number[] = [];
  return {
    calls,
    forgotten,
    readWindows: async () => [win(7)],
    ancestors: async () => [99, 7],
    cwd: os.tmpdir(),
    callWindow: async (w, req) => {
      calls.push({ pid: w.pid, req });
      return { ok: true, text: `Opened a.ts (window: w${w.pid})` };
    },
    forgetWindow: async (w) => {
      forgotten.push(w.pid);
    },
    ...over,
  };
}

const refused = { ok: false as const, error: 'Could not reach VS Code window "w7"', unreachable: true as const };

const text = (r: CallToolResult): string => r.content.map((c) => (c.type === 'text' ? c.text : '')).join('');

describe('handleTool', () => {
  it('forwards valid arguments to the window found through the process tree', async () => {
    const deps = makeDeps();
    const r = await handleTool('open_file', { path: file, line: 3 }, deps);
    expect(r.isError).toBeFalsy();
    expect(text(r)).toBe('Opened a.ts (window: w7)');
    expect(deps.calls).toEqual([{ pid: 7, req: { tool: 'open_file', args: { path: file, line: 3 } } }]);
  });

  it('notes a window chosen by folder match', async () => {
    const deps = makeDeps({ ancestors: async () => [], readWindows: async () => [win(7, [os.tmpdir()])] });
    expect(text(await handleTool('open_file', { path: file }, deps))).toBe(
      'Opened a.ts (window: w7) [window chosen by folder match]',
    );
  });

  it('notes a window chosen by last focus', async () => {
    const deps = makeDeps({ ancestors: async () => [] });
    expect(text(await handleTool('open_file', { path: file }, deps))).toBe(
      'Opened a.ts (window: w7) [window chosen by last focus]',
    );
  });

  it('rejects invalid arguments without calling a window', async () => {
    const deps = makeDeps();
    const r = await handleTool('open_file', { path: file, endLine: 2 }, deps);
    expect(r.isError).toBe(true);
    expect(text(r)).toBe('Invalid arguments: endLine: endLine requires line');
    expect(deps.calls).toEqual([]);
  });

  it('says so when no window is running', async () => {
    const r = await handleTool('reveal_in_explorer', { path: file }, makeDeps({ readWindows: async () => [] }));
    expect(r.isError).toBe(true);
    expect(text(r)).toBe(NO_WINDOW);
  });

  it('explains an unreadable discovery directory', async () => {
    const deps = makeDeps({
      readWindows: async () => {
        throw new Error('EACCES: permission denied');
      },
    });
    const r = await handleTool('open_file', { path: file }, deps);
    expect(r.isError).toBe(true);
    expect(text(r)).toBe('Cannot read the vscode-control discovery directory: EACCES: permission denied');
  });

  it('returns window errors as tool errors', async () => {
    const deps = makeDeps({ callWindow: async () => ({ ok: false, error: 'Not found: x' }) });
    const r = await handleTool('reveal_in_explorer', { path: file }, deps);
    expect(r.isError).toBe(true);
    expect(text(r)).toBe('Not found: x');
  });

  it('forgets a window that refuses connections and retries with the next one', async () => {
    const deps = makeDeps({
      readWindows: async () => [win(7), win(8)],
      ancestors: async () => [],
      callWindow: async (w) => (w.pid === 7 ? refused : { ok: true, text: `Opened a.ts (window: w${w.pid})` }),
    });
    const r = await handleTool('open_file', { path: file }, deps);
    expect(r.isError).toBeFalsy();
    expect(text(r)).toBe('Opened a.ts (window: w8) [window chosen by last focus]');
    expect(deps.forgotten).toEqual([7]);
  });

  it('says no window is running when the only window picked by fallback refuses connections', async () => {
    const deps = makeDeps({ ancestors: async () => [], callWindow: async () => refused });
    const r = await handleTool('open_file', { path: file }, deps);
    expect(r.isError).toBe(true);
    expect(text(r)).toBe(`${NO_WINDOW} (window "w7" refused the connection and was forgotten)`);
    expect(deps.forgotten).toEqual([7]);
  });

  it("neither forgets nor retargets the session's own window when it refuses connections", async () => {
    let calls = 0;
    // The message callWindow really produces: it ends in "; reload that window."
    const ownRefused = {
      ok: false as const,
      error: 'Could not reach VS Code window "w7" on port 1007 (connect ECONNREFUSED 127.0.0.1:1007); reload that window.',
      unreachable: true as const,
    };
    const deps = makeDeps({
      readWindows: async () => [win(7), win(8)],
      callWindow: async () => {
        calls += 1;
        return ownRefused;
      },
    });
    const r = await handleTool('open_file', { path: file }, deps);
    expect(r.isError).toBe(true);
    expect(text(r)).toBe(
      'Could not reach VS Code window "w7" on port 1007 (connect ECONNREFUSED 127.0.0.1:1007); ' +
        'reload that window (this also restarts the Claude session running in it).',
    );
    expect(calls).toBe(1);
    expect(deps.forgotten).toEqual([]);
  });

  it.each([
    'VS Code window "w7" did not answer within 5 s (the action may still complete).',
    'Token rejected by window "w7"; reload that window.',
  ])('neither forgets nor retries after a refusal that is not a refused connection: %s', async (error) => {
    let calls = 0;
    const deps = makeDeps({
      readWindows: async () => [win(7), win(8)],
      ancestors: async () => [],
      callWindow: async () => {
        calls += 1;
        return { ok: false, error };
      },
    });
    const r = await handleTool('open_file', { path: file }, deps);
    expect(r.isError).toBe(true);
    expect(text(r)).toBe(`${error} [window chosen by last focus]`);
    expect(calls).toBe(1);
    expect(deps.forgotten).toEqual([]);
  });

  it('retries only once', async () => {
    let calls = 0;
    const deps = makeDeps({
      readWindows: async () => [win(7), win(8), win(9)],
      ancestors: async () => [],
      callWindow: async () => {
        calls += 1;
        return refused;
      },
    });
    const r = await handleTool('open_file', { path: file }, deps);
    expect(r.isError).toBe(true);
    expect(calls).toBe(2);
    expect(deps.forgotten).toEqual([7]);
  });
});
