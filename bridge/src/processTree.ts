import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** `parent` is the parent pid; `created` the creation time in epoch milliseconds, or 0 when unknown. */
export interface ProcessEntry {
  parent: number;
  created: number;
}

/** pid → parent and creation time for every process on the machine. */
export type ProcessTable = Map<number, ProcessEntry>;

/**
 * A process table, the moment (epoch ms) just before it was read, and whether its creation times are
 * trustworthy (`timed`: Windows only, and only when the table is complete enough to contain this process;
 * on POSIX every `created` is 0).
 */
export interface ProcessSnapshot {
  readonly table: ProcessTable;
  readonly takenAt: number;
  readonly timed: boolean;
}

/**
 * Reads "pid ppid" and "pid ppid raw" lines; everything else is skipped. `toCreated` turns the optional
 * third column into epoch ms; without a converter, or without that column, `created` is 0 (unknown).
 */
export function parseProcessTable(output: string, toCreated: (raw: number) => number = () => 0): ProcessTable {
  const table: ProcessTable = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)(?:\s+(\d+))?\s*$/.exec(line);
    if (match) {
      const created = match[3] === undefined ? 0 : toCreated(Number(match[3]));
      table.set(Number(match[1]), { parent: Number(match[2]), created });
    }
  }
  return table;
}

/**
 * Windows FILETIME (100 ns ticks since 1601-01-01, UTC) → epoch milliseconds; 0 (unknown) stays 0. The
 * FILETIME is above 2^53, but the rounding of a double there is about 1.6 µs, far below a millisecond.
 */
export function filetimeToMs(filetime: number): number {
  return filetime === 0 ? 0 : Math.round(filetime / 10_000 - 11_644_473_600_000);
}

/**
 * Whether a table read from Windows can be trusted for start times: it must contain the reading process
 * itself, which is alive by definition. A table without it is truncated (or the read went wrong) and must
 * not be used to call any discovery file stale.
 */
export function isTimedTable(table: ProcessTable, selfPid: number): boolean {
  return table.has(selfPid);
}

// Single-quoted strings only, passed base64-encoded: no command-line quoting issues. The progress
// preference keeps PowerShell from writing progress records to a console nobody reads. CreationDate has
// to be in -Property, or Get-CimInstance leaves it empty.
const WINDOWS_SCRIPT =
  "$ProgressPreference = 'SilentlyContinue'; " +
  'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate | ForEach-Object { ' +
  "'{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, " +
  '$(if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 }) }';

/**
 * Reads the process table once (≈1 s on Windows). Windows reports creation times from CIM (fixed when the
 * process is created), so the snapshot is `timed` — unless the table lacks this process, which means it is
 * truncated. POSIX `ps` reports parents only: deriving a start time
 * from `etimes` mixes the wall clock with the boot clock and drifts (56 s in 9 days seen in WSL2), so every
 * `created` stays 0 (unknown) and the snapshot is not `timed`.
 */
export async function readProcessTable(): Promise<ProcessSnapshot> {
  const takenAt = Date.now();
  if (process.platform === 'win32') {
    // Absolute path on purpose: Node (libuv) looks for a bare `powershell.exe` in the current directory
    // before PATH, so a repository containing a planted powershell.exe would be executed instead.
    // `||` so that an empty SystemRoot also falls back; a relative one is refused, never run.
    const root = process.env.SystemRoot || 'C:\\Windows';
    const powershell = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (!path.win32.isAbsolute(powershell)) throw new Error('SystemRoot does not give an absolute path to PowerShell');
    const encoded = Buffer.from(WINDOWS_SCRIPT, 'utf16le').toString('base64');
    const { stdout } = await run(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      // Not the caller's directory, which may be an untrusted repository: Windows looks in the working
      // directory for DLLs as well as executables.
      cwd: path.dirname(powershell),
      // PowerShell does not start with an empty SystemRoot, so the fallback has to reach it too. Windows
      // variable names are case-insensitive: drop every spelling first so no duplicate is left behind.
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'systemroot')),
        SystemRoot: root,
      },
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const table = parseProcessTable(stdout, filetimeToMs);
    return { table, takenAt, timed: isTimedTable(table, process.pid) };
  }
  // Absolute path and working directory `/` on purpose, as for PowerShell above: a bare `ps` is resolved
  // through PATH, and a relative or empty PATH entry resolves against the working directory, which here is
  // the session's folder and may be an untrusted repository holding a planted `ps`.
  const ps = ['/bin/ps', '/usr/bin/ps'].find((candidate) => existsSync(candidate));
  if (ps === undefined) throw new Error('ps not found in /bin or /usr/bin');
  const { stdout } = await run(ps, ['-A', '-o', 'pid=,ppid='], {
    cwd: '/',
    timeout: 15_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return { table: parseProcessTable(stdout), takenAt, timed: false };
}

/**
 * `pid`, its parent, grandparent, … — stops at pid 0, an unknown pid or a cycle; at most 64 entries.
 * Stops before a parent that is missing from the table (already dead, so not an ancestor any more) and
 * before a parent that was created after its child: Windows never reparents orphans, so the pid of a dead
 * parent can belong to a newer, unrelated process. Unknown creation times (0) are not compared.
 */
export function ancestorsOf(pid: number, table: ProcessTable): number[] {
  const chain: number[] = [];
  const seen = new Set<number>();
  let current: number | undefined = pid;
  while (current !== undefined && current > 0 && !seen.has(current) && chain.length < 64) {
    chain.push(current);
    seen.add(current);
    const entry = table.get(current);
    if (entry === undefined) break;
    const parent = table.get(entry.parent);
    if (parent === undefined) break;
    if (entry.created > 0 && parent.created > 0 && parent.created > entry.created) break;
    current = entry.parent;
  }
  return chain;
}
