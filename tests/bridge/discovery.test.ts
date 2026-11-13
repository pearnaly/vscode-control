import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forgetWindow, isAlive, readWindows } from '../../bridge/src/discovery';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-discovery-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const record = (pid: number) => ({
  pid, port: 50000 + pid, token: 't'.repeat(64), workspaceFolders: [], windowName: `w${pid}`, lastFocusedAt: 0,
});
const put = (name: string, content: string) => fs.writeFileSync(path.join(dir, name), content);

describe('readWindows', () => {
  it('returns [] when the directory does not exist', async () => {
    expect(await readWindows(path.join(dir, 'missing'), () => true)).toEqual([]);
  });

  it('reads the records of live windows', async () => {
    put('101.json', JSON.stringify(record(101)));
    put('102.json', JSON.stringify(record(102)));
    const pids = (await readWindows(dir, () => true)).map((w) => w.pid).sort();
    expect(pids).toEqual([101, 102]);
  });

  it('deletes the files of dead windows', async () => {
    put('101.json', JSON.stringify(record(101)));
    put('102.json', JSON.stringify(record(102)));
    const windows = await readWindows(dir, (pid) => pid === 102);
    expect(windows.map((w) => w.pid)).toEqual([102]);
    expect(fs.existsSync(path.join(dir, '101.json'))).toBe(false);
  });

  it('skips temp files, other names and invalid content without deleting them', async () => {
    put('101.json.1.2.tmp', JSON.stringify(record(101)));
    put('notes.txt', 'x');
    put('103.json', '{broken');
    put('104.json', JSON.stringify({ pid: 104 }));
    expect(await readWindows(dir, () => true)).toEqual([]);
    expect(fs.readdirSync(dir)).toHaveLength(4);
  });

  it('ignores a file whose name differs from the pid inside it, and keeps it', async () => {
    put('1.json', JSON.stringify(record(101)));
    put('102.json', JSON.stringify(record(102)));
    // Pid 101 counts as dead here, so checking liveness first would delete the file: a mismatching file
    // is neither trusted nor deleted.
    const windows = await readWindows(dir, (pid) => pid === 102);
    expect(windows.map((w) => w.pid)).toEqual([102]);
    expect(fs.existsSync(path.join(dir, '1.json'))).toBe(true);
  });

  it('does not let a differently spelled file shadow the real one (0101.json vs 101.json)', async () => {
    put('0101.json', JSON.stringify(record(101)));
    put('101.json', JSON.stringify(record(101)));
    const windows = await readWindows(dir, () => true);
    expect(windows.map((w) => w.pid)).toEqual([101]);
    expect(fs.readdirSync(dir).sort()).toEqual(['0101.json', '101.json']);
  });

  it('rethrows errors other than a missing directory', async () => {
    const notADirectory = path.join(dir, 'file.txt');
    fs.writeFileSync(notADirectory, 'x');
    await expect(readWindows(notADirectory, () => true)).rejects.toThrow();
  });
});

describe('forgetWindow', () => {
  it("deletes the window's file and tolerates a missing one", async () => {
    put('101.json', JSON.stringify(record(101)));
    await forgetWindow(dir, 101);
    await forgetWindow(dir, 101);
    expect(fs.existsSync(path.join(dir, '101.json'))).toBe(false);
  });
});

describe('isAlive', () => {
  it('is true for this process', () => {
    expect(isAlive(process.pid)).toBe(true);
  });

  it('is false for a pid that cannot exist', () => {
    // Far above any pid in use (Windows ignores the low two bits of a pid, so this probes 4_194_308).
    expect(isAlive(4_194_311)).toBe(false);
  });
});
