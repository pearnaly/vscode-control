import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  callRequestSchema,
  callResponseSchema,
  formatZodError,
  openFileArgs,
  openFileObject,
  openFileShape,
  revealArgs,
  windowRecordSchema,
} from '../../shared/protocol';

const file = path.resolve(os.tmpdir(), 'a.ts');

function errorText(input: unknown): string {
  const r = openFileArgs.safeParse(input);
  if (r.success) throw new Error('expected a validation error');
  return formatZodError(r.error);
}

describe('openFileArgs', () => {
  it('accepts a minimal call', () => {
    expect(openFileArgs.safeParse({ path: file }).success).toBe(true);
  });

  it('accepts a full call', () => {
    const r = openFileArgs.safeParse({
      path: file, line: 3, column: 9, endLine: 3, endColumn: 20, group: 2, focus: true, preview: true,
    });
    expect(r.success).toBe(true);
  });

  it.each(['beside', 'active', 1, 9])('accepts group %s', (group) => {
    expect(openFileArgs.safeParse({ path: file, group }).success).toBe(true);
  });

  it.each([0, 10, 'left', 1.5])('rejects group %s with a readable message', (group) => {
    expect(errorText({ path: file, group })).toBe('group: must be "beside", "active" or an integer 1-9');
  });

  it('rejects a relative path', () => {
    expect(errorText({ path: 'src/a.ts' })).toMatch(/^path: must be an absolute/);
  });

  it('reports an empty path once', () => {
    const text = errorText({ path: '' });
    expect(text).toMatch(/^path: must be an absolute/);
    expect(text).not.toContain(';');
  });

  it('rejects line 0', () => {
    expect(openFileArgs.safeParse({ path: file, line: 0 }).success).toBe(false);
  });

  it('rejects endLine without line', () => {
    expect(errorText({ path: file, endLine: 4 })).toBe('endLine: endLine requires line');
  });

  it('rejects endLine before line', () => {
    expect(errorText({ path: file, line: 5, endLine: 4 })).toBe('endLine: endLine must be >= line');
  });

  it('rejects endColumn before column on a one-line selection', () => {
    expect(errorText({ path: file, line: 5, column: 9, endLine: 5, endColumn: 8 })).toBe(
      'endColumn: endColumn must be >= column when line = endLine',
    );
  });

  it('accepts endColumn before column when the selection spans lines', () => {
    expect(openFileArgs.safeParse({ path: file, line: 3, column: 9, endLine: 4, endColumn: 2 }).success).toBe(true);
  });

  it('rejects column without line', () => {
    expect(errorText({ path: file, column: 4 })).toBe('column: column requires line');
  });

  it('rejects endColumn without endLine', () => {
    expect(errorText({ path: file, line: 3, endColumn: 4 })).toBe(
      'endColumn: endColumn requires endLine (use endLine = line for one line)',
    );
  });

  it('reports a missing line and a missing endLine together', () => {
    expect(errorText({ path: file, column: 4, endColumn: 6 })).toBe(
      'column: column requires line; endColumn: endColumn requires endLine (use endLine = line for one line)',
    );
  });

  it('rejects unknown keys', () => {
    expect(openFileArgs.safeParse({ path: file, lines: 3 }).success).toBe(false);
  });
});

describe('openFileObject', () => {
  it('is a strict object over openFileShape that the MCP SDK can register', () => {
    expect(Object.keys(openFileObject.shape)).toEqual(Object.keys(openFileShape));
  });

  it('rejects unknown keys instead of stripping them', () => {
    const r = openFileObject.safeParse({ path: file, lines: 3 });
    expect(r.success).toBe(false);
    if (!r.success) expect(formatZodError(r.error)).toBe("arguments: Unrecognized key(s) in object: 'lines'");
  });

  it('accepts a valid call', () => {
    expect(openFileObject.safeParse({ path: file, line: 3 }).success).toBe(true);
  });
});

describe.runIf(process.platform === 'win32')('absolute paths on Windows', () => {
  const message = 'must be an absolute Windows path like C:\\dir\\file (not /c/dir/file)';

  it.each(['/c/Users/x.ts', '\\foo\\x.ts', '\\\\server', '\\\\server\\'])('rejects %s', (p) => {
    expect(errorText({ path: p })).toBe(`path: ${message}`);
  });

  it.each(['C:\\x.ts', 'c:/x.ts', '\\\\server\\share\\x.ts', '//server/share/x.ts'])('accepts %s', (p) => {
    expect(openFileArgs.safeParse({ path: p }).success).toBe(true);
  });

  it('applies to reveal_in_explorer too', () => {
    expect(revealArgs.safeParse({ path: '/c/Users/x' }).success).toBe(false);
    expect(revealArgs.safeParse({ path: 'C:\\Users\\x' }).success).toBe(true);
  });
});

describe('revealArgs', () => {
  it('accepts path and focus', () => {
    expect(revealArgs.safeParse({ path: file, focus: true }).success).toBe(true);
  });

  it('rejects a relative path', () => {
    expect(revealArgs.safeParse({ path: 'docs' }).success).toBe(false);
  });

  it('rejects unknown keys instead of stripping them', () => {
    expect(revealArgs.safeParse({ path: file, recursive: true }).success).toBe(false);
  });
});

describe('callRequestSchema', () => {
  it('accepts a known tool', () => {
    expect(callRequestSchema.safeParse({ tool: 'open_file', args: { path: file } }).success).toBe(true);
  });

  it('rejects an unknown tool', () => {
    expect(callRequestSchema.safeParse({ tool: 'run_command', args: {} }).success).toBe(false);
  });
});

describe('callResponseSchema', () => {
  it('accepts both shapes', () => {
    expect(callResponseSchema.safeParse({ ok: true, text: 'done' }).success).toBe(true);
    expect(callResponseSchema.safeParse({ ok: false, error: 'nope' }).success).toBe(true);
  });

  it('rejects ok:true without text', () => {
    expect(callResponseSchema.safeParse({ ok: true }).success).toBe(false);
  });
});

describe('windowRecordSchema', () => {
  const record = {
    pid: 76940, port: 51234, token: 'a'.repeat(64), workspaceFolders: [file], windowName: 'my-project', lastFocusedAt: 1,
  };

  it('accepts a record', () => {
    expect(windowRecordSchema.safeParse(record).success).toBe(true);
  });

  it('rejects port 0', () => {
    expect(windowRecordSchema.safeParse({ ...record, port: 0 }).success).toBe(false);
  });

  it('accepts a window without folders', () => {
    expect(windowRecordSchema.safeParse({ ...record, workspaceFolders: [] }).success).toBe(true);
  });

  it.each(['', '.', 'relative\\dir', '../up'])('rejects the workspace folder %j (not absolute)', (folder) => {
    expect(windowRecordSchema.safeParse({ ...record, workspaceFolders: [file, folder] }).success).toBe(false);
  });

  it.each([Infinity, -Infinity, NaN])('rejects lastFocusedAt %s', (lastFocusedAt) => {
    expect(windowRecordSchema.safeParse({ ...record, lastFocusedAt }).success).toBe(false);
  });
});

describe('formatZodError', () => {
  it('joins several issues with "; "', () => {
    expect(errorText({ path: file, line: 0, group: 'left' })).toBe(
      'line: Number must be greater than or equal to 1; group: must be "beside", "active" or an integer 1-9',
    );
  });

  it('prefixes a root-level issue with "arguments: "', () => {
    expect(errorText({ path: file, lines: 3 })).toBe("arguments: Unrecognized key(s) in object: 'lines'");
  });
});
