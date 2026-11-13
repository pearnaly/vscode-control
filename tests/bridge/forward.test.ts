import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { callWindow } from '../../bridge/src/forward';
import { startServer, type RunningServer } from '../../extension/src/server';
import type { WindowRecord } from '../../shared/protocol';

const TOKEN = 'k'.repeat(64);
const win = (port: number, token = TOKEN): WindowRecord => ({
  pid: 1, port, token, workspaceFolders: [], windowName: 'my-project', lastFocusedAt: 0,
});
let server: RunningServer | undefined;
let raw: http.Server | undefined;

/** A bare HTTP server for answers the real extension server never gives. Returns its port. */
async function rawServer(handler: http.RequestListener): Promise<number> {
  const s = http.createServer(handler);
  raw = s;
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', () => resolve()));
  return (s.address() as AddressInfo).port;
}

afterEach(async () => {
  await server?.close();
  server = undefined;
  raw?.closeAllConnections();
  raw?.close();
  raw = undefined;
});

const TRUNCATED = '… (truncated)';

describe('callWindow', () => {
  it("returns the window's answer", async () => {
    server = await startServer(TOKEN, async (req) => ({ ok: true, text: `ran ${req.tool}` }));
    expect(await callWindow(win(server.port), { tool: 'open_file', args: {} })).toEqual({ ok: true, text: 'ran open_file' });
  });

  it('passes tool errors through', async () => {
    server = await startServer(TOKEN, async () => ({ ok: false, error: 'Not found: C:\\x' }));
    expect(await callWindow(win(server.port), { tool: 'reveal_in_explorer', args: {} })).toEqual({
      ok: false, error: 'Not found: C:\\x',
    });
  });

  it('explains a rejected token', async () => {
    server = await startServer(TOKEN, async () => ({ ok: true, text: '' }));
    expect(await callWindow(win(server.port, 'x'.repeat(64)), { tool: 'open_file', args: {} })).toEqual({
      ok: false, error: 'Token rejected by window "my-project"; reload that window.',
    });
  });

  it('explains a window that does not answer in time', async () => {
    const hanging = http.createServer(() => {
      /* never answers */
    });
    await new Promise<void>((resolve) => hanging.listen(0, '127.0.0.1', () => resolve()));
    const { port } = hanging.address() as AddressInfo;
    try {
      expect(await callWindow(win(port), { tool: 'open_file', args: {} }, 200)).toEqual({
        ok: false, error: 'VS Code window "my-project" did not answer within 0.2 s (the action may still complete).',
      });
    } finally {
      hanging.closeAllConnections();
      hanging.close();
    }
  });

  it('explains a window that answers with something other than JSON', async () => {
    const port = await rawServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('hello');
    });
    expect(await callWindow(win(port), { tool: 'open_file', args: {} })).toEqual({
      ok: false, error: 'Window "my-project" answered HTTP 200 without JSON.',
    });
  });

  it('explains a window that answers with JSON of the wrong shape', async () => {
    const port = await rawServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"x":1}');
    });
    expect(await callWindow(win(port), { tool: 'open_file', args: {} })).toEqual({
      ok: false, error: 'Window "my-project" answered HTTP 200 with an unexpected body.',
    });
  });

  it('reports a timeout, not "without JSON", when the body stalls after the headers', async () => {
    const port = await rawServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"ok":true,"te'); // never finished
    });
    expect(await callWindow(win(port), { tool: 'open_file', args: {} }, 200)).toEqual({
      ok: false, error: 'VS Code window "my-project" did not answer within 0.2 s (the action may still complete).',
    });
  });

  it('truncates a long text from the window', async () => {
    server = await startServer(TOKEN, async () => ({ ok: true, text: 'a'.repeat(5000) }));
    expect(await callWindow(win(server.port), { tool: 'open_file', args: {} })).toEqual({
      ok: true, text: 'a'.repeat(2000) + TRUNCATED,
    });
  });

  it('truncates a long error from the window', async () => {
    server = await startServer(TOKEN, async () => ({ ok: false, error: 'e'.repeat(5000) }));
    expect(await callWindow(win(server.port), { tool: 'open_file', args: {} })).toEqual({
      ok: false, error: 'e'.repeat(2000) + TRUNCATED,
    });
  });

  it('leaves a text of exactly 2000 characters alone', async () => {
    server = await startServer(TOKEN, async () => ({ ok: true, text: 'a'.repeat(2000) }));
    expect(await callWindow(win(server.port), { tool: 'open_file', args: {} })).toEqual({
      ok: true, text: 'a'.repeat(2000),
    });
  });

  it('releases the connection after a 401 instead of leaving the body open', async () => {
    let closed: Promise<void> | undefined;
    const port = await rawServer((_req, res) => {
      closed = new Promise<void>((resolve) => res.on('close', () => resolve()));
      res.writeHead(401, { 'content-type': 'text/plain' });
      res.write('unfinished body');
    });
    const r = await callWindow(win(port), { tool: 'open_file', args: {} });
    expect(r).toEqual({ ok: false, error: 'Token rejected by window "my-project"; reload that window.' });
    const outcome = await Promise.race([
      closed?.then(() => 'closed'),
      new Promise<string>((resolve) => setTimeout(() => resolve('still open'), 1000)),
    ]);
    expect(outcome).toBe('closed');
  });

  it('explains a window that is not listening', async () => {
    const gone = await startServer(TOKEN, async () => ({ ok: true, text: '' }));
    const port = gone.port;
    await gone.close();
    const r = await callWindow(win(port), { tool: 'open_file', args: {} });
    expect(r.ok).toBe(false);
    expect(r.unreachable).toBe(true);
    if (!r.ok) expect(r.error).toMatch(/^Could not reach VS Code window "my-project" on port \d+ \(.+\); reload that window\.$/);
  });
});
