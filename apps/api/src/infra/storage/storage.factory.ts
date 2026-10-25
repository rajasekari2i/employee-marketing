import { loadEnv } from '@field-sales/shared';

import { LocalVolumeAdapter } from './local-volume.adapter';
import { S3Adapter } from './s3.adapter';
import type { StorageAdapter } from './storage-adapter.interface';

/**
 * The one place that decides which {@link StorageAdapter} the application
 * uses — Architecture D-11's "a configuration change to whichever module
 * provides `StorageAdapter`, not a rewrite of `FilesService`".
 *
 * Defaults to the mounted volume, so an environment that says nothing about
 * storage keeps behaving exactly as it did before S3 support existed.
 */
export function createStorageAdapter(): StorageAdapter {
  return loadEnv().STORAGE_DRIVER === 's3'
    ? new S3Adapter()
    : new LocalVolumeAdapter();
}
