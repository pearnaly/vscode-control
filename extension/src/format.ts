import type { Selection0 } from './range';

function location(selection: Selection0 | undefined): string {
  if (selection === undefined) return '';
  const { start, end } = selection;
  const first = start.line + 1;
  const last = end.line + 1;
  if (first === last) {
    if (start.character === end.character) return ` at line ${first}`;
    // 1-based, inclusive: character 8..20 (0-based, end exclusive) is columns 9–20.
    if (end.character - start.character === 1) return ` line ${first}, column ${end.character}`;
    return ` line ${first}, columns ${start.character + 1}–${end.character}`;
  }
  return ` lines ${first}–${last}`;
}

export interface OpenResult {
  display: string;
  selection?: Selection0;
  viewColumn?: number;
  windowName: string;
}

/** e.g. "Opened src\a.ts lines 42–57 in group 2 (window: my-project)". */
export function formatOpenResult(r: OpenResult): string {
  const group = r.viewColumn === undefined ? '' : ` in group ${r.viewColumn}`;
  const notes =
    r.selection !== undefined && r.selection.notes.length > 0 ? `. Note: ${r.selection.notes.join('; ')}.` : '';
  return `Opened ${r.display}${location(r.selection)}${group} (window: ${r.windowName})${notes}`;
}

/** e.g. "Revealed docs\spec.md in the Explorer (window: my-project)". */
export function formatRevealResult(display: string, windowName: string): string {
  return `Revealed ${display} in the Explorer (window: ${windowName})`;
}
