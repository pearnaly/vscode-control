import { afterEach, describe, expect, it } from 'vitest';
import { startServer, tokenMatches, type RunningServer } from '../../extension/src/server';
import type { CallRequest } from '../../shared/protocol';

const TOKEN = 'b'.repeat(64);
let server: RunningServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function send(
  port: number,
  opts: { body?: string; auth?: string; path?: string; method?: string } = {},
): Promise<{ status: number; body: unknown }> {
  const method = opts.method ?? 'POST';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const auth = 'auth' in opts ? opts.auth : `Bearer ${TOKEN}`;
  if (auth !== undefined) headers.authorization = auth;
  const res = await fetch(`http://127.0.0.1:${port}${opts.path ?? '/call'}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : (opts.body ?? '{}'),
  });
  return { status: res.status, body: await res.json() };
}

/** A valid call whose whole JSON body is exactly `bytes` bytes long (ASCII only). */
function bodyOfSize(bytes: number): string {
  const empty = JSON.stringify({ tool: 'open_file', args: { path: '' } });
  const body = JSON.stringify({ tool: 'open_file', args: { path: 'x'.repeat(bytes - Buffer.byteLength(empty)) } });
  expect(Buffer.byteLength(body)).toBe(bytes);
  return body;
}

describe('tokenMatches', () => {
  it('accepts the exact bearer token', () => {
    expect(tokenMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
  });

  it.each([undefined, '', TOKEN, `Bearer ${TOKEN}x`, `Bearer ${'c'.repeat(64)}`, `bearer ${TOKEN}`])(
    'rejects %s',
    (header) => {
      expect(tokenMatches(header, TOKEN)).toBe(false);
    },
  );
});

describe('startServer', () => {
  it('hands a valid call to the handler and returns its answer', async () => {
    const seen: CallRequest[] = [];
    server = await startServer(TOKEN, async (req) => {
      seen.push(req);
      return { ok: true, text: 'done' };
    });
    const r = await send(server.port, { body: JSON.stringify({ tool: 'open_file', args: { path: 'x' } }) });
    expect(r).toEqual({ status: 200, body: { ok: true, text: 'done' } });
    expect(seen).toEqual([{ tool: 'open_file', args: { path: 'x' } }]);
  });

  it('returns 401 without the token and never calls the handler', async () => {
    let called = false;
    server = await startServer(TOKEN, async () => {
      called = true;
      return { ok: true, text: '' };
    });
    const r = await send(server.port, { auth: undefined });
    expect(r).toEqual({ status: 401, body: { ok: false, error: 'Unauthorized' } });
    expect(called).toBe(false);
  });

  it('returns 404 for other paths and methods', async () => {
    server = await startServer(TOKEN, async () => ({ ok: true, text: '' }));
    expect((await send(server.port, { path: '/other' })).status).toBe(404);
    expect((await send(server.port, { method: 'GET' })).status).toBe(404);
  });

  it('returns 400 for a body that is not JSON', async () => {
    server = await startServer(TOKEN, async () => ({ ok: true, text: '' }));
    expect(await send(server.port, { body: 'not json' })).toEqual({
      status: 400, body: { ok: false, error: 'Body is not JSON' },
    });
  });

  it('returns 400 for an unknown tool', async () => {
    server = await startServer(TOKEN, async () => ({ ok: true, text: '' }));
    const r = await send(server.port, { body: JSON.stringify({ tool: 'run_command', args: {} }) });
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toMatch(/^Bad request: tool:/);
  });

  it('returns 413 for a body over 64 KB', async () => {
    server = await startServer(TOKEN, async () => ({ ok: true, text: '' }));
    const r = await send(server.port, { body: JSON.stringify({ tool: 'open_file', args: 'x'.repeat(70 * 1024) }) });
    expect(r).toEqual({ status: 413, body: { ok: false, error: 'Body too large' } });
  });

  it('accepts a body of exactly 65,536 bytes and rejects one byte more with 413', async () => {
    const seen: CallRequest[] = [];
    server = await startServer(TOKEN, async (req) => {
      seen.push(req);
      return { ok: true, text: 'done' };
    });

    const exact = await send(server.port, { body: bodyOfSize(65_536) });
    expect(exact).toEqual({ status: 200, body: { ok: true, text: 'done' } });
    expect(seen).toHaveLength(1);

    const over = await send(server.port, { body: bodyOfSize(65_537) });
    expect(over).toEqual({ status: 413, body: { ok: false, error: 'Body too large' } });
    expect(seen).toHaveLength(1);
  });

  it('returns 401 for a wrong token over HTTP and never calls the handler', async () => {
    let called = false;
    server = await startServer(TOKEN, async () => {
      called = true;
      return { ok: true, text: '' };
    });
    const r = await send(server.port, { auth: `Bearer ${'c'.repeat(64)}` });
    expect(r).toEqual({ status: 401, body: { ok: false, error: 'Unauthorized' } });
    expect(called).toBe(false);
  });

  it('closes the connection after a 401 and after a 404', async () => {
    server = await startServer(TOKEN, async () => ({ ok: true, text: '' }));
    const url = `http://127.0.0.1:${server.port}`;
    const unauthorized = await fetch(`${url}/call`, { method: 'POST', body: '{}' });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('connection')).toBe('close');
    const missing = await fetch(`${url}/other`, { method: 'POST', body: '{}' });
    expect(missing.status).toBe(404);
    expect(missing.headers.get('connection')).toBe('close');
  });

  it('returns 500 with the message when the handler throws', async () => {
    server = await startServer(TOKEN, async () => {
      throw new Error('boom');
    });
    const r = await send(server.port, { body: JSON.stringify({ tool: 'open_file', args: {} }) });
    expect(r).toEqual({ status: 500, body: { ok: false, error: 'boom' } });
  });

  it('returns 500 and reports it when the answer cannot be serialised', async () => {
    const errors: unknown[] = [];
    server = await startServer(
      TOKEN,
      async () => ({ ok: true, text: 1n as unknown as string }),
      (e) => errors.push(e),
    );
    const r = await send(server.port, { body: JSON.stringify({ tool: 'open_file', args: {} }) });
    expect(r).toEqual({ status: 500, body: { ok: false, error: 'Response could not be serialised' } });
    expect(errors).toHaveLength(1);
  });

  it('close() resolves while a handler is still pending', async () => {
    let entered!: () => void;
    const handlerEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const running = await startServer(TOKEN, () => {
      entered();
      return new Promise<never>(() => {}); // never answers
    });
    server = running;
    const aborted = send(running.port, { body: JSON.stringify({ tool: 'open_file', args: {} }) }).catch(
      () => 'aborted',
    );
    await handlerEntered;
    server = undefined;
    await expect(running.close()).resolves.toBeUndefined();
    expect(await aborted).toBe('aborted');
  });

  it('rejects a token shorter than 32 characters before listening', async () => {
    await expect(startServer('short', async () => ({ ok: true, text: '' }))).rejects.toThrow(
      'token must be at least 32 characters',
    );
  });
});
