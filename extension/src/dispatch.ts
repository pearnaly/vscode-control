import * as path from 'node:path';
import type * as vscode from 'vscode';
import { formatZodError, openFileArgs, revealArgs, type CallRequest, type CallResponse } from '../../shared/protocol';
import { openFile } from './openFile';
import { revealInExplorer } from './revealInExplorer';

async function run(req: CallRequest): Promise<CallResponse> {
  switch (req.tool) {
    case 'open_file': {
      const args = openFileArgs.safeParse(req.args);
      if (!args.success) return { ok: false, error: `Invalid arguments: ${formatZodError(args.error)}` };
      // path.resolve drops "." and ".." segments, so they never reach Uri.file.
      return { ok: true, text: await openFile({ ...args.data, path: path.resolve(args.data.path) }) };
    }
    case 'reveal_in_explorer': {
      const args = revealArgs.safeParse(req.args);
      if (!args.success) return { ok: false, error: `Invalid arguments: ${formatZodError(args.error)}` };
      return { ok: true, text: await revealInExplorer({ ...args.data, path: path.resolve(args.data.path) }) };
    }
    default: {
      const unhandled: never = req.tool;
      throw new Error(`Unknown tool: ${String(unhandled)}`);
    }
  }
}

function pathOf(args: unknown): string {
  const p = typeof args === 'object' && args !== null ? (args as { path?: unknown }).path : undefined;
  return typeof p === 'string' ? p : '(no path)';
}

/** Runs one tool call. Every failure becomes { ok: false }; every call writes one log line. */
export async function dispatch(req: CallRequest, log: vscode.OutputChannel): Promise<CallResponse> {
  let res: CallResponse;
  try {
    res = await run(req);
  } catch (e) {
    res = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const outcome = res.ok ? 'ok' : `failed: ${res.error}`;
  log.appendLine(`${new Date().toISOString()} ${req.tool} ${pathOf(req.args)} ${outcome}`);
  return res;
}
