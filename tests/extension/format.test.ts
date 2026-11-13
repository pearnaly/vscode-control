import { describe, expect, it } from 'vitest';
import { formatOpenResult, formatRevealResult } from '../../extension/src/format';
import type { Selection0 } from '../../extension/src/range';

const sel = (sl: number, sc: number, el: number, ec: number, notes: string[] = []): Selection0 => ({
  start: { line: sl, character: sc }, end: { line: el, character: ec }, notes,
});

describe('formatOpenResult', () => {
  it('without a selection', () => {
    expect(formatOpenResult({ display: 'src\\a.ts', viewColumn: 2, windowName: 'my-project' }))
      .toBe('Opened src\\a.ts in group 2 (window: my-project)');
  });

  it('with a cursor', () => {
    expect(formatOpenResult({ display: 'a.ts', selection: sel(41, 0, 41, 0), viewColumn: 2, windowName: 'W' }))
      .toBe('Opened a.ts at line 42 in group 2 (window: W)');
  });

  it('with a selection inside one line, names the 1-based inclusive columns', () => {
    expect(formatOpenResult({ display: '.env', selection: sel(2, 8, 2, 20), viewColumn: 2, windowName: 'W' }))
      .toBe('Opened .env line 3, columns 9–20 in group 2 (window: W)');
  });

  it('with a one-character selection, names the single column', () => {
    expect(formatOpenResult({ display: 'a.ts', selection: sel(2, 8, 2, 9), viewColumn: 2, windowName: 'W' }))
      .toBe('Opened a.ts line 3, column 9 in group 2 (window: W)');
  });

  it('with a whole-line selection', () => {
    expect(formatOpenResult({ display: 'a.ts', selection: sel(3, 0, 3, 22), viewColumn: 2, windowName: 'W' }))
      .toBe('Opened a.ts line 4, columns 1–22 in group 2 (window: W)');
  });

  it('with a multi-line selection', () => {
    expect(formatOpenResult({ display: 'a.ts', selection: sel(41, 0, 56, 10), viewColumn: 2, windowName: 'W' }))
      .toBe('Opened a.ts lines 42–57 in group 2 (window: W)');
  });

  it('with clamp notes', () => {
    const s = sel(3, 0, 3, 0, ['line 99 is past the end of the file (4 lines in VS Code), used 4']);
    expect(formatOpenResult({ display: 'a.ts', selection: s, viewColumn: 2, windowName: 'W' }))
      .toBe('Opened a.ts at line 4 in group 2 (window: W). Note: line 99 is past the end of the file (4 lines in VS Code), used 4.');
  });

  it('joins several notes with semicolons', () => {
    const s = sel(3, 0, 3, 5, [
      'endLine 5 is past the end of the file (4 lines in VS Code), used 4',
      'endColumn 2 ignored, selected to the end of the file',
    ]);
    expect(formatOpenResult({ display: 'a.ts', selection: s, viewColumn: 2, windowName: 'W' })).toBe(
      'Opened a.ts line 4, columns 1–5 in group 2 (window: W). ' +
      'Note: endLine 5 is past the end of the file (4 lines in VS Code), used 4; ' +
      'endColumn 2 ignored, selected to the end of the file.',
    );
  });

  it('without a known group', () => {
    expect(formatOpenResult({ display: 'a.ts', windowName: 'W' })).toBe('Opened a.ts (window: W)');
  });
});

describe('formatRevealResult', () => {
  it('names the item and the window', () => {
    expect(formatRevealResult('docs\\spec.md', 'my-project')).toBe('Revealed docs\\spec.md in the Explorer (window: my-project)');
  });
});
