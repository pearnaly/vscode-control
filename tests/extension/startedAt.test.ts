import { describe, expect, it } from 'vitest';
import { chooseStartedAt } from '../../extension/src/startedAt';

const now = 1_794_600_000_000;
// What Date.now() - process.uptime() * 1000 gives: the extension host started 10 minutes ago.
const estimate = now - 600_000;

describe('chooseStartedAt', () => {
  it('uses a time origin that agrees with the uptime estimate and is not in the future', () => {
    expect(chooseStartedAt(estimate + 19, estimate, now)).toBe(estimate + 19);
    expect(chooseStartedAt(estimate - 19, estimate, now)).toBe(estimate - 19);
  });

  it('accepts a time origin exactly 60 s from the estimate and rejects one 1 ms further', () => {
    expect(chooseStartedAt(estimate - 60_000, estimate, now)).toBe(estimate - 60_000);
    expect(chooseStartedAt(estimate + 60_000, estimate, now)).toBe(estimate + 60_000);
    expect(chooseStartedAt(estimate - 60_001, estimate, now)).toBeUndefined();
    expect(chooseStartedAt(estimate + 60_001, estimate, now)).toBeUndefined();
  });

  it('accepts an origin equal to now and rejects one later than now', () => {
    expect(chooseStartedAt(now, now, now)).toBe(now);
    expect(chooseStartedAt(now + 1, now, now)).toBeUndefined();
    expect(chooseStartedAt(now + 5_000, now + 5_000, now)).toBeUndefined();
  });

  it.each([NaN, Infinity, -Infinity, 0, -1, 1.5, 2 ** 60])('rejects the origin %s', (origin) => {
    expect(chooseStartedAt(origin, origin, now)).toBeUndefined();
    expect(chooseStartedAt(origin, estimate, now)).toBeUndefined();
  });

  it('rejects an origin more than 60 s away from the estimate (a bogus early or late origin)', () => {
    expect(chooseStartedAt(1, estimate, now)).toBeUndefined();
    expect(chooseStartedAt(estimate - 3_600_000, estimate, now)).toBeUndefined();
    expect(chooseStartedAt(estimate + 120_000, estimate, now)).toBeUndefined();
  });

  it('rejects an origin when the estimate is not a number', () => {
    expect(chooseStartedAt(estimate, NaN, now)).toBeUndefined();
  });
});
