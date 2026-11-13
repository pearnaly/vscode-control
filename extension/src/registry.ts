import * as fs from 'node:fs';
import * as path from 'node:path';
import { windowRecordSchema, type WindowRecord } from '../../shared/protocol';

/** On Windows another process (virus scanner, indexer, a reader) can briefly hold the target open. */
const RETRYABLE_RENAME_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_RETRIES = 3;
const RENAME_RETRY_PAUSE_MS = 25;

/** Renames `from` over `to`, retrying a few times on the transient errors above. */
function renameWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= RENAME_RETRIES || code === undefined || !RETRYABLE_RENAME_ERRORS.has(code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RENAME_RETRY_PAUSE_MS);
    }
  }
}

/** The window's discovery file `<dir>/<pid>.json`, which the bridge reads to find this window. */
export class Registry {
  readonly file: string;

  constructor(
    private readonly dir: string,
    pid: number,
  ) {
    this.file = path.join(dir, `${pid}.json`);
  }

  /**
   * Writes the record atomically (temp file + rename), creating the directory if needed.
   * Throws without writing anything when the record is invalid; never leaves a temp file behind.
   */
  write(record: WindowRecord): void {
    windowRecordSchema.parse(record);
    // `mode` has no effect on Windows; the user-profile ACL is what protects the token there.
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(record, null, 2), { mode: 0o600 });
      renameWithRetry(tmp, this.file);
    } finally {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        // best effort: never mask the write error
      }
    }
  }

  /** Best effort, never throws: a file that can't be deleted is removed by the bridge once the process is gone. */
  remove(): void {
    try {
      fs.rmSync(this.file, { force: true });
    } catch {
      // see above
    }
  }
}
