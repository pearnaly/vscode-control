import { describe, expect, it } from 'vitest';
import { memoizeWithRetry } from '../../bridge/src/memoizeWithRetry';

describe('memoizeWithRetry', () => {
  it('caches a success: load runs once across several calls', async () => {
    let loads = 0;
    const get = memoizeWithRetry(async () => ++loads, 2, () => undefined);
    expect(await Promise.all([get(), get()])).toEqual([1, 1]);
    expect(await get()).toBe(1);
    expect(loads).toBe(1);
  });

  it('retries once after a failure, then caches the success', async () => {
    let loads = 0;
    const errors: unknown[] = [];
    const get = memoizeWithRetry(
      async () => {
        loads += 1;
        if (loads === 1) throw new Error('first');
        return 'ok';
      },
      2,
      (e) => errors.push(e),
    );
    await expect(get()).rejects.toThrow('first');
    expect(await get()).toBe('ok');
    expect(await get()).toBe('ok');
    expect(loads).toBe(2);
    expect(errors).toHaveLength(1);
  });

  it('stops after maxAttempts failures and keeps returning the last rejection', async () => {
    let loads = 0;
    const get = memoizeWithRetry(
      async () => {
        loads += 1;
        throw new Error(`failure ${loads}`);
      },
      2,
      () => undefined,
    );
    await expect(get()).rejects.toThrow('failure 1');
    await expect(get()).rejects.toThrow('failure 2');
    await expect(get()).rejects.toThrow('failure 2');
    await expect(get()).rejects.toThrow('failure 2');
    expect(loads).toBe(2);
  });

  it('calls onError once per failed attempt, not once per call', async () => {
    const errors: string[] = [];
    const get = memoizeWithRetry(
      async () => {
        throw new Error('boom');
      },
      2,
      (e) => errors.push((e as Error).message),
    );
    for (let i = 0; i < 4; i += 1) await get().catch(() => undefined);
    expect(errors).toEqual(['boom', 'boom']);
  });

  it('shares one in-flight attempt between concurrent callers', async () => {
    let loads = 0;
    const get = memoizeWithRetry(
      async () => {
        loads += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return 'done';
      },
      2,
      () => undefined,
    );
    expect(await Promise.all([get(), get(), get()])).toEqual(['done', 'done', 'done']);
    expect(loads).toBe(1);
  });

  it('turns a synchronous throw in load into a rejection that counts as an attempt', async () => {
    let loads = 0;
    const errors: unknown[] = [];
    const get = memoizeWithRetry(
      (): Promise<string> => {
        loads += 1;
        throw new Error('sync');
      },
      2,
      (e) => errors.push(e),
    );
    await expect(get()).rejects.toThrow('sync');
    await expect(get()).rejects.toThrow('sync');
    await expect(get()).rejects.toThrow('sync');
    expect(loads).toBe(2);
    expect(errors).toHaveLength(2);
  });
});
