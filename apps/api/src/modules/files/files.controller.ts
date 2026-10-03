import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

import { Public } from '../../common/decorators/public.decorator';
import { FilesService } from './files.service';

/**
 * WU-06 DoD item 3 / contracts/files.md. The only HTTP route this work
 * unit builds — there is no `POST /files` in this slice (avatars are
 * uploaded only through `PATCH /me/photo` / `POST /users` /
 * `PATCH /users/:id`, none of which exist yet; they call
 * `FilesService.uploadAvatar` directly once built).
 *
 * `@Public()` at the class level: this route's auth is its own
 * query-string `?token=` (a signed HMAC, not a JWT), checked inside
 * `FilesService.getForServing`, not the global `JwtAuthGuard`/
 * `ActiveAccountGuard`/`TransactionInterceptor` — see `public.decorator.ts`
 * for the three pipeline consumers this short-circuits.
 */
@Controller('files')
@Public()
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
   */
  @Get(':id')
  async getFile(
    @Param('id') id: string,
    @Query('token') token: string | undefined,
    @Query('thumb') thumb: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const wantsThumb = thumb === '1';
    const { stream, mimeType, byteSize } =
      await this.filesService.getForServing(id, token ?? '', wantsThumb);

    res.status(200);
    res.setHeader('Content-Type', mimeType);
    if (byteSize !== null) {
      res.setHeader('Content-Length', String(byteSize));
    }
    stream.pipe(res);
  }
}
