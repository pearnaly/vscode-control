import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { windowsDir } from '../../shared/paths';
import { dispatch } from './dispatch';
import { Registry } from './registry';
import { startServer } from './server';
import { windowName, workspaceFolderPaths } from './windowInfo';

let cleanup: (() => Promise<void>) | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = vscode.window.createOutputChannel('vscode-control');
  context.subscriptions.push(log);

  const token = randomBytes(32).toString('hex');
  const server = await startServer(
    token,
    (req) => dispatch(req, log),
    (e) => log.appendLine(`server error: ${e instanceof Error ? e.message : String(e)}`),
  );
  // process.pid is this window's extension host: the ancestor the bridge looks for.
  const registry = new Registry(windowsDir(), process.pid);

  // Idempotent teardown, registered before anything else can throw: after it ran nothing rewrites the
  // discovery file, and the server is closed even when a later step of activate fails.
  let stopped = false;
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopped = true;
    stopping ??= (async () => {
      registry.remove(); // best effort, never throws
      await server.close();
    })();
    return stopping;
  };
  context.subscriptions.push({ dispose: () => void stop() });
  cleanup = stop;

  let wasFocused = vscode.window.state.focused;
  let lastFocusedAt = wasFocused ? Date.now() : 0;

  /** Writes the discovery file; false (and a log line) when that fails or the window is shutting down. */
  const publish = (): boolean => {
    if (stopped) return false;
    try {
      registry.write({
        pid: process.pid,
        port: server.port,
        token,
        workspaceFolders: workspaceFolderPaths(),
        windowName: windowName(),
        lastFocusedAt,
      });
      return true;
    } catch (e) {
      log.appendLine(`could not write ${registry.file}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  };
  const registered = publish();
  if (!registered) {
    // Not awaited: the promise settles only when the notification is dismissed.
    void vscode.window.showWarningMessage(
      'vscode-control: could not register this window, so Claude cannot reach it. See Output → vscode-control.',
    );
  }

  context.subscriptions.push(
    // Also fires when the window becomes active or idle; only a focus gain counts as "last focused".
    vscode.window.onDidChangeWindowState((state) => {
      const gainedFocus = state.focused && !wasFocused;
      wasFocused = state.focused;
      if (gainedFocus) {
        lastFocusedAt = Date.now();
        publish();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => publish()),
  );

  log.appendLine(
    `vscode-control ${context.extension.packageJSON.version}: listening on 127.0.0.1:${server.port}; ` +
      (registered ? `registered ${registry.file}` : 'registration failed'),
  );
}

export async function deactivate(): Promise<void> {
  await cleanup?.();
  cleanup = undefined;
}
