import * as vscode from 'vscode';
import { displayPath } from '../../shared/paths';
import type { OpenFileArgs } from '../../shared/protocol';
import { formatOpenResult } from './format';
import { assertExists } from './fsCheck';
import { isClaudeChatViewType, resolveTarget, type GroupInfo, type Target } from './layout';
import { computeSelection } from './range';
import { windowName, workspaceFolderPaths } from './windowInfo';

function currentLayout(): GroupInfo[] {
  return vscode.window.tabGroups.all.map((group) => ({
    viewColumn: group.viewColumn,
    isActive: group.isActive,
    tabs: group.tabs.map((tab) => ({
      isActive: tab.isActive,
      isClaudeChat: tab.input instanceof vscode.TabInputWebview && isClaudeChatViewType(tab.input.viewType),
    })),
  }));
}

function toViewColumn(target: Target): vscode.ViewColumn {
  switch (target.kind) {
    case 'column':
      return target.column as vscode.ViewColumn;
    case 'active':
      return vscode.ViewColumn.Active;
    case 'beside':
      return vscode.ViewColumn.Beside;
  }
}

export async function openFile(args: OpenFileArgs): Promise<string> {
  await assertExists(args.path, 'file');
  let doc: vscode.TextDocument;
  try {
    doc = await vscode.workspace.openTextDocument(vscode.Uri.file(args.path));
  } catch (e) {
    throw new Error(`Cannot open ${args.path} as text: ${e instanceof Error ? e.message : String(e)}`);
  }

  const selection = computeSelection(args, doc.lineCount, (line) => doc.lineAt(line).text.length);
  const range =
    selection &&
    new vscode.Range(selection.start.line, selection.start.character, selection.end.line, selection.end.character);
  const editor = await vscode.window.showTextDocument(doc, {
    viewColumn: toViewColumn(resolveTarget(args.group ?? 'beside', currentLayout())),
    preserveFocus: !(args.focus ?? false),
    preview: args.preview ?? false,
    selection: range,
  });
  if (range) editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

  return formatOpenResult({
    display: displayPath(args.path, workspaceFolderPaths()),
    selection,
    viewColumn: editor.viewColumn,
    windowName: windowName(),
  });
}
