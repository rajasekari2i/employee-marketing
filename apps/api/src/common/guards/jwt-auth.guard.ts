import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { AppError, loadEnv, type RoleKey } from '@field-sales/shared';
import type { Request } from 'express';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Shape of the HS512 access token payload. Deliberately defined here —
 * rather than imported from an `auth` module — because there is no
 * `AuthModule`/`TokenService` yet (WU-05 builds those next); this guard
 * must be able to verify a token on its own. Kept minimal and exactly
 * matching what WU-05's `TokenService` will sign, per this work unit's
 * design notes, so WU-05 doesn't have to change this guard later.
 */
export interface AccessTokenPayload {
  /** User id (`User.id`). */
  sub: string;
  companyId: string | null;
  role: RoleKey;
  permissions: string[];
  /** Token id — not currently checked against a revocation list here (access tokens aren't stored), reserved for future use. */
  jti: string;
  /** `User.tokenVersion` at the time this token was signed — compared against the live value by `ActiveAccountGuard`. */
  ver: number;
}

/** Express `Request` augmented with the verified payload, set by this guard. */
export interface AuthenticatedRequest extends Request {
  user?: AccessTokenPayload;
}

/**
 * Verifies the HS512-signed access token's signature and expiry, and
 * attaches its claims to `request.user` for every guard/handler downstream
 * (`ActiveAccountGuard`, `RolesGuard`, `PermissionsGuard`, and eventually
 * the handler itself).
 *
 * Instantiates its own `JwtService` directly (not via `@nestjs/jwt`'s
 * `JwtModule.register()` DI wiring) — per this work unit's design notes,
 * to avoid depending on anything from the not-yet-built `auth` module while
 * still reusing `@nestjs/jwt`'s verification logic rather than hand-rolling
 * it. `JWT_ACCESS_SECRET` comes from `loadEnv()` (`packages/shared/src/
 * env.ts`), already Zod-validated at boot by `main.ts`.
 *
 * Short-circuits (returns `true` with no `request.user` set) for any
 * handler/class marked `@Public()` — WU-04 DoD item 11.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly jwtService: JwtService;

  constructor(private readonly reflector: Reflector) {
    const env = loadEnv();
    this.jwtService = new JwtService({
      secret: env.JWT_ACCESS_SECRET,
      signOptions: { algorithm: 'HS512' },
      verifyOptions: { algorithms: ['HS512'] },
    });
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);

    if (!token) {
      throw new AppError(
        'INVALID_CREDENTIALS',
        'Missing or malformed Authorization header.',
      );
    }

    try {
      request.user = this.jwtService.verify<AccessTokenPayload>(token);
      return true;
    } catch (error) {
      if (this.isTokenExpiredError(error)) {
        throw new AppError('TOKEN_EXPIRED', 'Access token has expired.');
      }
      throw new AppError('INVALID_CREDENTIALS', 'Invalid access token.');
    }
  }

  private extractToken(request: AuthenticatedRequest): string | undefined {
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return undefined;
    }
    return header.slice('Bearer '.length).trim() || undefined;
  }

  /**
   * `jsonwebtoken` (which `@nestjs/jwt` wraps) throws a `TokenExpiredError`
   * with `name === 'TokenExpiredError'` specifically for `exp` expiry, as
   * opposed to `JsonWebTokenError` for a bad signature/malformed token —
   * checked by `name` rather than `instanceof` to avoid importing
   * `jsonwebtoken` as a direct dependency just for its error classes.
   */
  private isTokenExpiredError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      (error as { name?: unknown }).name === 'TokenExpiredError'
    );
  }
}
