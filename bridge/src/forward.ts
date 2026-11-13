import { callResponseSchema, type CallRequest, type CallResponse, type WindowRecord } from '../../shared/protocol';

export const DEFAULT_TIMEOUT_MS = 5000;

/** The longest `text` / `error` taken from a window's answer; the rest is cut off so Claude's context stays small. */
export const MAX_ANSWER_CHARS = 2000;

/**
 * A window's answer. `unreachable` marks a refused connection: nothing listens on the advertised port. For a
 * window picked by fallback that usually means a stale discovery file; the session's own window refusing
 * is not stale, so the caller decides what to do with the flag.
 */
export type WindowAnswer = CallResponse & { unreachable?: true };

function cap(s: string): string {
  return s.length > MAX_ANSWER_CHARS ? `${s.slice(0, MAX_ANSWER_CHARS)}… (truncated)` : s;
}

function isTimeout(e: unknown): boolean {
  const name = errorName(e);
  return name === 'TimeoutError' || name === 'AbortError';
}

function isRefused(e: unknown): boolean {
  const cause = e instanceof Error ? e.cause : undefined;
  return typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === 'ECONNREFUSED';
}

function errorName(e: unknown): string {
  return typeof e === 'object' && e !== null && 'name' in e ? String((e as { name: unknown }).name) : '';
}

function errorCause(e: unknown): string {
  if (e instanceof Error && e.cause instanceof Error) return e.cause.message;
  return e instanceof Error ? e.message : String(e);
}

/** Sends one tool call to a window's extension. Every failure comes back as { ok: false } with a readable message. */
export async function callWindow(
  win: WindowRecord,
  req: CallRequest,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<WindowAnswer> {
  const name = `"${win.windowName}"`;
  const timedOut: WindowAnswer = {
    ok: false,
    error: `VS Code window ${name} did not answer within ${timeoutMs / 1000} s (the action may still complete).`,
  };
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${win.port}/call`, {
      method: 'POST',
      headers: { authorization: `Bearer ${win.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (isTimeout(e)) return timedOut;
    const error = `Could not reach VS Code window ${name} on port ${win.port} (${errorCause(e)}); reload that window.`;
    return isRefused(e) ? { ok: false, error, unreachable: true } : { ok: false, error };
  }
  if (res.status === 401) {
    // Release the connection; the body is of no interest and would otherwise stay open until the timeout.
    await res.body?.cancel().catch(() => undefined);
    return { ok: false, error: `Token rejected by window ${name}; reload that window.` };
  }
  let body: unknown;
  try {
    body = await res.json(); // still under the abort signal: a window that stalls mid-body times out too
  } catch (e) {
    if (isTimeout(e)) return timedOut;
    return { ok: false, error: `Window ${name} answered HTTP ${res.status} without JSON.` };
  }
  const parsed = callResponseSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: `Window ${name} answered HTTP ${res.status} with an unexpected body.` };
  return parsed.data.ok ? { ok: true, text: cap(parsed.data.text) } : { ok: false, error: cap(parsed.data.error) };
}
