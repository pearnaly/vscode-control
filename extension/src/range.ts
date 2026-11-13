import type { OpenFileArgs } from '../../shared/protocol';

/** 0-based position, as VS Code uses internally. */
export interface Pos {
  line: number;
  character: number;
}

/** 0-based selection plus a human-readable note for every clamp applied. */
export interface Selection0 {
  start: Pos;
  end: Pos;
  notes: string[];
}

/** The 1-based position arguments of open_file. */
export type RangeArgs = Pick<OpenFileArgs, 'line' | 'column' | 'endLine' | 'endColumn'>;

/**
 * Converts open_file's 1-based arguments into a 0-based selection clamped to the document.
 * Returns undefined when no line is given.
 *
 * Precondition: `args` were already validated by `openFileArgs` (positive integers, `column` needs
 * `line`, `endLine >= line`, `endColumn >= column` on one line); this function only clamps to the
 * document, and does so such that start <= end always holds.
 *
 * - `endColumn` is inclusive; without it the selection runs to the end of `endLine`.
 * - A `line` past the end uses the last line, column 1 (the column is meaningless there).
 * - An `endLine` past the end selects to the end of the file and ignores `endColumn`.
 * - Columns count UTF-16 code units, like VS Code's `Position.character` (a tab counts 1, most emoji 2).
 */
export function computeSelection(
  args: RangeArgs,
  lineCount: number,
  lineLength: (line0: number) => number,
): Selection0 | undefined {
  if (args.line === undefined) return undefined;
  const notes: string[] = [];
  const lastLine = Math.max(lineCount, 1);
  const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;
  // Notes are joined with "; " by the formatter, so they use ", " inside.
  const pastEnd = (name: string, value: number): string =>
    `${name} ${value} is past the end of the file (${count(lastLine, 'line')} in VS Code), used ${lastLine}`;

  let startLine = args.line;
  let column = args.column ?? 1;
  if (startLine > lastLine) {
    notes.push(pastEnd('line', startLine));
    startLine = lastLine;
    column = 1;
  } else {
    const startLength = lineLength(startLine - 1);
    if (column > startLength + 1) {
      notes.push(
        `column ${column} is past the end of line ${startLine} (${count(startLength, 'character')}), used ${startLength + 1} (end of line)`,
      );
      column = startLength + 1;
    }
  }
  const start: Pos = { line: startLine - 1, character: column - 1 };
  if (args.endLine === undefined) return { start, end: { ...start }, notes };

  if (args.endLine > lastLine) {
    notes.push(pastEnd('endLine', args.endLine));
    if (args.endColumn !== undefined) {
      notes.push(`endColumn ${args.endColumn} ignored, selected to the end of the file`);
    }
    return { start, end: { line: lastLine - 1, character: lineLength(lastLine - 1) }, notes };
  }

  const endLength = lineLength(args.endLine - 1);
  let endCharacter = endLength;
  if (args.endColumn !== undefined) {
    if (args.endColumn > endLength) {
      notes.push(
        `endColumn ${args.endColumn} is past the end of line ${args.endLine} (${count(endLength, 'character')}), selected to the end of the line`,
      );
    } else {
      endCharacter = args.endColumn;
    }
  }
  return { start, end: { line: args.endLine - 1, character: endCharacter }, notes };
}
