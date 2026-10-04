import { Module } from '@nestjs/common';

import { FilesModule } from '../files/files.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';

/**
 * User Story 2 (specs/001-company-user-auth/orchestration-plan.md), DoD
 * item 1, extended by User Story 4 (decision #5) with `PATCH /me/photo`.
 * Imports `FilesModule` so `MeService` can constructor-inject its exported
 * `FilesService` directly (`uploadAvatar()`/`signFileUrl()`) — the exact
 * same one-line addition `users.module.ts` already needed for the
 * identical reason (`FilesModule` is not `@Global()`).
 */
@Module({
  imports: [FilesModule],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
