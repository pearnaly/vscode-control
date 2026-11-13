import * as os from 'node:os';
import * as path from 'node:path';

/** Directory holding one discovery file per VS Code window. */
export function windowsDir(home: string = os.homedir()): string {
  return path.join(home, '.vscode-control', 'windows');
}

function comparable(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** True when `child` is `parent` itself or lies below it. Case-insensitive on Windows. */
export function isInside(child: string, parent: string): boolean {
  const c = comparable(child);
  const p = comparable(parent);
  if (c === p) return true;
  return c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

/** The longest folder in `folders` that contains `p`, or undefined. */
export function containingFolder(p: string, folders: readonly string[]): string | undefined {
  let best: string | undefined;
  for (const folder of folders) {
    if (isInside(p, folder) && (best === undefined || path.resolve(folder).length > path.resolve(best).length)) {
      best = folder;
    }
  }
  return best;
}

/**
 * True for a path that starts with two slashes or backslashes (`\\server\share\…`, `//server/share/…`,
 * also `\\?\…` and `\\.\…`), on any platform. A plain string check: on Windows such a path makes the
 * machine connect to `server`, which is what the caller has to keep from happening.
 */
export function isUncPath(p: string): boolean {
  return /^[\\/]{2}/.test(p);
}

/**
 * A refusal message when `p` is a UNC path that no workspace folder contains, otherwise undefined.
 * Windows connects to the named host as soon as the path is touched (stat, open) and sends the user's
 * credentials, so such a path must be rejected before any file-system access.
 */
export function outsideWorkspaceUncError(p: string, folders: readonly string[]): string | undefined {
  if (!isUncPath(p) || containingFolder(p, folders) !== undefined) return undefined;
  return `${p} is a network (UNC) path outside this window's workspace; it is not opened, because Windows would connect to that host and send your credentials.`;
}

/**
 * `p` relative to the folder that contains it, the folder's own name for the folder itself (the
 * drive root itself for a drive root, which has no name), and the normalised absolute `p` when no
 * folder contains it. Keeps the caller's case of `p`.
 */
export function displayPath(p: string, folders: readonly string[]): string {
  const resolved = path.resolve(p);
  const folder = containingFolder(p, folders);
  if (folder === undefined) return resolved;
  const rel = resolved.slice(path.resolve(folder).length).replace(/^[\\/]+/, '');
  return rel === '' ? path.basename(resolved) || resolved : rel;
}
