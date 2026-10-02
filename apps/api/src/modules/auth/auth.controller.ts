import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { loginSchema, logoutSchema, refreshSchema } from '@field-sales/shared';

import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';

/**
 * `createZodDto()` wrapping (rather than exporting these from
 * `packages/shared` itself) deliberately keeps `nestjs-zod` — a
 * NestJS-specific package — out of `packages/shared`, since the mobile app
 * consumes the very same `loginSchema`/`refreshSchema`/`logoutSchema` for
 * its own `react-hook-form` resolvers and has no use for a NestJS DTO
 * wrapper (per this work unit's "one contract" design note).
 */
class LoginDto extends createZodDto(loginSchema) {}
class RefreshDto extends createZodDto(refreshSchema) {}
class LogoutDto extends createZodDto(logoutSchema) {}

/**
 * WU-05 DoD items 3-5. Base path is `auth` (no global prefix is set yet —
 * `apps/api/src/main.ts` is out of this work unit's file scope; see
 * `throttler.config.ts`'s own note that it already matches both the bare
 * and a future `/api/v1`-prefixed form).
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * `@Public()` short-circuits `JwtAuthGuard`/`ActiveAccountGuard`/
   * `TransactionInterceptor` (WU-04). The FR-010 lockout is enforced
   * inside `AuthService.login()` itself (via its constructor-injected
   * `LoginThrottlerGuard`), not via `@UseGuards(LoginThrottlerGuard)`
   * here — see that guard class's "WU-05 addendum" doc comment for the
   * live-verified reason a per-route `@UseGuards()` on a class that's
   * also an ordinary provider silently does not share state with it.
   */
  // contracts/auth.md specifies `200` for both login and refresh; Nest's
  // default status for any `@Post()` handler is `201`, so both need an
  // explicit override.
  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: RefreshDto) {
    return this.authService.refresh(body.refreshToken);
  }

  /**
   * Not `@Public()` — "any authenticated role" (contracts/auth.md): the
   * global `JwtAuthGuard`/`ActiveAccountGuard` pair still runs, so only a
   * caller with a currently-valid access token reaches this handler at
   * all. No `@Roles()`/`@Permissions()` restriction beyond that, since
   * every role may log itself out.
   */
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() body: LogoutDto): Promise<void> {
    await this.authService.logout(body.refreshToken);
  }
}
