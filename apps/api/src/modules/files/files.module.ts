import { Module } from '@nestjs/common';

import { FilesController } from './files.controller';
import { FilesService } from './files.service';

/**
 * WU-06 (specs/001-company-user-auth/orchestration-plan.md), DoD item 4.
 * `FilesService` is exported so future modules (`PATCH /me/photo`,
 * `POST/PATCH /users` — User Stories 3/4, not yet built) can inject it
 * directly to call `uploadAvatar`/`signFileUrl` without this slice having
 * to build those routes itself.
 */
@Module({
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
