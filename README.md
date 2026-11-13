# vscode-control

Two MCP tools that let Claude Code act in the VS Code window it runs in:

- `open_file` — open a file beside the Claude chat (or in a given editor group) at a line, optionally selecting a
  range; keyboard focus stays in the chat unless `focus: true` (e.g. for typing a secret).
- `reveal_in_explorer` — show a file or folder in the Explorer side panel.

It consists of a VS Code extension (`extension/`) and a stdio MCP bridge (`bridge/`) that Claude Code starts.
Both are built from this repository.

## Requirements

- VS Code 1.95 or newer. Local windows and Remote-SSH windows work; WSL and dev-container windows are untested. In a
  Remote-SSH window the extension and Claude Code both run on the remote host, so install the extension there; the
  bridge, the `claude mcp add` registration and Node.js live on the remote host too.
- Node.js 22.12 or newer: it runs the bridge and builds the project.
- Claude Code, with its VS Code extension. "Beside the chat" means beside that extension's chat tab; when the chat
  is not an editor tab, VS Code's own "beside" is used.
- To follow the install steps below: npm, and the `code` and `claude` commands on your `PATH`.

## Platform status

Developed and tested on Windows 11. Linux works: it was run through Remote-SSH, and the test suite passes there.
macOS is untested and should work the same way as Linux. On Linux and macOS the bridge reads the process table with
`ps` instead of PowerShell. It starts `ps` by absolute path (`/bin/ps` or `/usr/bin/ps`), from `/` as the working
directory, and fails if neither exists. `ps` reports no creation times, so the creation-time check in the ancestor
walk (see Security) does not apply there, and neither does the start-time check for stale discovery files (also
see Security): both run on Windows only.

"Beside the chat" finds the chat through the Claude Code chat tab's internal view type, `claudeVSCodePanel`. That
name is not a public interface and may change; if it does, `open_file` falls back to VS Code's own "beside".

## How it works

```
Claude Code ──stdio MCP──▶ bridge (one per session) ──HTTP + bearer token──▶ extension (one per window) ──▶ VS Code API
```

- The **extension** (`extension/`) starts in every VS Code window, listens on `127.0.0.1:<random port>` with a
  random 32-byte token, and writes `~/.vscode-control/windows/<extension-host-pid>.json` (on Windows
  `%USERPROFILE%\.vscode-control\windows\`) with the port, token, workspace folders, window name, last focus and
  the extension host's start time (`startedAt`, used by the stale-file check on Windows, see Security).
  The file is removed when the window closes.
- The **bridge** (`bridge/`) is a stdio MCP server that Claude Code starts per session. It picks the window whose
  extension host is an ancestor of the bridge process (that is the window running the Claude session), else the
  window whose workspace contains the session folder, else the most recently focused window. Results end with
  `[window chosen by folder match]` or `[window chosen by last focus]` when a fallback was used. Claude in an
  external or the integrated terminal is always matched by that fallback: integrated-terminal shells hang off VS
  Code's shared pty host, not the extension host, so the label is expected there.
- Register the bridge as a plain stdio server, not behind a shared MCP gateway: it identifies the window through its
  own process ancestry, so a bridge that is not a descendant of the Claude session can only use the folder and focus
  fallbacks.
- In a **Remote-SSH** window the extension runs in the remote extension host (it declares
  `"extensionKind": ["workspace"]`), the same host where Claude Code starts its sessions, so the ancestry match works
  there too. The discovery files are then in the remote host's home directory.

## Install / update

Build, package and install the extension from source. With Remote-SSH, do all of this on the remote host (see
Requirements).

```powershell
npm install
npm run build
npm test
npm run package             # → vscode-control.vsix
npm run install-extension   # code --install-extension vscode-control.vsix --force
```

Then register the bridge with Claude Code:

```
claude mcp add --scope user vscode -- "<absolute path to node>" "<repo>/bridge/dist/index.js"
```

On Windows, for example:

```
claude mcp add --scope user vscode -- "C:\Program Files\nodejs\node.exe" "C:\path\to\vscode-control\bridge\dist\index.js"
```

`node` has to be an absolute path because the session's working directory may be an untrusted repository, and a
bare `node` could be resolved from there. After the first registration, running Claude sessions only see the tools
after `/mcp` or in a new session.

After an extension update VS Code may ask to reload the window. Reloading restarts the extension host, which ends
Claude sessions running in that window; resume them afterwards. After a bridge update, new Claude sessions pick it
up; running sessions keep the old one until `/mcp` → reconnect.

## Check it

```powershell
npm run smoke                                         # list tools, open README.md 1–3, reveal README.md
node scripts/smoke.mjs open_file '{"path":"C:\\...\\file.ts","line":10,"endLine":20,"group":"beside"}'
```

(PowerShell 7.3+ or Git Bash; in Windows PowerShell 5.1 escape each inner double quote with a backslash, e.g. `{\"path\":\"C:\\...\"}`)

Manual checklist (after install):

1. Walkthrough: `open_file` with `line`/`endLine` → file opens beside the chat with the block selected; you can keep
   typing in the chat.
2. Secret: create a file with a placeholder; `open_file` with `focus: true` and the placeholder selected → the cursor
   is in the file and typing replaces the placeholder.
3. `reveal_in_explorer` → the Explorer shows and selects the item; focus returns to the chat.
4. `reveal_in_explorer` with `focus: true` → focus stays in the Explorer.
5. Two windows open → calls act in the window running the Claude session.
6. Claude in an external or the integrated terminal → result says `[window chosen by folder match]` or `[window chosen by last focus]`.

## How Claude is told to use it

The server instructions sent with the MCP handshake and the two tool descriptions (`bridge/src/descriptions.ts`)
encode a usage policy:

- **On request:** when you ask to see code or to find something, Claude opens the file or reveals it in the Explorer.
- **Walkthroughs:** for a guided tour of an implementation, Claude opens each relevant file in turn with the relevant
  block selected (`line`/`endLine`) and leaves focus in the chat.
- **Secret entry:** Claude creates a file with a placeholder in a place that is neither committed nor synced (outside
  any cloud-synced folder, and gitignored or outside any repository), opens it with `focus: true` and the placeholder
  selected, waits until you say you are done, and never reopens that file with a selection.
- **On its own initiative:** sparingly, at most the main file of a finished task.

## Security

- **Local only.** The extension's HTTP server listens on `127.0.0.1` on a random free port. It answers only
  `POST /call`, everything else gets 404, and request bodies over 64 KB are refused.
- **A token per window.** Each activation of the extension generates a 32-byte random token. A request without the
  matching `Authorization: Bearer` header gets 401 before its body is read; the comparison is constant-time.
- **Discovery files stay in your user profile.** `~/.vscode-control/windows/<pid>.json` holds the port and token. On
  macOS and Linux the directory is created with mode 0700 and the files with 0600; on Windows the user-profile ACL
  protects them. The extension deletes its file when the window closes, and the bridge deletes the files of dead
  processes.
- **Two fixed operations.** The server accepts only `open_file` and `reveal_in_explorer`, with strictly validated
  arguments. The extension executes no command line and starts no process; the only VS Code commands it invokes are
  `revealInExplorer` and `workbench.action.focusActiveEditorGroup`.
- **`open_file` accepts any absolute path, on purpose.** The secret-entry flow needs files outside the workspace,
  and the only caller is your own Claude session, which can normally read those files anyway. The tool returns a
  one-line status (what was opened, where, in which window), never file content. `reveal_in_explorer` is limited to
  the window's workspace folders. Caveat: if you rely on Claude Code permission rules (for example a `Read` deny for
  `~/.ssh`) to keep files away from Claude, `open_file` can still open such a file and select text in it, and Claude
  Code's VS Code integration shares the editor's selected text with Claude. So treat `open_file` as able to read any
  file the VS Code user can read, or do not register it in setups that depend on such rules.
- **Network paths only inside the workspace.** Network (UNC) paths such as `\\server\share\file` are only opened or
  revealed inside the window's workspace folders. Anywhere else the call is refused before any file-system access,
  because Windows would connect to that host and send your credentials. VS Code's own `security.allowedUNCHosts`
  restriction applies as well.
- **PowerShell by absolute path.** On Windows the bridge reads the process table with
  `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` and starts it with its own directory as the working
  directory, so nothing planted in the session's folder, which may be an untrusted repository, is executed or loaded.
- **Ancestry needs name = pid.** A discovery file counts only if its name is exactly `<pid>.json` for the pid it
  contains, so a file cannot claim a window's pid under another name. The ancestor walk also stops at a parent that
  is gone or was created after its child, because Windows can reuse the pid of a dead parent.
- **Stale discovery files.** After a crash a window's file stays behind, and its pid may be reused. Files of dead
  pids are deleted whenever a bridge reads the folder. On Windows, which reuses pids much sooner than Linux, the
  extension also records when its process started (`startedAt`, since 0.2.0) and the bridge compares it with the
  creation time in the OS process table. A file whose pid now belongs to a process started after that window is
  deleted and never contacted (when the bridge could read the process table). A file whose process was not
  running when the session started is ignored for the session but not deleted, because that verdict rests on the
  window's own clock. Linux and macOS hand out pids sequentially, so reuse needs a wrap-around; there, and for
  files written by 0.1.x, a refused connection still makes the bridge forget the file and retry once with the next
  window. Not covered: a window that crashes after the bridge read the process table (once per session) and whose
  pid is reused within that session.

## Troubleshooting

- "No VS Code window with vscode-control is running": the extension is not installed or not activated in any
  window. Check the Extensions view, then the Output panel → "vscode-control" (first line: extension version,
  listening port and discovery file).
- "Token rejected": reload that window.
- "Could not reach" the session's own window: the extension there is not answering; reload that window (this also
  restarts the Claude sessions running in it).
- Wrong window: look at the `[window chosen by …]` suffix; the discovery files in `~/.vscode-control/windows/`
  (on Windows `%USERPROFILE%\.vscode-control\windows\`) show what each window advertises.
- A window picked by a fallback (folder match or last focus) that refuses connections (crashed, its discovery
  file left behind) is forgotten automatically and the call is retried once with the next window. The session's
  own window is never forgotten or replaced: if it refuses, the error says so; reload it (which also restarts the
  Claude session running in it).
- A window is missing, or a discovery file has disappeared: the bridge writes one line to its stderr (which
  Claude Code keeps in its MCP server logs) when it skips a file. `vscode-control: ignored stale discovery file <pid>.json
  (its pid now belongs to a newer process)` means the window had crashed and its pid was reused; the file was
  deleted. `vscode-control: ignored discovery file <pid>.json (its process was not running when this session
  started; not deleted)` means the file was only left out of that session's calls; if the window is alive, reload
  it so it writes a fresh file, or start a new Claude session.

## Uninstall

1. `code --uninstall-extension pearnaly.vscode-control`
2. `claude mcp remove --scope user vscode`
3. Delete the folder `~/.vscode-control` (on Windows `%USERPROFILE%\.vscode-control`), which holds the discovery files.

## Limitations

- `open_file` opens text only: binary files and files over 50 MB fail with a clear message.
- `reveal_in_explorer` works only inside the window's workspace folders, and cannot show items hidden by
  `files.exclude` or `explorer.excludeGitIgnore`.
- After a reveal without `focus`, focus goes back to the active editor group: the chat only when the chat is an
  editor tab.
- Secrets: Claude Code shares the editor's selected text with the chat. After typing a secret, never select it, and
  Claude must never reopen that file with a selection.
- Secrets: VS Code's Local History (on Windows `%APPDATA%\Code\User\History`, elsewhere the equivalent folder in
  VS Code's user data) keeps a copy of a saved secret file. Delete that entry too, or exclude the secret folder with
  `workbench.localHistory.exclude`.
- WSL and dev-container windows are untested (Remote-SSH works, see Requirements).

## Development

`npm test` (vitest), `npm run typecheck`, `npm run build` (esbuild: `extension/dist/extension.js` CJS,
`bridge/dist/index.js` ESM). Only the pure modules are unit-tested; files importing `vscode` are checked by the
smoke script and the manual checklist. `npm run package` copies the root `LICENSE` to `extension/LICENSE` (a generated,
git-ignored copy) because `vsce` looks for it next to the extension manifest.

## License

MIT, see [LICENSE](LICENSE).
