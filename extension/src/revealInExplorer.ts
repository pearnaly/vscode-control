import * as vscode from 'vscode';
import { containingFolder, displayPath } from '../../shared/paths';
import type { RevealArgs } from '../../shared/protocol';
import { formatRevealResult } from './format';
import { assertExists } from './fsCheck';
import { windowName, workspaceFolderPaths } from './windowInfo';

export async function revealInExplorer(args: RevealArgs): Promise<string> {
  await assertExists(args.path, 'any');
  const folders = workspaceFolderPaths();
  if (containingFolder(args.path, folders) === undefined) {
    const list = folders.length > 0 ? folders.join(', ') : 'no folder is open';
    throw new Error(
      `${args.path} is outside this window's workspace (${list}); the Explorer can only show items inside it.`,
    );
  }
  await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(args.path));
  // revealInExplorer moves keyboard focus to the Explorer; hand it back to the editor area (the chat tab).
  if (!(args.focus ?? false)) await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
  return formatRevealResult(displayPath(args.path, folders), windowName());
}
