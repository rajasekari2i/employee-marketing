import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AppError } from '@field-sales/shared';

// `Express.Multer.File` below is a global ambient type `@types/multer`
// declares once installed (`declare global { namespace Express { namespace
// Multer { interface File ... } } }`) — no import needed for it.

import { Audited } from '../../common/decorators/audited.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../../common/guards/jwt-auth.guard';
import { RequireIdempotencyKeyGuard } from '../../common/guards/require-idempotency-key.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { FilesService } from './files.service';

/**
 * Same figure as `main.ts`'s `MULTIPART_BODY_LIMIT_BYTES` (WU-04's
 * documented 10 MB multipart limit) and `files.service.ts`'s own
 * `MAX_UPLOAD_BYTES` (WU-06) — deliberately re-declared here rather than
 * imported from `main.ts`, since `main.ts` imports `AppModule`, which
 * imports `FilesModule`, which imports this controller: importing the
 * constant back out of `main.ts` would create a circular module
 * dependency for a single numeric literal.
 */
const AVATAR_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/**
 * WU-06 DoD item 3 / contracts/files.md, extended by User Story 3
 * (specs/001-company-user-auth/orchestration-plan.md, gaps #1/#2) with
 * `POST /files/avatars`.
 *
 * `@UseGuards(RolesGuard)` at the class level (gap #2): `@Roles(...)`
 * metadata has no effect unless `RolesGuard` is actually applied —
 * harmless for `getFile` below (that method has no `@Roles()` of its own,
 * and `RolesGuard` returns `true` unconditionally for any handler/class
 * with no `@Roles()` metadata).
 */
@ApiTags('files')
@Controller('files')
@UseGuards(RolesGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  /**
   * Streams the image bytes straight from storage via `@Res()` (manual
   * response handling) rather than returning a value for Nest to
   * serialize — `Content-Type` comes from the stored `FileObject.mimeType`
   * (always `image/webp`, the pipeline's own output format), never from
   * client input. An `AppError` thrown inside `getForServing` still
   * reaches the global `ProblemDetailsFilter` as normal — `@Res()` only
   * changes how a *successful* response is written, not exception
   * handling.
   *
   * `@Public()` moved here from the class level (gap #2, User Story 3):
   * this route's auth is its own query-string `?token=` (a signed HMAC,
   * not a JWT), checked inside `FilesService.getForServing`, not the
   * global `JwtAuthGuard`/`ActiveAccountGuard`/`TransactionInterceptor` —
   * see `public.decorator.ts` for the three pipeline consumers this
   * short-circuits. It can no longer live on the class now that
   * `uploadAvatar` below is a second route on this same controller that
   * must NOT be public — `Reflector.getAllAndOverride` checks the handler
   * before the class, so the more specific, correct level is this method.
   */
  @Get(':id')
  @Public()
  async getFile(
    @Param('id') id: string,
    // Express's query parser (`qs`) returns an array for a repeated query
    // key (`?token=A&token=B`) — this `string | undefined` annotation is
    // what Nest's types claim, not what can actually arrive at runtime, so
    // a duplicate `token` key previously reached `FilesService.verifyToken`
    // as a `string[]` and crashed on `.split('.')` being called on an
    // array (found live by adversarial review). Normalizing to `''` for
    // anything that isn't actually a string treats that case exactly like
    // a missing token — `getForServing` already maps an empty token to a
    // clean `403 FORBIDDEN` — instead of an uncaught 500.
    @Query('token') token: string | string[] | undefined,
    @Query('thumb') thumb: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const wantsThumb = thumb === '1';
    const tokenValue = typeof token === 'string' ? token : '';
    const { stream, mimeType, byteSize } =
      await this.filesService.getForServing(id, tokenValue, wantsThumb);

    res.status(200);
    res.setHeader('Content-Type', mimeType);
    if (byteSize !== null) {
      res.setHeader('Content-Length', String(byteSize));
    }
    stream.pipe(res);
  }

  /**
   * `POST /files/avatars` (User Story 3, contracts/files.md's "exception"
   * section / gaps #1-#2). Ordinary authenticated + tenant-scoped (not
   * `@Public()`) — the one upload-then-attach step this slice needs for a
   * brand-new user who doesn't exist yet at the moment their photo is
   * picked on the User form. Calls `FilesService.uploadAvatar()`
   * (unchanged, WU-06) with the ACTING ADMIN's own `companyId`/`id` as the
   * owner metadata — never the not-yet-created target user's.
   *
   * `multer.memoryStorage()` (via `FileInterceptor`'s default) + its own
   * `limits.fileSize`, matching `main.ts`'s documented multipart limit
   * (WU-04). Requires `Idempotency-Key` (gap #1: Constitution rule 3 has no
   * exception for a route that also has its own content-based dedupe) —
   * safe here, unlike `POST /users` staying pure JSON, because
   * `IdempotencyInterceptor.hashRequest()` reads `request.body`, which is
   * deterministically `undefined` for every multipart request regardless
   * of the actual file bytes (multer hasn't run yet at that point in the
   * pipeline) — see gap #1's full reasoning in the orchestration plan for
   * why that degrades gracefully rather than silently breaking retries.
   */
  @Post('avatars')
  @UseGuards(RequireIdempotencyKeyGuard)
  @Roles('COMPANY_ADMIN')
  @Audited('file.upload-avatar', 'FileObject')
  @UseInterceptors(
    FileInterceptor('photo', { limits: { fileSize: AVATAR_UPLOAD_MAX_BYTES } }),
  )
  async uploadAvatar(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ id: string; url: string }> {
    if (!file) {
      throw new AppError('VALIDATION_FAILED', 'No file was uploaded.');
    }

    const companyId = request.user?.companyId;
    const callerId = request.user?.sub;
    if (!companyId || !callerId) {
      throw new AppError(
        'FORBIDDEN_ROLE',
        'This action requires a company-scoped account.',
      );
    }

    const fileObject = await this.filesService.uploadAvatar(
      companyId,
      callerId,
      file.buffer,
      file.mimetype,
    );

    return {
      id: fileObject.id,
      url: this.filesService.signFileUrl(fileObject.id, callerId, companyId),
    };
  }
}
