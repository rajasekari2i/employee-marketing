import { Module } from '@nestjs/common';

import { FilesModule } from '../files/files.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * User Story 3 (specs/001-company-user-auth/orchestration-plan.md), DoD
 * item 12. Imports `FilesModule` to inject its exported `FilesService`
 * directly (`signFileUrl()` for each user's `photoUrl` — no new HTTP call,
 * same in-process reuse `FilesModule`'s own doc comment anticipated).
 */
@Module({
  imports: [FilesModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
