import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { windowsDir } from '../../shared/paths';
import { forgetWindow, readWindows } from './discovery';
import { callWindow } from './forward';
import type { HandleDeps } from './handle';
import { buildServer } from './mcpServer';
import { memoizeWithRetry } from './memoizeWithRetry';
import { readProcessTable } from './processTree';

// The process table is read once per session, starting right away so the first call does not wait (~1 s).
// A failed read is logged to stderr and retried on the next call, at most twice in total; after that there is
// no stale check and no ancestry match, and the folder and focus fallbacks apply.
const snapshot = memoizeWithRetry(readProcessTable, 2, (e) =>
  process.stderr.write(
    `vscode-control: reading the process tree failed (${e instanceof Error ? e.message : String(e)}); ` +
      'falling back to folder/focus matching\n',
  ),
);
void snapshot().catch(() => undefined); // prefetch; handleTool handles a failure, this only avoids an unhandled rejection at start-up

const deps: HandleDeps = {
  readWindows: () => readWindows(windowsDir()),
  snapshot,
  selfPid: process.pid,
  cwd: process.cwd(),
  callWindow: (win, req) => callWindow(win, req),
  // Deletes the file only if it still holds the token that was judged (a new window may have reused the pid).
  forgetWindow: (win) => forgetWindow(windowsDir(), win.pid, win.token),
  log: (line) => {
    process.stderr.write(`${line}\n`);
  },
};

await buildServer(deps).connect(new StdioServerTransport());
