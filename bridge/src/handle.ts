import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  formatZodError,
  openFileArgs,
  revealArgs,
  type CallRequest,
  type ToolName,
  type WindowRecord,
} from '../../shared/protocol';
import type { WindowAnswer } from './forward';
import { resolveWindow, type Resolved, type Via } from './resolveWindow';

export const NO_WINDOW = 'No VS Code window with vscode-control is running (extension installed? window reloaded?)';

export interface HandleDeps {
  readWindows: () => Promise<WindowRecord[]>;
  ancestors: () => Promise<number[]>;
  cwd: string;
  callWindow: (win: WindowRecord, req: CallRequest) => Promise<WindowAnswer>;
  /** Deletes the discovery file of a window that refused the connection. */
  forgetWindow: (win: WindowRecord) => Promise<void>;
}

const VIA_NOTE: Record<Via, string> = {
  process: '',
  folder: ' [window chosen by folder match]',
  recent: ' [window chosen by last focus]',
};

function result(text: string, isError = false): CallToolResult {
  return isError ? { content: [{ type: 'text', text }], isError: true } : { content: [{ type: 'text', text }] };
}

/** Validates the arguments, picks the window, forwards the call and turns the answer into an MCP result. */
export async function handleTool(tool: ToolName, rawArgs: unknown, deps: HandleDeps): Promise<CallToolResult> {
  const parsed = tool === 'open_file' ? openFileArgs.safeParse(rawArgs) : revealArgs.safeParse(rawArgs);
  if (!parsed.success) return result(`Invalid arguments: ${formatZodError(parsed.error)}`, true);

  const call = async (windows: WindowRecord[]): Promise<{ target: Resolved; res: WindowAnswer } | undefined> => {
    const target = await resolveWindow(windows, deps.ancestors, deps.cwd);
    if (target === undefined) return undefined;
    return { target, res: await deps.callWindow(target.window, { tool, args: parsed.data }) };
  };

  let windows: WindowRecord[];
  try {
    windows = await deps.readWindows();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return result(`Cannot read the vscode-control discovery directory: ${reason}`, true);
  }
  let outcome = await call(windows);
  if (outcome?.res.unreachable && !outcome.res.ok) {
    const { window: refusing, via } = outcome.target;
    if (via === 'process') {
      // The session's own window (its extension host is our ancestor, so it is alive) refuses connections:
      // its server is down or restarting. Its discovery file is not stale, and acting in another window would
      // show the user somebody else's screen. Report and leave it alone.
      // The forwarded error ends in "; reload that window." — the note continues that sentence.
      return result(
        `${outcome.res.error.replace(/\.$/, '')} (this also restarts the Claude session running in it).`,
        true,
      );
    }
    // A window picked by fallback that refuses connections is most likely stale: its discovery file outlived a
    // crash and its pid was reused. Forget it and try once more with the remaining windows.
    await deps.forgetWindow(refusing);
    outcome = await call(windows.filter((w) => w.pid !== refusing.pid));
    if (outcome === undefined) {
      return result(`${NO_WINDOW} (window "${refusing.windowName}" refused the connection and was forgotten)`, true);
    }
  }
  if (outcome === undefined) return result(NO_WINDOW, true);

  const { target, res } = outcome;
  const note = VIA_NOTE[target.via];
  return res.ok ? result(res.text + note) : result(res.error + note, true);
}
