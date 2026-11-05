import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type { Readable } from 'node:stream';

import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, type FileObject } from '@prisma/client';
import { AppError, loadEnv } from '@field-sales/shared';
import sharp from 'sharp';

import { createStorageAdapter } from '../../infra/storage/storage.factory';
import type { StorageAdapter } from '../../infra/storage/storage-adapter.interface';

/**
 * Own module-level, unextended Prisma client — same established pattern as
 * `auth.service.ts`/`companies.service.ts`/`me.service.ts` (see those
 * files' comments for why there is still no shared `PrismaService`).
 * `FileObject` IS a `tenant.extension.ts` `TENANT_MODELS` entry, so every
 * operation here opens its own transaction and sets the Postgres RLS
 * session variable itself first, exactly like those other services do for
 * `User`.
 */
const prisma = new PrismaClient();

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const FULL_LONG_EDGE = 1600;
const THUMB_LONG_EDGE = 320;
const WEBP_QUALITY = 80;
const TOKEN_TTL_SECONDS = 10 * 60;

/** Sentinel for a `null` companyId inside the signed token's payload — same convention `token.service.ts` already uses for the identical "null company" case in `RefreshToken`'s opaque value. */
const NULL_COMPANY_SENTINEL = '-';

/**
 * How long an unattached `USER_AVATAR` row is left alone before
 * {@link FilesService.sweepAbandonedAvatars} will remove it. Both legs of
 * the attach flow (`POST /files/avatars`, then `POST`/`PATCH /users`) are
 * ordinary online requests within one form session, so this is generous by
 * three orders of magnitude on purpose — the cost of waiting a day is a
 * few stale rows, the cost of being too eager is deleting a photo out from
 * under a form somebody still has open.
 */
const ABANDONED_UPLOAD_GRACE_HOURS = 24;

/** Most rows one sweep run will remove, so a backlog is worked off over several nights instead of in one long transaction. */
const SWEEP_BATCH_LIMIT = 500;

/** Advisory-lock name for the sweep (Architecture §14 — every scheduled job takes one so overlapping replicas cannot double-run it). */
const SWEEP_LOCK_NAME = 'sweep-abandoned-avatars';

const ALLOWED_DECLARED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
]);

/**
 * The subset of a Prisma transaction client
 * {@link FilesService.deleteIfUnreferenced} needs. Declared structurally
 * rather than as `Prisma.TransactionClient` so BOTH kinds of transaction
 * in this codebase can be passed: the unextended one `me.service.ts`
 * opens itself, and the Layer-1 tenant-extended one `users.service.ts`
 * picks up off CLS.
 */
export type FileCleanupTx = Pick<
  PrismaClient,
  'fileObject' | 'user' | 'shopPhoto'
>;

/** Where one `FileObject`'s bytes live — the pair every deletion has to remove once the row is gone. */
type StoredObjectKeys = { storageKey: string; thumbKey: string | null };

/** What one {@link FilesService.sweepAbandonedAvatars} run did. `skipped` means another replica held the advisory lock, which is a normal outcome during a deploy, not a failure. */
export interface SweepResult {
  skipped: boolean;
  deleted: number;
}

export interface ServedFile {
  stream: Readable;
  mimeType: string;
  /** `null` for a thumbnail (its byte size isn't tracked on `FileObject`). */
  byteSize: number | null;
}

interface FileTokenClaims {
  fileId: string;
  userId: string;
  companyId: string | null;
}

/**
 * Minimal magic-byte sniffing for the 4 allowed avatar formats
 * (contracts/files.md pipeline step 2 — "not just the declared
 * Content-Type"). WU-06 DoD item 2 explicitly allows either a library
 * (`file-type`) or a hand-rolled check; this codebase picks the latter to
 * avoid pulling in an ESM-only dependency into this CommonJS NestJS build
 * for a 4-format check this small.
 */
function detectImageType(buffer: Buffer): string | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg';
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  // ISO base media file format (HEIC/HEIF container): a `ftyp` box at byte
  // offset 4, followed by a 4-byte brand at offset 8 identifying it as one
  // of the HEIC/HEIF brand codes (as opposed to, say, an MP4/MOV file,
  // which uses the same container box but a different brand).
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12);
    const heicBrands = new Set([
      'heic',
      'heix',
      'heim',
      'heis',
      'hevc',
      'hevx',
      'hevm',
      'hevs',
      'mif1',
      'msf1',
    ]);
    if (heicBrands.has(brand)) {
      return 'image/heic';
    }
  }

  return null;
}

/**
 * Backs the avatar upload pipeline (WU-06 DoD items 1–2) and `GET
 * /files/:id?token=` (DoD item 3), per `contracts/files.md` and
 * Architecture §12. `uploadAvatar` has no HTTP route of its own in this
 * slice — per `contracts/files.md`, avatars are only ever uploaded through
 * `PATCH /me/photo` or embedded on `POST/PATCH /users` (User Stories 3/4,
 * not yet built), which will call this method directly once they exist.
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly storage: StorageAdapter;

  constructor() {
    // Which adapter is decided by STORAGE_DRIVER, in one place. This
    // service holds the interface and never learns which it got.
    this.storage = createStorageAdapter();
  }

  /**
   * Architecture §12's pipeline, applied identically everywhere a photo is
   * accepted: validate size/declared type/magic bytes, auto-rotate + strip
   * metadata + resize + WebP-encode (full + thumbnail) via `sharp`, hash
   * the result, dedupe within the company by `sha256`, otherwise persist
   * to storage and insert one `FileObject` row.
   *
   * `companyId: string | null` (User Story 4, decision #5): `PATCH
   * /me/photo` (contracts/me.md) is "any authenticated role", which
   * includes `SYSTEM_ADMIN` (`companyId: null`) — this widening lets this
   * method serve that caller too, mirroring the `string | null` shape
   * `getForServing`/`signFileUrl` already use in this same file. Sets
   * `app.is_system_context` instead of `app.company_id` when `companyId`
   * is `null` (the same escape `auth.service.ts`/`active-account.guard.ts`
   * already use for the identical reason), and uses
   * `NULL_COMPANY_SENTINEL` for the storage-key path segment rather than
   * letting `companyId` flow unguarded into a template literal (which
   * would otherwise silently write a literal `"photos/null/..."` path).
   */
  async uploadAvatar(
    companyId: string | null,
    uploadedBy: string,
    buffer: Buffer,
    declaredMimeType: string,
  ): Promise<FileObject> {
    return this.processAndStore(
      companyId,
      uploadedBy,
      buffer,
      declaredMimeType,
      'USER_AVATAR',
    );
  }

  /**
   * 002-shops-crud: `POST /shops/:id/photos`. Same pipeline as
   * `uploadAvatar` (validate, strip/resize/WebP-encode, hash/dedupe), just
   * tagged `kind: 'SHOP_PHOTO'` instead — see {@link processAndStore}.
   */
  async uploadShopPhoto(
    companyId: string,
    uploadedBy: string,
    buffer: Buffer,
    declaredMimeType: string,
  ): Promise<FileObject> {
    return this.processAndStore(
      companyId,
      uploadedBy,
      buffer,
      declaredMimeType,
      'SHOP_PHOTO',
    );
  }

  /**
   * The shared image pipeline `uploadAvatar`/`uploadShopPhoto` both call —
   * extracted (002-shops-crud) so a second photo-accepting entity didn't
   * mean copying ~70 lines of validate/resize/hash/dedupe logic. Behavior
   * for `uploadAvatar`'s existing `'USER_AVATAR'` callers is unchanged.
   */
  private async processAndStore(
    companyId: string | null,
    uploadedBy: string,
    buffer: Buffer,
    declaredMimeType: string,
    kind: 'USER_AVATAR' | 'SHOP_PHOTO',
  ): Promise<FileObject> {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new AppError('VALIDATION_FAILED', 'Empty upload.');
    }
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new AppError(
        'VALIDATION_FAILED',
        'File exceeds the 10 MB upload limit.',
      );
    }
    if (!ALLOWED_DECLARED_MIME_TYPES.has(declaredMimeType)) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Unsupported declared content type "${declaredMimeType}".`,
      );
    }

    const sniffed = detectImageType(buffer);
    if (!sniffed) {
      throw new AppError(
        'VALIDATION_FAILED',
        'File content does not match a supported image format (magic-byte check failed).',
      );
    }

    // sharp's default output strips all metadata (EXIF included) unless
    // `.withMetadata()` is explicitly called, which this pipeline never
    // does — satisfies "strip all other metadata". `.rotate()` with no
    // argument auto-orients from the EXIF orientation tag before that
    // metadata is dropped. `fit: 'inside'` + `withoutEnlargement: true`
    // resizes to at most a 1600px long edge, preserving aspect ratio, and
    // never upscales an already-smaller image.
    //
    // The magic-byte check above only confirms the container/brand, not
    // that the payload is a genuinely well-formed, fully-decodable image
    // (found empirically: a truncated/corrupt file with valid magic bytes
    // makes sharp/libheif throw a raw, non-`AppError` exception) — wrapped
    // here so a corrupt upload still surfaces as a clean `400
    // VALIDATION_FAILED` instead of an uncaught 500.
    let fullBuffer: Buffer;
    let fullInfo: { width: number; height: number };
    let thumbBuffer: Buffer;
    try {
      ({ data: fullBuffer, info: fullInfo } = await sharp(buffer)
        .rotate()
        .resize({
          width: FULL_LONG_EDGE,
          height: FULL_LONG_EDGE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer({ resolveWithObject: true }));

      ({ data: thumbBuffer } = await sharp(buffer)
        .rotate()
        .resize({
          width: THUMB_LONG_EDGE,
          height: THUMB_LONG_EDGE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer({ resolveWithObject: true }));
    } catch (error) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Could not decode image: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    const sha256 = createHash('sha256').update(fullBuffer).digest('hex');

    return prisma.$transaction(async (tx) => {
      if (companyId) {
        await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
      } else {
        await tx.$executeRaw`SELECT set_config('app.is_system_context', 'true', true)`;
      }

      // Dedupe within the company (DoD item 2): an identical processed
      // image reuses the existing row/storage objects rather than writing
      // duplicates. A plain `where: { companyId: null, ... }` Prisma
      // filter already means "rows where this column is literally null",
      // same grouping `User` rows already use for a `null` companyId — no
      // special-casing needed beyond the RLS session variable above.
      const existing = await tx.fileObject.findFirst({
        where: { companyId, kind, sha256 },
      });
      if (existing) {
        return existing;
      }

      const id = randomUUID();
      const now = new Date();
      const yyyy = String(now.getUTCFullYear());
      const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
      const companySegment = companyId ?? NULL_COMPANY_SENTINEL;

      // The prefix reflects what the photo IS, so the two kinds land in
      // separate trees rather than one shared `photos/` directory. The
      // database already distinguishes them via `FileObject.kind`; this is
      // for the human looking at the bucket or the volume, which is a real
      // need when someone has to find or audit a file by hand.
      //
      // Reads are unaffected by this changing: every read goes through the
      // `storageKey`/`thumbKey` STORED on the row, never a path rebuilt
      // from the parts. Files written before this keep their `photos/...`
      // keys and keep working, so no migration and no backfill.
      const prefix = kind === 'SHOP_PHOTO' ? 'shop-picture' : 'user-profile';
      const storageKey = `${prefix}/${companySegment}/${yyyy}/${mm}/${id}.webp`;
      const thumbKey = `${prefix}/${companySegment}/${yyyy}/${mm}/${id}_thumb.webp`;

      await this.storage.put(storageKey, fullBuffer, 'image/webp');
      await this.storage.put(thumbKey, thumbBuffer, 'image/webp');

      return tx.fileObject.create({
        data: {
          id,
          companyId,
          kind,
          storageKey,
          // The stored/served bytes are always the processed WebP output,
          // regardless of what format was uploaded — so this is always
          // "image/webp", not `declaredMimeType`/`sniffed`.
          mimeType: 'image/webp',
          byteSize: fullBuffer.length,
          width: fullInfo.width,
          height: fullInfo.height,
          sha256,
          thumbKey,
          uploadedBy,
        },
      });
    });
  }

  /**
   * Deletes a `FileObject` row and the bytes behind it, once nothing
   * points at it any more.
   *
   * A profile photo is deliberately NOT versioned: replacing someone's
   * photo REPLACES it, it does not leave the old row sitting in
   * `file_objects` next to the new one. So every place that repoints
   * `User.photoId` calls this with the id it has just stopped pointing
   * at. This is not a hole in Constitution rule 4 (append-only history):
   * that rule is about records a manager reviews after the fact —
   * attendance amendments, salary corrections, shop pin changes. An
   * avatar is not a record of anything, and nothing in BRD/PRD ever asks
   * to see a previous one.
   *
   * Must be called with the SAME transaction that did the repoint, after
   * the repoint — the reference count below has to see the new state, not
   * the committed old one, or it would always find the user still
   * pointing at their previous photo and never delete a thing.
   *
   * Deliberately conservative: it only deletes a genuinely unreferenced
   * row, which covers two cases that look like "the old photo" but are
   * not:
   *  - re-uploading the identical image dedupes to the SAME row the user
   *    already has (see {@link processAndStore}), so the "previous" id
   *    handed in here is sometimes the id that was just saved;
   *  - a `SHOP_PHOTO` row can be referenced by several `ShopPhoto` rows.
   * Either shows up as a non-zero count and leaves the row alone.
   */
  async deleteIfUnreferenced(tx: FileCleanupTx, fileId: string): Promise<void> {
    const keys = await this.deleteRowIfUnreferenced(tx, fileId);
    if (keys) {
      await this.deleteObjects(keys);
    }
  }

  /**
   * Removes `USER_AVATAR` rows that were uploaded through `POST
   * /files/avatars` and then never attached to anybody — the admin who
   * picked a photo on the User form and then picked a different one, or
   * closed the form without saving. The upload happens the moment the
   * photo is picked (`UserFormScreen.pickAndUploadPhoto`), so the row
   * exists well before the request that would have given it an owner, and
   * nothing is left pointing at it when that request never comes.
   *
   * Two things keep this from eating a photo someone is mid-way through
   * attaching:
   *  - only rows older than {@link ABANDONED_UPLOAD_GRACE_HOURS} are even
   *    considered, which is orders of magnitude longer than the gap
   *    between picking a photo and saving the form (both legs are plain
   *    online requests — neither the upload nor `POST`/`PATCH /users` goes
   *    through the mobile outbox);
   *  - every candidate still goes through the same reference count every
   *    other deletion does.
   *
   * `SHOP_PHOTO` rows are deliberately out of scope: `POST
   * /shops/:id/photos` uploads and attaches in a single request, so a shop
   * photo has no window in which it can be abandoned.
   *
   * Companies are walked one at a time because that is what the tenant
   * boundary allows — `file_objects` is RLS-`FORCE`d, and the policy only
   * reveals rows matching the `app.company_id` currently set (or, for the
   * System Admin's own `company_id IS NULL` rows, `app.is_system_context`).
   * There is no "all tenants" value, by design, so a cross-tenant sweep is
   * a loop of correctly-scoped passes rather than one unscoped query.
   * Re-setting `app.company_id` partway through a transaction is the same
   * thing `users.service.ts` already does per request.
   */
  async sweepAbandonedAvatars(): Promise<SweepResult> {
    const cutoff = new Date(
      Date.now() - ABANDONED_UPLOAD_GRACE_HOURS * 60 * 60 * 1000,
    );

    // `Company` is one of Architecture §5's documented RLS exemptions, so
    // this read needs no tenant scope — it is what establishes the scopes
    // used below. `null` is appended for the System Admin's own avatars,
    // which belong to no company and are invisible under every
    // `app.company_id` value.
    const companies = await prisma.company.findMany({ select: { id: true } });
    const scopes: (string | null)[] = [...companies.map((c) => c.id), null];

    // One transaction for the whole sweep, so the advisory lock below can
    // be the transaction-scoped kind (`pg_try_advisory_xact_lock`) and get
    // released on commit, rollback or a dropped connection alike, with no
    // unlock path to forget. Architecture D-14 / §14 require the lock:
    // during a deploy two replicas overlap, and this must not double-run.
    const keysToDelete = await prisma.$transaction(async (tx) => {
      const [{ locked }] = await tx.$queryRaw<[{ locked: boolean }]>`
        SELECT pg_try_advisory_xact_lock(hashtext(${SWEEP_LOCK_NAME})) AS locked
      `;
      if (!locked) {
        return null;
      }

      const collected: StoredObjectKeys[] = [];
      for (const companyId of scopes) {
        if (collected.length >= SWEEP_BATCH_LIMIT) {
          break;
        }
        if (companyId) {
          await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
        } else {
          await tx.$executeRaw`SELECT set_config('app.is_system_context', 'true', true)`;
        }

        const candidates = await tx.fileObject.findMany({
          where: {
            companyId,
            kind: 'USER_AVATAR',
            createdAt: { lt: cutoff },
            // The back-side of `User.photoId`. Narrowing here rather than
            // loading every old avatar and rejecting most of them in
            // `deleteRowIfUnreferenced` keeps the scan proportional to the
            // abandoned rows, not to the table.
            user: null,
          },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
          take: SWEEP_BATCH_LIMIT - collected.length,
        });

        for (const candidate of candidates) {
          const keys = await this.deleteRowIfUnreferenced(tx, candidate.id);
          if (keys) {
            collected.push(keys);
          }
        }
      }

      return collected;
    });

    if (keysToDelete === null) {
      return { skipped: true, deleted: 0 };
    }

    // Deliberately outside the transaction: unlike the replacement path
    // (which has no commit hook to hang this on), a sweep owns its own
    // transaction and can wait for the commit. Removing bytes only once
    // the row removal is durable means a rollback can never strand a live
    // row whose file is already gone.
    for (const keys of keysToDelete) {
      await this.deleteObjects(keys);
    }

    return { skipped: false, deleted: keysToDelete.length };
  }

  /**
   * The row half of a deletion, shared by {@link deleteIfUnreferenced} and
   * {@link sweepAbandonedAvatars}. Returns the storage keys that are now
   * unreachable (so the caller can remove the bytes whenever it is safe to
   * do so), or `null` when the row is gone or still referenced.
   *
   * The reference count is the whole safety of this: it covers two cases
   * that look like a stale row but are not:
   *  - re-uploading the identical image dedupes to the SAME row the user
   *    already has (see {@link processAndStore}), so the "previous" id
   *    handed in is sometimes the id that was just saved;
   *  - a `SHOP_PHOTO` row can be referenced by several `ShopPhoto` rows.
   */
  private async deleteRowIfUnreferenced(
    tx: FileCleanupTx,
    fileId: string,
  ): Promise<StoredObjectKeys | null> {
    const file = await tx.fileObject.findUnique({
      where: { id: fileId },
      select: { storageKey: true, thumbKey: true },
    });
    if (!file) {
      return null;
    }

    // Sequential, not `Promise.all`: an interactive Prisma transaction is
    // one connection, and firing concurrent queries at it buys nothing.
    const userRefs = await tx.user.count({ where: { photoId: fileId } });
    if (userRefs > 0) {
      return null;
    }
    const shopPhotoRefs = await tx.shopPhoto.count({ where: { fileId } });
    if (shopPhotoRefs > 0) {
      return null;
    }

    await tx.fileObject.delete({ where: { id: fileId } });
    return file;
  }

  /**
   * Bytes go after the row, never before, and a failure to remove them is
   * logged rather than thrown. Both are the same judgement: the row is
   * what makes a file reachable, so an orphaned object on the volume is
   * harmless (and re-sweepable), whereas failing the caller's request —
   * or rolling its transaction back onto a row whose bytes are already
   * gone — would be a visibly broken photo for a real user.
   */
  private async deleteObjects(keys: StoredObjectKeys): Promise<void> {
    await this.deleteObjectQuietly(keys.storageKey);
    if (keys.thumbKey) {
      await this.deleteObjectQuietly(keys.thumbKey);
    }
  }

  /** See {@link deleteObjects} for why a failure here is swallowed. */
  private async deleteObjectQuietly(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (error) {
      this.logger.warn(
        `Could not remove photo object "${key}" from storage; the file_objects row is already gone, so this leaves an unreachable object behind: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  /**
   * Mints a signed `GET /files/:id` URL (path + query string) for one
   * viewer. contracts/files.md step 5 ("return its id and a signed URL for
   * immediate display") — called once here by nothing yet (no live HTTP
   * caller in this slice), for future callers (`PATCH /me/photo`, `GET
   * /me`, `GET /users`) to invoke directly once they exist. Each caller
   * mints its own fresh URL per viewer rather than reusing one past its
   * 10-minute expiry.
   */
  signFileUrl(
    fileId: string,
    viewerUserId: string,
    companyId: string | null,
    thumb = false,
  ): string {
    const token = this.signToken(fileId, viewerUserId, companyId);
    const query = thumb ? `token=${token}&thumb=1` : `token=${token}`;
    // Relative to the API's own origin, same convention as
    // apps/mobile/src/api/client.ts's `${API_URL}${path}` — must match
    // main.ts's `api/v1` global prefix, under which this controller is
    // actually mounted.
    return `/api/v1/files/${fileId}?${query}`;
  }

  /**
   * Backs `GET /files/:id?token=&thumb=` (DoD item 3). Verifies the
   * signed token, then looks up the `FileObject` row — the token itself
   * carries the row's `companyId` (see `signToken`'s doc comment for why)
   * so this lookup can set the correct Postgres RLS session variable
   * *before* ever touching the RLS-`FORCE`d `file_objects` table, exactly
   * the same chicken-and-egg problem `token.service.ts` already solves
   * for `RefreshToken`→`User`.
   */
  async getForServing(
    fileId: string,
    token: string,
    thumb: boolean,
  ): Promise<ServedFile> {
    const claims = this.verifyToken(token);
    if (!claims || claims.fileId !== fileId) {
      throw new AppError(
        'FORBIDDEN',
        'Missing, invalid or expired file token.',
      );
    }

    const file = await prisma.$transaction(async (tx) => {
      if (claims.companyId) {
        await tx.$executeRaw`SELECT set_config('app.company_id', ${claims.companyId}, true)`;
      } else {
        await tx.$executeRaw`SELECT set_config('app.is_system_context', 'true', true)`;
      }
      return tx.fileObject.findUnique({ where: { id: fileId } });
    });

    if (!file) {
      throw new AppError('NOT_FOUND', `File "${fileId}" was not found.`);
    }

    const key = thumb ? (file.thumbKey ?? file.storageKey) : file.storageKey;
    const stream = await this.storage.get(key);

    return {
      stream,
      mimeType: file.mimeType,
      byteSize: thumb ? null : file.byteSize,
    };
  }

  /**
   * Signed payload is `fileId|userId|companyId-or-"-"|exp`, HMAC-SHA256'd
   * with `FILE_URL_SECRET` (contracts/files.md: "a 10-minute HMAC of
   * fileId|userId|exp" — not a JWT). `companyId` is carried as the same
   * kind of routing metadata `token.service.ts`'s refresh-token opaque
   * value already carries it as (see that file's "Refresh token lookup
   * scheme" doc comment): `FileObject`/`User` are both RLS-`FORCE`d
   * (WU-03), and the policy requires the caller to already know+set the
   * exact `companyId` (or the `is_system_context` escape for a `null` one)
   * *before* a row becomes visible at all — there is no way to read a
   * `FileObject`'s own `companyId` first to decide which session variable
   * to set, because reading it is exactly what's gated. Embedding it in
   * the token (signed, so it can't be tampered with independently of
   * `fileId`/`userId`/`exp`) is this slice's way of breaking that same
   * chicken-and-egg problem for file serving.
   */
  private signToken(
    fileId: string,
    userId: string,
    companyId: string | null,
  ): string {
    const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    const companySegment = companyId ?? NULL_COMPANY_SENTINEL;
    const payload = `${fileId}|${userId}|${companySegment}|${exp}`;
    const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url');
    const signature = this.hmac(payload);
    return `${payloadB64}.${signature}`;
  }

  /** Inverse of {@link signToken}. Returns `null` for anything malformed, signature-invalid or expired — the controller/caller maps that uniformly to `403 FORBIDDEN` without distinguishing which (same "don't reveal which" posture `ActiveAccountGuard` already uses). */
  private verifyToken(token: string): FileTokenClaims | null {
    if (!token) {
      return null;
    }

    const parts = token.split('.');
    if (parts.length !== 2) {
      return null;
    }
    const [payloadB64, signature] = parts;

    let payload: string;
    try {
      payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
    } catch {
      return null;
    }

    const expectedSignature = this.hmac(payload);
    if (!this.safeEqual(signature, expectedSignature)) {
      return null;
    }

    const segments = payload.split('|');
    if (segments.length !== 4) {
      return null;
    }
    const [fileId, userId, companySegment, expStr] = segments;
    const exp = Number(expStr);
    if (!fileId || !userId || !Number.isFinite(exp)) {
      return null;
    }
    if (Math.floor(Date.now() / 1000) > exp) {
      return null;
    }

    return {
      fileId,
      userId,
      companyId:
        companySegment === NULL_COMPANY_SENTINEL ? null : companySegment,
    };
  }

  private hmac(payload: string): string {
    const secret = loadEnv().FILE_URL_SECRET;
    return createHmac('sha256', secret).update(payload).digest('base64url');
  }

  /** Constant-time signature comparison — a timing side-channel on this check would otherwise leak how many leading bytes of a forged signature are correct. */
  private safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  }
}
