# vscode-control

Lets Claude Code open files (at a line, beside the chat) and reveal them in the Explorer of this window.
Each window serves a token-protected endpoint on 127.0.0.1 and advertises it in
`~/.vscode-control/windows/<pid>.json`; the MCP bridge in the same repository finds the window and calls it.
Logs: Output panel → "vscode-control". Full documentation: the repository README.
