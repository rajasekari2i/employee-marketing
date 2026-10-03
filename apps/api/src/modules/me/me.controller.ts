import { Controller, Get, Req } from '@nestjs/common';
import { AppError } from '@field-sales/shared';

import type { AuthenticatedRequest } from '../../common/guards/jwt-auth.guard';
import { MeService } from './me.service';

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
}
