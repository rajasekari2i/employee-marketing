import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type { Readable } from 'node:stream';

import { Injectable } from '@nestjs/common';
import { PrismaClient, type FileObject } from '@prisma/client';
import { AppError, loadEnv } from '@field-sales/shared';
import sharp from 'sharp';

import { LocalVolumeAdapter } from '../../infra/storage/local-volume.adapter';
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

const ALLOWED_DECLARED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
]);

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
  private readonly storage: StorageAdapter;

  constructor() {
    this.storage = new LocalVolumeAdapter();
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
        where: { companyId, kind: 'USER_AVATAR', sha256 },
      });
      if (existing) {
        return existing;
      }

      const id = randomUUID();
      const now = new Date();
      const yyyy = String(now.getUTCFullYear());
      const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
      const companySegment = companyId ?? NULL_COMPANY_SENTINEL;
      const storageKey = `photos/${companySegment}/${yyyy}/${mm}/${id}.webp`;
      const thumbKey = `photos/${companySegment}/${yyyy}/${mm}/${id}_thumb.webp`;

      await this.storage.put(storageKey, fullBuffer, 'image/webp');
      await this.storage.put(thumbKey, thumbBuffer, 'image/webp');

      return tx.fileObject.create({
        data: {
          id,
          companyId,
          kind: 'USER_AVATAR',
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
    return `/files/${fileId}?${query}`;
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
