import { describe, expect, it } from 'vitest';
import type { ProcessSnapshot } from '../../bridge/src/processTree';
import { isStale, staleReason } from '../../bridge/src/staleness';
import type { WindowRecord } from '../../shared/protocol';

const snap = (rows: [pid: number, created: number][], takenAt = 1_000_000, timed = true): ProcessSnapshot => ({
  table: new Map(rows.map(([pid, created]) => [pid, { parent: 1, created }])),
  takenAt,
  timed,
});
const rec = (pid: number, startedAt?: number): WindowRecord => ({
  pid, port: 1, token: 't'.repeat(64), workspaceFolders: [], windowName: 'w', lastFocusedAt: 0,
  ...(startedAt === undefined ? {} : { startedAt }),
});

describe('staleReason', () => {
  it("is 'reused' when the pid's current owner started after the window", () => {
    expect(staleReason(rec(7, 500_000), snap([[7, 506_000]]))).toBe('reused');
    expect(staleReason(rec(7, 500_000), snap([[7, 505_001]]))).toBe('reused');
  });

  it("is 'gone' when the pid is absent although the window claims to have run before the snapshot", () => {
    expect(staleReason(rec(7, 900_000), snap([], 1_000_000))).toBe('gone');
    expect(staleReason(rec(7, 994_999), snap([], 1_000_000))).toBe('gone');
  });

  it('is undefined when nothing proves the file stale', () => {
    expect(staleReason(rec(7, 500_000), snap([[7, 503_000]]))).toBeUndefined(); // same start
    expect(staleReason(rec(7, 500_000), snap([[7, 100]]))).toBeUndefined(); // older owner
    expect(staleReason(rec(7, 500_000), snap([[7, 0]]))).toBeUndefined(); // creation time unknown
    expect(staleReason(rec(7), snap([[7, 999_000]]))).toBeUndefined(); // 0.1.x file
    expect(staleReason(rec(7), snap([]))).toBeUndefined();
    expect(staleReason(rec(7, 995_000), snap([], 1_000_000))).toBeUndefined(); // absent, started within tolerance
    expect(staleReason(rec(7, 1_002_000), snap([], 1_000_000))).toBeUndefined(); // opened after the snapshot
  });

  it('is undefined on a snapshot without creation times, whatever the record says', () => {
    expect(staleReason(rec(7, 500_000), snap([[7, 999_000]], 1_000_000, false))).toBeUndefined();
    expect(staleReason(rec(7, 900_000), snap([], 1_000_000, false))).toBeUndefined();
  });

  it('honours a custom tolerance', () => {
    expect(staleReason(rec(7, 500_000), snap([[7, 506_000]]), 10_000)).toBeUndefined();
    expect(staleReason(rec(7, 500_000), snap([[7, 506_000]]), 500)).toBe('reused');
    expect(staleReason(rec(7, 995_000), snap([], 1_000_000), 1_000)).toBe('gone');
  });
});

describe('isStale', () => {
  it('never calls a 0.1.x file (no startedAt) stale', () => {
    expect(isStale(rec(7), snap([]))).toBe(false);
    expect(isStale(rec(7), snap([[7, 123]]))).toBe(false);
  });

  it('keeps a window whose process started at the recorded time (within 5 s)', () => {
    expect(isStale(rec(7, 500_000), snap([[7, 503_000]]))).toBe(false);
    expect(isStale(rec(7, 500_000), snap([[7, 495_000]]))).toBe(false);
  });

  it('calls a file stale when its pid belongs to a process that started after the window', () => {
    expect(isStale(rec(7, 500_000), snap([[7, 506_000]]))).toBe(true);
    expect(isStale(rec(7, 500_000), snap([[7, 999_000]]))).toBe(true);
  });

  it('never calls a file stale because its pid belongs to an older process (a reused pid is always newer)', () => {
    expect(isStale(rec(7, 500_000), snap([[7, 100]]))).toBe(false);
    expect(isStale(rec(7, 500_000), snap([[7, 494_999]]))).toBe(false);
  });

  it('treats a gap of exactly 5000 ms as fresh and 5001 ms as stale (owner started after the window)', () => {
    expect(isStale(rec(7, 500_000), snap([[7, 505_000]]))).toBe(false);
    expect(isStale(rec(7, 500_000), snap([[7, 505_001]]))).toBe(true);
  });

  it('cannot judge a process whose creation time is unknown', () => {
    expect(isStale(rec(7, 500_000), snap([[7, 0]]))).toBe(false);
  });

  it('calls a file stale when its window ran before the snapshot but its pid did not exist then', () => {
    expect(isStale(rec(7, 900_000), snap([], 1_000_000))).toBe(true);
  });

  it('treats an absent pid as fresh at exactly 5000 ms before the snapshot and stale at 5001 ms', () => {
    expect(isStale(rec(7, 995_000), snap([], 1_000_000))).toBe(false);
    expect(isStale(rec(7, 994_999), snap([], 1_000_000))).toBe(true);
  });

  it('keeps a window opened after the snapshot (absent from it, started later)', () => {
    expect(isStale(rec(7, 1_002_000), snap([], 1_000_000))).toBe(false);
    expect(isStale(rec(7, 997_000), snap([], 1_000_000))).toBe(false);
  });

  it('never calls anything stale on a snapshot without creation times', () => {
    expect(isStale(rec(7, 500_000), snap([[7, 999_000]], 1_000_000, false))).toBe(false);
    expect(isStale(rec(7, 900_000), snap([], 1_000_000, false))).toBe(false);
    expect(isStale(rec(7, 500_000), snap([[7, 0]], 1_000_000, false))).toBe(false);
  });
});
