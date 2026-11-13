import * as vscode from 'vscode';

/** Absolute paths of the window's local workspace folders. */
export function workspaceFolderPaths(): string[] {
  return (vscode.workspace.workspaceFolders ?? [])
    .filter((folder) => folder.uri.scheme === 'file')
    .map((folder) => folder.uri.fsPath);
}

/** Name shown in tool results, e.g. "my-project (Workspace)". */
export function windowName(): string {
  return vscode.workspace.name ?? 'untitled window';
}
