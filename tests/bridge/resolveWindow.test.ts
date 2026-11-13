import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveWindow } from '../../bridge/src/resolveWindow';
import type { WindowRecord } from '../../shared/protocol';

const root = path.resolve(os.tmpdir(), 'vc-resolve');
const w = (pid: number, workspaceFolders: string[], lastFocusedAt: number): WindowRecord => ({
  pid, port: 1000 + pid, token: 't'.repeat(64), workspaceFolders, windowName: `w${pid}`, lastFocusedAt,
});
const noAncestors = async (): Promise<number[]> => [];

describe('resolveWindow', () => {
  it('returns undefined without windows', async () => {
    expect(await resolveWindow([], noAncestors, root)).toBeUndefined();
  });

  it('picks the window whose extension host is an ancestor of this process', async () => {
    const windows = [w(1, [root], 900), w(2, [], 100)];
    expect(await resolveWindow(windows, async () => [50, 40, 2, 7], root)).toEqual({ window: windows[1], via: 'process' });
  });

  it('else the window whose folder contains cwd, longest folder first', async () => {
    const windows = [w(1, [root], 900), w(2, [path.join(root, 'proj')], 100)];
    expect(await resolveWindow(windows, noAncestors, path.join(root, 'proj', 'src'))).toEqual({
      window: windows[1], via: 'folder',
    });
  });

  it('breaks folder ties by the most recent focus', async () => {
    const windows = [w(1, [root], 100), w(2, [root], 900)];
    expect((await resolveWindow(windows, noAncestors, root))?.window.pid).toBe(2);
  });

  it('else the most recently focused window', async () => {
    const windows = [w(1, [], 100), w(2, [], 900), w(3, [], 500)];
    expect(await resolveWindow(windows, noAncestors, root)).toEqual({ window: windows[1], via: 'recent' });
  });

  it('treats a failing ancestry lookup as no match', async () => {
    const windows = [w(1, [root], 1)];
    const failing = async (): Promise<number[]> => {
      throw new Error('powershell missing');
    };
    expect((await resolveWindow(windows, failing, root))?.via).toBe('folder');
  });
});
