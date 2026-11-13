import * as vscode from 'vscode';

/** Throws a readable error unless `p` exists, and is a file when `kind` is 'file'. */
export async function assertExists(p: string, kind: 'file' | 'any'): Promise<void> {
  let stat: vscode.FileStat;
  try {
    stat = await vscode.workspace.fs.stat(vscode.Uri.file(p));
  } catch (e) {
    if (e instanceof vscode.FileSystemError && e.code === 'FileNotFound') throw new Error(`Not found: ${p}`);
    // e.g. a UNC path VS Code blocks, or missing permission
    throw new Error(`Cannot access ${p}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (kind === 'file' && (stat.type & vscode.FileType.Directory) !== 0) {
    throw new Error(`${p} is a folder; open_file needs a file (use reveal_in_explorer for folders).`);
  }
}
