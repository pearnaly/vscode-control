import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { containingFolder, displayPath, isInside, windowsDir } from '../../shared/paths';

const root = path.resolve(os.tmpdir(), 'vc-paths');
const proj = path.join(root, 'proj');
const nested = path.join(proj, 'packages', 'app');

describe('windowsDir', () => {
  it('is <home>/.vscode-control/windows', () => {
    expect(windowsDir(path.join(root, 'home'))).toBe(path.join(root, 'home', '.vscode-control', 'windows'));
  });
});

describe('isInside', () => {
  it('accepts the folder itself and anything below it', () => {
    expect(isInside(proj, proj)).toBe(true);
    expect(isInside(path.join(proj, 'a', 'b.ts'), proj)).toBe(true);
  });

  it('rejects a sibling that shares a name prefix', () => {
    expect(isInside(path.join(root, 'project2', 'x.ts'), proj)).toBe(false);
  });

  it('rejects a parent', () => {
    expect(isInside(root, proj)).toBe(false);
  });

  it.runIf(process.platform === 'win32')('ignores case on Windows (VS Code lowercases drive letters)', () => {
    expect(isInside('D:\\Work\\Docs\\a.md', 'd:\\work')).toBe(true);
  });

  describe.runIf(process.platform === 'win32')('Windows path forms', () => {
    it('accepts a drive-root parent', () => {
      expect(isInside('D:\\a\\b.md', 'd:\\')).toBe(true);
    });

    it('accepts a UNC parent', () => {
      expect(isInside('\\\\srv\\share\\a.md', '\\\\srv\\share')).toBe(true);
    });

    it('accepts a parent with a trailing separator', () => {
      expect(isInside('C:\\proj\\a.ts', 'C:\\proj\\')).toBe(true);
    });

    it('accepts a child written with forward slashes', () => {
      expect(isInside('C:/proj/a.ts', 'C:\\proj')).toBe(true);
    });

    it('rejects a child that escapes the parent through ..', () => {
      expect(isInside('C:\\proj\\..\\proj2\\a.ts', 'C:\\proj')).toBe(false);
    });
  });
});

describe('containingFolder', () => {
  it('returns the longest matching folder, whatever the order', () => {
    expect(containingFolder(path.join(nested, 'x.ts'), [proj, nested])).toBe(nested);
    expect(containingFolder(path.join(nested, 'x.ts'), [nested, proj])).toBe(nested);
  });

  it('returns undefined when no folder matches', () => {
    expect(containingFolder(path.join(root, 'other', 'x.ts'), [proj])).toBeUndefined();
  });
});

describe('displayPath', () => {
  it('is relative to the containing folder', () => {
    expect(displayPath(path.join(proj, 'src', 'a.ts'), [proj])).toBe(path.join('src', 'a.ts'));
  });

  it('is the absolute path when no folder contains it', () => {
    const p = path.join(root, 'other', 'x.ts');
    expect(displayPath(p, [proj])).toBe(p);
  });

  it('is the normalised absolute path when no folder contains it', () => {
    const messy = `${root}${path.sep}other${path.sep}..${path.sep}x.ts`;
    expect(displayPath(messy, [proj])).toBe(path.join(root, 'x.ts'));
  });

  it("is the folder's own name for the folder itself", () => {
    expect(displayPath(proj, [proj])).toBe('proj');
  });

  it.runIf(process.platform === 'win32')('is the drive root itself for a drive root (it has no basename)', () => {
    expect(displayPath('D:\\', ['D:\\'])).toBe('D:\\');
  });

  it.runIf(process.platform === 'win32')("keeps the caller's spelling when cases differ", () => {
    expect(displayPath('D:\\Work\\Docs\\a.md', ['d:\\work'])).toBe('Docs\\a.md');
  });
});
