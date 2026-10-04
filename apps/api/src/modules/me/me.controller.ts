import {
  Controller,
  Get,
  Patch,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AppError } from '@field-sales/shared';

// `Express.Multer.File` below is the same global ambient type
// `files.controller.ts` already relies on once `@types/multer` is
// installed — no import needed for it.

import type { AuthenticatedRequest } from '../../common/guards/jwt-auth.guard';
import { RequireIdempotencyKeyGuard } from '../../common/guards/require-idempotency-key.guard';
import { MeService } from './me.service';

/**
 * Same figure as `files.controller.ts`'s own re-declared
 * `AVATAR_UPLOAD_MAX_BYTES` (WU-04's documented 10 MB multipart limit) —
 * re-declared here rather than imported for the identical
 * circular-module-dependency reason that file's own comment explains.
 */
const AVATAR_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/**
 * User Story 2 (specs/001-company-user-auth/orchestration-plan.md), DoD
 * item 1 / contracts/me.md. Not `@Public()` and not `@SkipTenant()` — the
 * already-global `JwtAuthGuard`/`ActiveAccountGuard` (WU-04) cover it with
 * zero new guard code, same as `contracts/auth.md`'s `/auth/logout`
 * ("any authenticated role"). No `@Roles()`/`@Permissions()` restriction:
 * every role may read its own profile.
 */
@Controller('me')
export class MeController {
  constructor(private readonly meService: MeService) {}

  /**
   * Reads the caller's identity off `request.user` — populated by
   * `JwtAuthGuard` from the already-verified access token, never from a
   * client-supplied id (there is no `:id` param on this route at all).
   */
  @Get()
  getMe(@Req() request: AuthenticatedRequest) {
    const payload = request.user;

    // Defensive: JwtAuthGuard always runs first (global guard order,
    // app.module.ts) and either populates request.user or rejects the
    // request outright — same defensive shape as ActiveAccountGuard's own
    // check.
    if (!payload) {
      throw new AppError(
        'INVALID_CREDENTIALS',
        'Missing authenticated user context.',
      );
    }

    return this.meService.getMe(payload);
  }

  /**
   * User Story 4 (specs/001-company-user-auth/orchestration-plan.md),
   * DoD item 7 / contracts/me.md. Not `@Public()` — "any authenticated
   * role" (contracts/me.md's own base-path note), the global
   * `JwtAuthGuard`/`ActiveAccountGuard` pair covers it. Requires
   * `Idempotency-Key` (decision #6: Architecture D-15's "every command",
   * applied for the same reason `PATCH /users/:id` already got this guard
   * — a first draft of this plan exempted this route inconsistently with
   * that precedent, corrected here).
   *
   * Same `multer.memoryStorage()` (via `FileInterceptor`'s default) +
   * `limits.fileSize` pattern as `POST /files/avatars`
   * (files.controller.ts) — one `photo` field, same 10 MB ceiling.
   */
  @Patch('photo')
  @UseGuards(RequireIdempotencyKeyGuard)
  @UseInterceptors(
    FileInterceptor('photo', { limits: { fileSize: AVATAR_UPLOAD_MAX_BYTES } }),
  )
  async updatePhoto(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    const payload = request.user;
    if (!payload) {
      throw new AppError(
        'INVALID_CREDENTIALS',
        'Missing authenticated user context.',
      );
    }
    if (!file) {
      throw new AppError('VALIDATION_FAILED', 'No file was uploaded.');
    }

    return this.meService.updatePhoto(payload, file.buffer, file.mimetype);
  }
}
