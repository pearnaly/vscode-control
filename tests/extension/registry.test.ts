import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Registry } from '../../extension/src/registry';
import { windowRecordSchema, type WindowRecord } from '../../shared/protocol';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-registry-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const record = (over: Partial<WindowRecord> = {}): WindowRecord => ({
  pid: 4242, port: 50000, token: 't'.repeat(64), workspaceFolders: [path.resolve(os.tmpdir(), 'proj')], windowName: 'proj', lastFocusedAt: 1,
  ...over,
});

describe('Registry', () => {
  it('writes <dir>/<pid>.json, creating the directory', () => {
    const sub = path.join(dir, 'windows');
    const registry = new Registry(sub, 4242);
    registry.write(record());
    expect(registry.file).toBe(path.join(sub, '4242.json'));
    expect(windowRecordSchema.parse(JSON.parse(fs.readFileSync(registry.file, 'utf8')))).toEqual(record());
  });

  it('replaces the file on rewrite and leaves no temp files', () => {
    const registry = new Registry(dir, 4242);
    registry.write(record());
    registry.write(record({ lastFocusedAt: 2 }));
    expect(fs.readdirSync(dir)).toEqual(['4242.json']);
    expect(JSON.parse(fs.readFileSync(registry.file, 'utf8')).lastFocusedAt).toBe(2);
  });

  it('remove deletes the file and tolerates a missing one', () => {
    const registry = new Registry(dir, 4242);
    registry.write(record());
    registry.remove();
    registry.remove();
    expect(fs.existsSync(registry.file)).toBe(false);
  });

  it('throws and leaves no temp file when the rename fails', () => {
    // A directory at the target path makes the rename fail (EPERM on Windows, EISDIR elsewhere).
    fs.mkdirSync(path.join(dir, '4242.json'));
    const registry = new Registry(dir, 4242);
    expect(() => registry.write(record())).toThrow();
    expect(fs.readdirSync(dir)).toEqual(['4242.json']);
  });

  it('rejects an invalid record before writing anything', () => {
    const registry = new Registry(dir, 4242);
    expect(() => registry.write(record({ port: 0 }))).toThrow();
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('remove does not throw when the file cannot be removed', () => {
    // A non-empty directory cannot be removed by rmSync without `recursive`.
    const target = path.join(dir, '4242.json');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'inner'), 'x');
    const registry = new Registry(dir, 4242);
    expect(() => registry.remove()).not.toThrow();
    expect(fs.existsSync(target)).toBe(true);
  });
});
