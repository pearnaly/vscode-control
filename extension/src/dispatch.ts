import * as path from 'node:path';
import type * as vscode from 'vscode';
import { outsideWorkspaceUncError } from '../../shared/paths';
import { formatZodError, openFileArgs, revealArgs, type CallRequest, type CallResponse } from '../../shared/protocol';
import { openFile } from './openFile';
import { revealInExplorer } from './revealInExplorer';
import { workspaceFolderPaths } from './windowInfo';

async function run(req: CallRequest): Promise<CallResponse> {
  switch (req.tool) {
    case 'open_file': {
      const args = openFileArgs.safeParse(req.args);
      if (!args.success) return { ok: false, error: `Invalid arguments: ${formatZodError(args.error)}` };
      // path.resolve drops "." and ".." segments, so they never reach Uri.file.
      const resolved = path.resolve(args.data.path);
      // Before any stat or open: touching a UNC path outside the workspace sends the user's credentials to its host.
      const uncError = outsideWorkspaceUncError(resolved, workspaceFolderPaths());
      if (uncError !== undefined) return { ok: false, error: uncError };
      return { ok: true, text: await openFile({ ...args.data, path: resolved }) };
    }
    case 'reveal_in_explorer': {
      const args = revealArgs.safeParse(req.args);
      if (!args.success) return { ok: false, error: `Invalid arguments: ${formatZodError(args.error)}` };
      const resolved = path.resolve(args.data.path);
      const uncError = outsideWorkspaceUncError(resolved, workspaceFolderPaths());
      if (uncError !== undefined) return { ok: false, error: uncError };
      return { ok: true, text: await revealInExplorer({ ...args.data, path: resolved }) };
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
