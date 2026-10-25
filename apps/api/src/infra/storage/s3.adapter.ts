import type { Readable } from 'node:stream';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { loadEnv } from '@field-sales/shared';

import type { StorageAdapter } from './storage-adapter.interface';

/**
 * S3-compatible object storage — Architecture D-11's "swappable to S3/MinIO
 * without touching business code", now built.
 *
 * Selected by `STORAGE_DRIVER=s3`; {@link LocalVolumeAdapter} remains the
 * default. Nothing outside this file knows which is in use: both implement
 * {@link StorageAdapter}, and `FilesService` holds the interface.
 *
 * **Works against any S3-compatible endpoint** — AWS, Railway's object
 * storage, MinIO, Cloudflare R2 — because `S3_ENDPOINT` and
 * `S3_FORCE_PATH_STYLE` are configurable. Non-AWS providers almost always
 * need both: they serve one host rather than a per-bucket subdomain, so the
 * bucket has to travel in the path.
 *
 * The `key` is the same sharded key the local adapter uses
 * (`photos/<companyId>/<yyyy>/<mm>/<uuid>.webp`). On S3 those slashes are
 * just part of a flat key rather than real directories, which is why no
 * bucket "folders" need creating — the first upload materialises the
 * prefix.
 */
export class S3Adapter implements StorageAdapter {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const env = loadEnv();

    // Validated as a group by env.ts when STORAGE_DRIVER=s3, so these are
    // present by the time this runs. The non-null assertions document that
    // the check lives there rather than being repeated here.
    this.bucket = env.S3_BUCKET as string;

    this.client = new S3Client({
      region: env.S3_REGION ?? 'us-east-1',
      // Omitted for AWS, required for everyone else.
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      // MinIO, R2 and most self-hosted gateways serve `host/bucket/key`
      // rather than `bucket.host/key`.
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID as string,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY as string,
      },
    });
  }

  async put(key: string, body: Buffer, mime: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: mime,
      }),
    );
  }

  async get(key: string): Promise<Readable> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!result.Body) {
      throw new Error(`No object body returned for key "${key}"`);
    }
    // In Node the SDK always yields a Readable; the union in its types covers
    // the browser's Blob/ReadableStream, which cannot occur here.
    return result.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    // S3 DeleteObject is already idempotent — deleting a missing key
    // succeeds — which matches the no-op-on-absent contract the interface
    // documents and the local adapter implements by catching ENOENT.
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch (error) {
      // A missing key is `NotFound`/404; anything else — credentials,
      // networking, a wrong bucket — is a real fault and must not be
      // reported as "the file isn't there", which would silently look like
      // a deleted photo rather than a broken configuration.
      const name = (error as { name?: string }).name;
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (name === 'NotFound' || name === 'NoSuchKey' || status === 404) {
        return false;
      }
      throw error;
    }
  }
}
