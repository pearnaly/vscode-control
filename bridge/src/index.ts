import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { windowsDir } from '../../shared/paths';
import { forgetWindow, readWindows } from './discovery';
import { callWindow } from './forward';
import type { HandleDeps } from './handle';
import { buildServer } from './mcpServer';
import { memoizeWithRetry } from './memoizeWithRetry';
import { ancestorsOf, readProcessTable } from './processTree';

// The process tree is read once per session, starting right away so the first call does not wait (~1 s).
// A failed read is logged to stderr and retried on the next call, at most twice in total; after that the
// folder and focus fallbacks apply.
const ancestors = memoizeWithRetry(
  () => readProcessTable().then((table) => ancestorsOf(process.pid, table)),
  2,
  (e) =>
    process.stderr.write(
      `vscode-control: reading the process tree failed (${e instanceof Error ? e.message : String(e)}); ` +
        'falling back to folder/focus matching\n',
    ),
);
void ancestors().catch(() => undefined); // prefetch; resolveWindow handles a failure, this only avoids an unhandled rejection at start-up

const deps: HandleDeps = {
  readWindows: () => readWindows(windowsDir()),
  ancestors,
  cwd: process.cwd(),
  callWindow: (win, req) => callWindow(win, req),
  forgetWindow: (win) => forgetWindow(windowsDir(), win.pid),
};

await buildServer(deps).connect(new StdioServerTransport());
