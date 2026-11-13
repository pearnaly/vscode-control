import type { WindowRecord } from '../../shared/protocol';
import type { ProcessSnapshot } from './processTree';

/** How far a window's recorded start may differ from the OS creation time (clocks, rounding). */
export const STALE_TOLERANCE_MS = 5000;

/** Why a discovery file cannot belong to a live window (see `staleReason`). */
export type StaleReason = 'reused' | 'gone';

/**
 * Why a discovery file cannot belong to a live window, or `undefined` when nothing proves that. Only judged on
 * a `timed` snapshot (Windows); files without `startedAt` (written by 0.1.x) and processes with unknown
 * creation times are never judged.
 *
 * - `'reused'`: the pid is in the snapshot and its owner started more than `toleranceMs` after the recorded
 *   `startedAt`. A pid is reused only after its previous owner died, so the new owner always started after
 *   the window did. The rule is one-sided: an owner that is older than the window, or about as old, cannot be
 *   a reuse; such a gap is a measurement artefact and is never judged.
 * - `'gone'`: the pid is absent from the snapshot although the window claims to have been running (by more
 *   than `toleranceMs`) before the snapshot was taken, so no process with that pid existed then. This verdict
 *   rests on the window's own clock claim (a large backwards clock step could fake it), which is why callers
 *   should ignore such a file but not delete it.
 */
export function staleReason(
  record: WindowRecord,
  snapshot: ProcessSnapshot,
  toleranceMs = STALE_TOLERANCE_MS,
): StaleReason | undefined {
  if (!snapshot.timed || record.startedAt === undefined) return undefined;
  const entry = snapshot.table.get(record.pid);
  if (entry === undefined) return record.startedAt < snapshot.takenAt - toleranceMs ? 'gone' : undefined;
  if (entry.created === 0) return undefined;
  return entry.created - record.startedAt > toleranceMs ? 'reused' : undefined;
}

/** True when `staleReason` finds a reason (either) why the file cannot belong to a live window. */
export function isStale(record: WindowRecord, snapshot: ProcessSnapshot, toleranceMs = STALE_TOLERANCE_MS): boolean {
  return staleReason(record, snapshot, toleranceMs) !== undefined;
}
