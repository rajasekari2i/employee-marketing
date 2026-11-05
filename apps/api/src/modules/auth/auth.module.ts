import { Module } from '@nestjs/common';

import { LoginThrottlerGuard } from '../../common/guards/login-throttler.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

/**
 * WU-05 DoD item 7. `LoginThrottlerGuard` (built in WU-04, unregistered
 * anywhere until now) is listed as a provider here so `AuthService` can
 * get it via ordinary constructor injection and call `assertNotLocked()`
 * directly on that singleton instance.
 *
 * Deliberately NOT also applied via `@UseGuards(LoginThrottlerGuard)` on
 * `AuthController.login()` — see `login-throttler.guard.ts`'s "WU-05
 * addendum" for why: Nest keeps a class referenced by `@UseGuards()` in a
 * separate `_injectables` map from `_providers`, instantiated
 * independently, so that path would get its own, differently-populated
 * copy of the guard's in-memory failure-count `Map` — confirmed by live
 * reproduction, not assumption. `AuthService`'s direct method call on its
 * one constructor-injected instance is the only enforcement point.
 */
@Module({
  controllers: [AuthController],
  providers: [AuthService, TokenService, LoginThrottlerGuard],
  // `UsersModule` injects `TokenService` directly for `POST
  // /users/:id/revoke-sessions` — the same in-process reuse `FilesModule`
  // already provides `UsersModule` with for `signFileUrl()`, rather than a
  // second copy of the refresh-token revocation logic. Only `TokenService`
  // is exported: `AuthService` stays internal to this module.
  exports: [TokenService],
})
export class AuthModule {}
