import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * `parent` is the parent pid; `created` is the creation time as a Windows FILETIME (100 ns ticks since
 * 1601, UTC), or 0 when unknown (POSIX, or a process whose start time could not be read).
 */
export interface ProcessEntry {
  parent: number;
  created: number;
}

/** pid → parent and creation time for every process on the machine. */
export type ProcessTable = Map<number, ProcessEntry>;

/** Reads "pid ppid" and "pid ppid created" lines; everything else is skipped. */
export function parseProcessTable(output: string): ProcessTable {
  const table: ProcessTable = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)(?:\s+(\d+))?\s*$/.exec(line);
    if (match) table.set(Number(match[1]), { parent: Number(match[2]), created: Number(match[3] ?? 0) });
  }
  return table;
}

// Single-quoted strings only, passed base64-encoded: no command-line quoting issues. The progress
// preference keeps PowerShell from writing progress records to a console nobody reads. CreationDate has
// to be in -Property, or Get-CimInstance leaves it empty. The FILETIME is far above 2^53 but ordering
// survives the rounding to a double (about 1.6 µs), which is all ancestorsOf needs.
const WINDOWS_SCRIPT =
  "$ProgressPreference = 'SilentlyContinue'; " +
  'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate | ForEach-Object { ' +
  "'{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, " +
  '$(if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 }) }';

/**
 * Reads the process table once (≈1 s on Windows). Windows reports creation times; POSIX `ps` reports
 * parents only.
 */
export async function readProcessTable(): Promise<ProcessTable> {
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
    return parseProcessTable(stdout);
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
  return parseProcessTable(stdout);
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
