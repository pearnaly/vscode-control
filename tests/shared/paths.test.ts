import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  containingFolder,
  displayPath,
  isInside,
  isUncPath,
  outsideWorkspaceUncError,
  windowsDir,
} from '../../shared/paths';

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

describe('isUncPath', () => {
  it('detects a UNC path written with backslashes', () => {
    expect(isUncPath('\\\\server\\share\\x.txt')).toBe(true);
  });

  it('detects a UNC path written with forward slashes', () => {
    expect(isUncPath('//server/share/x.txt')).toBe(true);
  });

  it('detects mixed separators and device-style prefixes', () => {
    expect(isUncPath('\\/server/share')).toBe(true);
    expect(isUncPath('/\\server\\share')).toBe(true);
    expect(isUncPath('\\\\?\\C:\\x.txt')).toBe(true);
    expect(isUncPath('\\\\.\\pipe\\x')).toBe(true);
  });

  it('is false for drive and POSIX paths', () => {
    expect(isUncPath('C:\\dir\\x.txt')).toBe(false);
    expect(isUncPath('C:/dir/x.txt')).toBe(false);
    expect(isUncPath('/home/me/x.txt')).toBe(false);
    expect(isUncPath('\\dir\\x.txt')).toBe(false);
    expect(isUncPath('/')).toBe(false);
    expect(isUncPath('')).toBe(false);
  });
});

describe('outsideWorkspaceUncError', () => {
  const message = (p: string): string =>
    `${p} is a network (UNC) path outside this window's workspace; it is not opened, because Windows would connect to that host and send your credentials.`;

  it('is an error for a UNC path outside the workspace', () => {
    expect(outsideWorkspaceUncError('//attacker/share/x.txt', [proj])).toBe(message('//attacker/share/x.txt'));
    expect(outsideWorkspaceUncError('//attacker/share/x.txt', [])).toBe(message('//attacker/share/x.txt'));
  });

  it('is an error for a UNC path beside a UNC workspace folder that merely shares a name prefix', () => {
    expect(outsideWorkspaceUncError('//srv/share2/x.txt', ['//srv/share'])).toBe(message('//srv/share2/x.txt'));
  });

  it('is an error for a UNC path outside a workspace of local folders, on the host of another share', () => {
    expect(outsideWorkspaceUncError('//srv/other/x.txt', ['//srv/share', proj])).toBe(message('//srv/other/x.txt'));
  });

  it('is no error for a UNC path inside a UNC workspace folder', () => {
    expect(outsideWorkspaceUncError('//srv/share/a/x.txt', ['//srv/share'])).toBeUndefined();
    expect(outsideWorkspaceUncError('//srv/share', ['//srv/share'])).toBeUndefined();
  });

  it.runIf(process.platform === 'win32')('is no error for a backslash UNC path inside a UNC workspace folder', () => {
    expect(outsideWorkspaceUncError('\\\\srv\\share\\a\\x.txt', ['\\\\srv\\share'])).toBeUndefined();
    expect(outsideWorkspaceUncError('\\\\SRV\\Share\\a\\x.txt', ['\\\\srv\\share'])).toBeUndefined();
  });

  it('is undefined for a non-UNC path, whatever the workspace', () => {
    expect(outsideWorkspaceUncError(path.join(root, 'other', 'x.ts'), [proj])).toBeUndefined();
    expect(outsideWorkspaceUncError(path.join(proj, 'x.ts'), [proj])).toBeUndefined();
    expect(outsideWorkspaceUncError(path.join(root, 'other', 'x.ts'), [])).toBeUndefined();
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
