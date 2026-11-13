import { describe, expect, it } from 'vitest';
import { computeSelection, type RangeArgs } from '../../extension/src/range';

// A 4-line document whose lines are 10, 0, 22 and 5 characters long.
const lengths = [10, 0, 22, 5];
const sel = (args: RangeArgs) => computeSelection(args, lengths.length, (line) => lengths[line]!);

const LINES_4 = '(4 lines in VS Code)';

describe('computeSelection', () => {
  it('is undefined without a line', () => {
    expect(sel({})).toBeUndefined();
  });

  it('puts an empty selection (cursor) at line/column, converted to 0-based', () => {
    expect(sel({ line: 3, column: 9 })).toEqual({
      start: { line: 2, character: 8 }, end: { line: 2, character: 8 }, notes: [],
    });
  });

  it('defaults column to 1', () => {
    expect(sel({ line: 1 })?.start).toEqual({ line: 0, character: 0 });
  });

  it('selects whole lines when endColumn is missing', () => {
    expect(sel({ line: 1, endLine: 3 })).toEqual({
      start: { line: 0, character: 0 }, end: { line: 2, character: 22 }, notes: [],
    });
  });

  it('treats endColumn as inclusive', () => {
    // characters 9..20 (1-based) of line 3
    expect(sel({ line: 3, column: 9, endLine: 3, endColumn: 20 })).toEqual({
      start: { line: 2, character: 8 }, end: { line: 2, character: 20 }, notes: [],
    });
  });

  it('handles an empty line', () => {
    expect(sel({ line: 2, column: 3 })?.start).toEqual({ line: 1, character: 0 });
  });

  it('selects through the last character when endColumn equals the line length, without a note', () => {
    expect(sel({ line: 3, endLine: 3, endColumn: 22 })).toEqual({
      start: { line: 2, character: 0 }, end: { line: 2, character: 22 }, notes: [],
    });
  });

  it('accepts a column just after the last character (end of line) without a note', () => {
    expect(sel({ line: 1, column: 11 })).toEqual({
      start: { line: 0, character: 10 }, end: { line: 0, character: 10 }, notes: [],
    });
  });
});

describe('computeSelection clamping', () => {
  it('clamps a line past the end, uses column 1 and says so', () => {
    expect(sel({ line: 99 })).toEqual({
      start: { line: 3, character: 0 },
      end: { line: 3, character: 0 },
      notes: [`line 99 is past the end of the file ${LINES_4}, used 4`],
    });
  });

  it('ignores the column when the line was clamped, without a column note', () => {
    expect(sel({ line: 99, column: 3 })).toEqual({
      start: { line: 3, character: 0 },
      end: { line: 3, character: 0 },
      notes: [`line 99 is past the end of the file ${LINES_4}, used 4`],
    });
  });

  it('clamps endLine past the end to the end of the last line', () => {
    const s = sel({ line: 2, endLine: 50 });
    expect(s?.end).toEqual({ line: 3, character: 5 });
    expect(s?.notes).toEqual([`endLine 50 is past the end of the file ${LINES_4}, used 4`]);
  });

  it('clamps a column past the end of its line', () => {
    expect(sel({ line: 1, column: 40 })).toEqual({
      start: { line: 0, character: 10 },
      end: { line: 0, character: 10 },
      notes: ['column 40 is past the end of line 1 (10 characters), used 11 (end of line)'],
    });
  });

  it('clamps endColumn past the end of its line', () => {
    const s = sel({ line: 4, endLine: 4, endColumn: 9 });
    expect(s?.end).toEqual({ line: 3, character: 5 });
    expect(s?.notes).toEqual(['endColumn 9 is past the end of line 4 (5 characters), selected to the end of the line']);
  });

  it('ignores endColumn when endLine was clamped, so the end never lies before the start', () => {
    expect(sel({ line: 4, column: 5, endLine: 5, endColumn: 2 })).toEqual({
      start: { line: 3, character: 4 },
      end: { line: 3, character: 5 },
      notes: [
        `endLine 5 is past the end of the file ${LINES_4}, used 4`,
        'endColumn 2 ignored, selected to the end of the file',
      ],
    });
  });

  it('clamps line, endLine and endColumn together', () => {
    expect(sel({ line: 99, column: 3, endLine: 120, endColumn: 1 })).toEqual({
      start: { line: 3, character: 0 },
      end: { line: 3, character: 5 },
      notes: [
        `line 99 is past the end of the file ${LINES_4}, used 4`,
        `endLine 120 is past the end of the file ${LINES_4}, used 4`,
        'endColumn 1 ignored, selected to the end of the file',
      ],
    });
  });

  it('ignores endColumn when endLine was clamped, starting mid-document', () => {
    expect(sel({ line: 2, endLine: 50, endColumn: 3 })).toEqual({
      start: { line: 1, character: 0 },
      end: { line: 3, character: 5 },
      notes: [
        `endLine 50 is past the end of the file ${LINES_4}, used 4`,
        'endColumn 3 ignored, selected to the end of the file',
      ],
    });
  });
});

describe('computeSelection on tiny documents', () => {
  it('treats a line count of 0 as one line and says "1 line"', () => {
    expect(computeSelection({ line: 5 }, 0, () => 0)).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
      notes: ['line 5 is past the end of the file (1 line in VS Code), used 1'],
    });
  });

  it('handles a one-line empty document', () => {
    expect(computeSelection({ line: 1 }, 1, () => 0)).toEqual({
      start: { line: 0, character: 0 }, end: { line: 0, character: 0 }, notes: [],
    });
    expect(computeSelection({ line: 1, column: 3 }, 1, () => 0)).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
      notes: ['column 3 is past the end of line 1 (0 characters), used 1 (end of line)'],
    });
  });

  it('says "1 character" for a one-character line', () => {
    expect(computeSelection({ line: 1, column: 5 }, 1, () => 1)?.notes)
      .toEqual(['column 5 is past the end of line 1 (1 character), used 2 (end of line)']);
    expect(computeSelection({ line: 1, endLine: 1, endColumn: 4 }, 1, () => 1)?.notes)
      .toEqual(['endColumn 4 is past the end of line 1 (1 character), selected to the end of the line']);
  });

  it('selects to the end of a one-line empty document when endLine is clamped', () => {
    expect(computeSelection({ line: 1, endLine: 9 }, 1, () => 0)).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
      notes: ['endLine 9 is past the end of the file (1 line in VS Code), used 1'],
    });
  });
});
