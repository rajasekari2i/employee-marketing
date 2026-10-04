import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import {
  AppError,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  resetPasswordSchema,
  verifyOtpSchema,
} from '@field-sales/shared';

import type { AuthenticatedRequest } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { RequireIdempotencyKeyGuard } from '../../common/guards/require-idempotency-key.guard';
import { AuthService } from './auth.service';

/**
 * `createZodDto()` wrapping (rather than exporting these from
 * `packages/shared` itself) deliberately keeps `nestjs-zod` — a
 * NestJS-specific package — out of `packages/shared`, since the mobile app
 * consumes the very same schemas for its own `react-hook-form` resolvers
 * and has no use for a NestJS DTO wrapper (per this work unit's "one
 * contract" design note).
 */
class LoginDto extends createZodDto(loginSchema) {}
class RefreshDto extends createZodDto(refreshSchema) {}
class LogoutDto extends createZodDto(logoutSchema) {}
class ForgotPasswordDto extends createZodDto(forgotPasswordSchema) {}
class VerifyOtpDto extends createZodDto(verifyOtpSchema) {}
class ResetPasswordDto extends createZodDto(resetPasswordSchema) {}
class ChangePasswordDto extends createZodDto(changePasswordSchema) {}

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

  /**
   * User Story 4 (specs/001-company-user-auth/orchestration-plan.md), DoD
   * item 3 / contracts/auth.md. `@Public()`: this is the entry point for a
   * user who, by definition, cannot sign in right now. No
   * `Idempotency-Key` (decision #7) — this route already has its own
   * purpose-built anti-abuse mechanism (the 30-second resend cooldown)
   * that a key would add nothing to.
   */
  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.authService.forgotPassword(body);
  }

  /**
   * DoD item 4. `@Public()`, no `Idempotency-Key` (decision #7) — the
   * 5-attempt cap is this route's own anti-abuse mechanism.
   */
  @Public()
  @Post('verify-otp')
  @HttpCode(200)
  verifyOtp(@Body() body: VerifyOtpDto) {
    return this.authService.verifyOtp(body);
  }

  /**
   * DoD item 5. `@Public()` — contracts/auth.md's "requires `resetToken`
   * (bearer)" heading means this route's authority comes from presenting
   * a valid `resetToken` in the body (verified inside `AuthService`), not
   * a literal `Authorization: Bearer` header (decision #1) — there is no
   * signed-in caller for this route to authenticate via the global
   * `JwtAuthGuard`. Requires `Idempotency-Key` (decision #7,
   * `contracts/auth.md`'s blanket sentence names this route explicitly).
   */
  @Public()
  @Post('reset-password')
  @HttpCode(204)
  @UseGuards(RequireIdempotencyKeyGuard)
  async resetPassword(@Body() body: ResetPasswordDto): Promise<void> {
    await this.authService.resetPassword(body);
  }

  /**
   * DoD item 6. Not `@Public()` — "any authenticated role"
   * (contracts/auth.md), same posture as `logout` above: the global
   * `JwtAuthGuard`/`ActiveAccountGuard` pair still runs. Requires
   * `Idempotency-Key` (decision #7).
   */
  @Post('change-password')
  @HttpCode(204)
  @UseGuards(RequireIdempotencyKeyGuard)
  async changePassword(
    @Req() request: AuthenticatedRequest,
    @Body() body: ChangePasswordDto,
  ): Promise<void> {
    const payload = request.user;

    // Defensive: JwtAuthGuard always runs first (global guard order,
    // app.module.ts) and either populates request.user or rejects the
    // request outright — same defensive shape as MeController.getMe's.
    if (!payload) {
      throw new AppError(
        'INVALID_CREDENTIALS',
        'Missing authenticated user context.',
      );
    }

    await this.authService.changePassword(payload, body);
  }
}
