import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
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
  // `AuthModule` for its exported `TokenService` (`POST
  // /users/:id/revoke-sessions`). No cycle: `AuthModule` does not import
  // this module.
  imports: [AuthModule, FilesModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
