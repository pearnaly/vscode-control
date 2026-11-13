import { timingSafeEqual } from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { callRequestSchema, formatZodError, type CallRequest, type CallResponse } from '../../shared/protocol';

export type CallHandler = (req: CallRequest) => Promise<CallResponse>;

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 64 * 1024;
const MIN_TOKEN_LENGTH = 32;
const REQUEST_TIMEOUT_MS = 10_000;

/** Constant-time check of an `Authorization: Bearer <token>` header. */
export function tokenMatches(header: string | undefined, token: string): boolean {
  if (header === undefined || !header.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Reads the whole body; undefined when it exceeds `limit` bytes (the rest is drained, not kept). */
function readBody(req: http.IncomingMessage, limit: number): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    req.on('end', () => resolve(size > limit ? undefined : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function route(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  token: string,
  handle: CallHandler,
  onError: ((error: unknown) => void) | undefined,
): Promise<void> {
  /** Serialises before writing the head, so a value that cannot be serialised still gets a clean 500. */
  const send = (status: number, body: CallResponse, closeConnection = false): void => {
    let code = status;
    let payload: string;
    try {
      payload = JSON.stringify(body);
    } catch (e) {
      onError?.(e);
      code = 500;
      payload = JSON.stringify({ ok: false, error: 'Response could not be serialised' } satisfies CallResponse);
    }
    res.writeHead(code, { 'content-type': 'application/json', ...(closeConnection ? { connection: 'close' } : {}) });
    res.end(payload);
  };
  // 404 and 401 leave the body unread; closing the socket stops Node from draining it.
  if (req.method !== 'POST' || req.url !== '/call') return send(404, { ok: false, error: 'Not found' }, true);
  if (!tokenMatches(req.headers.authorization, token)) return send(401, { ok: false, error: 'Unauthorized' }, true);
  const raw = await readBody(req, MAX_BODY_BYTES);
  if (raw === undefined) return send(413, { ok: false, error: 'Body too large' });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return send(400, { ok: false, error: 'Body is not JSON' });
  }
  const parsed = callRequestSchema.safeParse(json);
  if (!parsed.success) return send(400, { ok: false, error: `Bad request: ${formatZodError(parsed.error)}` });
  try {
    send(200, await handle(parsed.data));
  } catch (e) {
    send(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Starts the window's control server on 127.0.0.1 with a random free port.
 * `onError` receives failures that cannot be answered to the caller (and later server errors).
 */
export function startServer(
  token: string,
  handle: CallHandler,
  onError?: (error: unknown) => void,
): Promise<RunningServer> {
  if (token.length < MIN_TOKEN_LENGTH) {
    return Promise.reject(new Error(`token must be at least ${MIN_TOKEN_LENGTH} characters`));
  }
  const server = http.createServer(
    // Node enforces the timeouts only every `connectionsCheckingInterval` (30 s by default).
    { requestTimeout: REQUEST_TIMEOUT_MS, headersTimeout: REQUEST_TIMEOUT_MS, connectionsCheckingInterval: 1_000 },
    (req, res) => {
      route(req, res, token, handle, onError).catch((e: unknown) => {
        onError?.(e);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    },
  );
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      server.on('error', (e) => onError?.(e));
      const { port } = server.address() as AddressInfo;
      resolve({
        port,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
