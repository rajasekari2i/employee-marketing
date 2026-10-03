import type { Readable } from 'node:stream';

/**
 * Architecture §12's photo-storage abstraction. Every place in this
 * codebase that reads or writes a stored avatar file goes through this
 * interface, never a raw filesystem/S3 call directly — so swapping
 * `LocalVolumeAdapter` (this slice, WU-06) for an `S3Adapter` (a later
 * slice, Architecture D-11) is a configuration change to whichever module
 * provides `StorageAdapter`, not a rewrite of `FilesService`.
 *
 * `key` is always the full, already-sharded storage key this codebase
 * generates itself (`photos/<companyId>/<yyyy>/<mm>/<uuid>.webp` — see
 * `FilesService.uploadAvatar`), never client-supplied input.
 */
export interface StorageAdapter {
  /** Writes `body` under `key`, creating any missing parent directories. Overwrites if `key` already exists (callers only ever generate fresh, collision-safe keys). */
  put(key: string, body: Buffer, mime: string): Promise<void>;
  /** Returns a readable stream of the bytes stored at `key`. Rejects if `key` does not exist. */
  get(key: string): Promise<Readable>;
  /** Removes the object at `key`. A no-op (not an error) if it does not exist — see `LocalVolumeAdapter` for why. */
  delete(key: string): Promise<void>;
  /** True if an object is currently stored at `key`. */
  exists(key: string): Promise<boolean>;
}
