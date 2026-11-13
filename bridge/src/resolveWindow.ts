import * as path from 'node:path';
import { containingFolder } from '../../shared/paths';
import type { WindowRecord } from '../../shared/protocol';

export type Via = 'process' | 'folder' | 'recent';

export interface Resolved {
  window: WindowRecord;
  via: Via;
}

/**
 * Picks the window to act in: the one whose extension host is an ancestor of this process,
 * else the one whose workspace folder contains `cwd` (longest folder; ties → most recent focus),
 * else the most recently focused one.
 */
export async function resolveWindow(
  windows: readonly WindowRecord[],
  ancestors: () => Promise<number[]>,
  cwd: string,
): Promise<Resolved | undefined> {
  if (windows.length === 0) return undefined;

  let chain: number[] = [];
  try {
    chain = await ancestors();
  } catch {
    chain = [];
  }
  for (const pid of chain) {
    const window = windows.find((w) => w.pid === pid);
    if (window) return { window, via: 'process' };
  }

  const byRecency = [...windows].sort((a, b) => b.lastFocusedAt - a.lastFocusedAt);
  let best: { window: WindowRecord; length: number } | undefined;
  for (const window of byRecency) {
    const folder = containingFolder(cwd, window.workspaceFolders);
    // Same measure as containingFolder uses internally, so a trailing separator cannot skew the comparison.
    const length = folder === undefined ? -1 : path.resolve(folder).length;
    if (folder !== undefined && (best === undefined || length > best.length)) {
      best = { window, length };
    }
  }
  if (best) return { window: best.window, via: 'folder' };

  return { window: byRecency[0]!, via: 'recent' };
}
