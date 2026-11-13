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
