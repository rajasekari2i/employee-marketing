import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';

import { Injectable } from '@nestjs/common';
import { loadEnv } from '@field-sales/shared';

import type { StorageAdapter } from './storage-adapter.interface';

/**
 * WU-06 DoD item 1 / Architecture §12: writes avatar files under
 * `process.env.RAILWAY_VOLUME_MOUNT_PATH` (Zod-validated at boot by
 * `packages/shared/src/env.ts`). The exact sharding
 * (`photos/<companyId>/<yyyy>/<mm>/<uuid>.webp`) is decided by the caller
 * (`FilesService`) — this adapter only knows how to turn an already-built
 * `key` into bytes on disk, mirroring the plain `put/get/delete/exists`
 * shape a later `S3Adapter` (Architecture D-11) will also implement
 * against the same `StorageAdapter` contract.
 *
 * `mime` is accepted to satisfy the interface (an S3-backed adapter would
 * need it for the object's `Content-Type` metadata) but unused here — a
 * local file has no separate content-type attribute; `FileObject.mimeType`
 * (set by `FilesService`) is this codebase's single source of truth for
 * that when a file is served back out.
 */
@Injectable()
export class LocalVolumeAdapter implements StorageAdapter {
  private readonly root: string;

  constructor() {
    this.root = resolve(loadEnv().RAILWAY_VOLUME_MOUNT_PATH);
  }

  async put(key: string, body: Buffer, mime: string): Promise<void> {
    // Deliberately unused — see this method's doc comment above (no
    // per-file content-type attribute on a local filesystem).
    void mime;
    const path = this.resolveKey(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  get(key: string): Promise<Readable> {
    // No `await` needed — `createReadStream` is synchronous to construct
    // (it opens the underlying fd lazily on first read), so this wraps it
    // in an already-resolved Promise to satisfy `StorageAdapter`'s async
    // contract (a future `S3Adapter` genuinely awaits a network call here).
    return Promise.resolve(createReadStream(this.resolveKey(key)));
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolveKey(key));
    } catch (error) {
      // Idempotent delete: a key that is already gone is not an error for
      // this interface's callers (e.g. a dedupe/cleanup sweep retried
      // after a partial failure).
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolves `key` against the volume root and refuses to let it escape
   * that root. Every key this codebase generates is server-controlled
   * (`FilesService`'s own `<uuid>`-based sharding), never client input —
   * this is a cheap, defensive guard against a path-traversal bug slipping
   * in later, not a response to any known live attack surface.
   */
  private resolveKey(key: string): string {
    const fullPath = resolve(this.root, key);
    if (fullPath !== this.root && !fullPath.startsWith(this.root + sep)) {
      throw new Error(`Storage key resolves outside the volume root: "${key}"`);
    }
    return fullPath;
  }
}
