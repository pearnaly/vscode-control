import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { windowRecordSchema, type WindowRecord } from '../../shared/protocol';

/** True while a process with this pid exists. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Reads every `<pid>.json` in `dir`. Files of dead processes are deleted; unreadable or
 * invalid files, and files whose name differs from the pid inside them, are skipped and left alone
 * (a window may be writing them right now). A missing directory means no windows; any other
 * error (permissions, not a directory, …) is thrown rather than reported as "no windows".
 */
export async function readWindows(dir: string, alive: (pid: number) => boolean = isAlive): Promise<WindowRecord[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const windows: WindowRecord[] = [];
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue;
    const file = path.join(dir, name);
    let record: WindowRecord;
    try {
      const parsed = windowRecordSchema.safeParse(JSON.parse(await fs.readFile(file, 'utf8')));
      if (!parsed.success) continue;
      record = parsed.data;
    } catch {
      continue;
    }
    // The file name is what forgetWindow deletes by and the pid is what the process lookup trusts, so they
    // must agree exactly: `0101.json` holding pid 101 must not shadow (or outlive) `101.json`.
    if (name !== `${record.pid}.json`) continue;
    if (!alive(record.pid)) {
      await fs.rm(file, { force: true }).catch(() => undefined);
      continue;
    }
    windows.push(record);
  }
  return windows;
}

/** Deletes a window's discovery file; used when its server refuses connections (the window is gone). */
export async function forgetWindow(dir: string, pid: number): Promise<void> {
  await fs.rm(path.join(dir, `${pid}.json`), { force: true }).catch(() => undefined);
}
