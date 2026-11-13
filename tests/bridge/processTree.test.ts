import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ancestorsOf, parseProcessTable, readProcessTable, type ProcessTable } from '../../bridge/src/processTree';

/** Builds a table from [pid, parent, created?] rows; `created` defaults to 0 (unknown). */
const table = (rows: [number, number, number?][]): ProcessTable =>
  new Map(rows.map(([pid, parent, created = 0]) => [pid, { parent, created }]));

describe('parseProcessTable', () => {
  it('reads "pid ppid" and "pid ppid created" lines and skips everything else', () => {
    const parsed = parseProcessTable(
      '  4 0\r\n76940 40408 134076000000000000\r\n\r\nwarning: x\n52068 76940\n1 2 x\n',
    );
    expect([...parsed]).toEqual([
      [4, { parent: 0, created: 0 }],
      [76940, { parent: 40408, created: 134076000000000000 }],
      [52068, { parent: 76940, created: 0 }],
    ]);
  });
});

describe('ancestorsOf', () => {
  it('lists the pid and its ancestors up to pid 0', () => {
    expect(ancestorsOf(10, table([[10, 9], [9, 8], [8, 0]]))).toEqual([10, 9, 8]);
  });

  it('stops before a parent that is not in the table (it is already dead)', () => {
    expect(ancestorsOf(10, table([[10, 9]]))).toEqual([10]);
    expect(ancestorsOf(10, table([[10, 9], [9, 8]]))).toEqual([10, 9]);
  });

  it('stops on a cycle', () => {
    expect(ancestorsOf(1, table([[1, 2], [2, 1]]))).toEqual([1, 2]);
  });

  it('follows parents created before their children', () => {
    expect(ancestorsOf(10, table([[10, 9, 300], [9, 8, 200], [8, 0, 100]]))).toEqual([10, 9, 8]);
  });

  it('stops at a parent created after its child (reused pid)', () => {
    // 9 died and its pid went to an unrelated process created after 10; 8 is not 10's ancestor.
    expect(ancestorsOf(10, table([[10, 9, 200], [9, 8, 300], [8, 0, 100]]))).toEqual([10]);
  });

  it('stops at a reused pid further up the chain, keeping the genuine ancestors', () => {
    expect(ancestorsOf(10, table([[10, 9, 300], [9, 8, 200], [8, 7, 900], [7, 0, 50]]))).toEqual([10, 9]);
  });

  it('continues when creation times are unknown (0)', () => {
    expect(ancestorsOf(10, table([[10, 9, 200], [9, 8, 0], [8, 7, 100], [7, 0]]))).toEqual([10, 9, 8, 7]);
    expect(ancestorsOf(10, table([[10, 9, 0], [9, 8, 300], [8, 0, 0]]))).toEqual([10, 9, 8]);
  });
});

describe('readProcessTable (real system)', () => {
  it('knows this process and its parent', async () => {
    const processes = await readProcessTable();
    expect(processes.get(process.pid)?.parent).toBe(process.ppid);
  }, 30_000);

  // A bare `powershell.exe` is looked up in the current directory first, unless the machine sets
  // NoDefaultCurrentDirectoryInExePath; this plants a stand-in there and removes that guard.
  it.runIf(process.platform === 'win32')('does not run a powershell.exe planted in the current directory', async () => {
    const planted = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-planted-'));
    fs.copyFileSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe'), path.join(planted, 'powershell.exe'));
    const cwd = process.cwd();
    const guard = process.env.NoDefaultCurrentDirectoryInExePath;
    try {
      process.chdir(planted);
      delete process.env.NoDefaultCurrentDirectoryInExePath;
      const processes = await readProcessTable();
      expect(processes.get(process.pid)?.parent).toBe(process.ppid);
    } finally {
      process.chdir(cwd);
      if (guard !== undefined) process.env.NoDefaultCurrentDirectoryInExePath = guard;
      fs.rmSync(planted, { recursive: true, force: true });
    }
  }, 30_000);

  // Replaces SystemRoot for the duration of `body` (undefined removes it) and restores it afterwards.
  const withSystemRoot = async (value: string | undefined, body: () => Promise<void>): Promise<void> => {
    const saved = process.env.SystemRoot;
    try {
      if (value === undefined) delete process.env.SystemRoot;
      else process.env.SystemRoot = value;
      await body();
    } finally {
      if (saved === undefined) delete process.env.SystemRoot;
      else process.env.SystemRoot = saved;
    }
  };

  it.runIf(process.platform === 'win32')('refuses a SystemRoot that does not give an absolute PowerShell path', async () => {
    for (const value of ['.', 'Windows', '..\\x']) {
      await withSystemRoot(value, async () => {
        await expect(readProcessTable()).rejects.toThrow('SystemRoot does not give an absolute path to PowerShell');
      });
    }
  });

  it.runIf(process.platform === 'win32')('falls back to C:\\Windows when SystemRoot is empty or unset', async () => {
    for (const value of ['', undefined]) {
      await withSystemRoot(value, async () => {
        const processes = await readProcessTable();
        expect(processes.get(process.pid)?.parent).toBe(process.ppid);
      });
    }
  }, 30_000);

  it.runIf(process.platform === 'win32')('knows when each process was created', async () => {
    const processes = await readProcessTable();
    const self = processes.get(process.pid);
    const parent = processes.get(process.ppid);
    expect(self?.created).toBeGreaterThan(0);
    expect(parent?.created).toBeGreaterThan(0);
    // The parent of a live process is older than it, which is what ancestorsOf relies on.
    expect(parent!.created).toBeLessThanOrEqual(self!.created);
    expect(ancestorsOf(process.pid, processes).slice(0, 2)).toEqual([process.pid, process.ppid]);
  }, 30_000);
});
