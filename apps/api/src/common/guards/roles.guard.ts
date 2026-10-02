import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError, type RoleKey } from '@field-sales/shared';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedRequest } from './jwt-auth.guard';

/**
 * Enforces `@Roles(...)` (apps/api/src/common/decorators/roles.decorator
 * .ts): the authenticated user's JWT `role` claim must be one of the listed
 * `RoleKey`s. A handler/class with no `@Roles()` metadata is allowed
 * through unrestricted — this guard only *narrows*, it never widens access
 * on its own.
 *
 * Not a global `APP_GUARD` in this work unit (WU-04 DoD item 10 lists
 * exactly five global providers and this isn't one of them) — applied
 * per-route with `@UseGuards(RolesGuard)` by whichever module owns the
 * route, starting with WU-05.
 *
 * Runs after `JwtAuthGuard`/`ActiveAccountGuard` in the pipeline (Architecture
 * §4), so `request.user` is expected to already be populated by the time
 * this guard's own `@UseGuards()` stack reaches it; still short-circuits on
 * `@Public()` for the (unlikely but not impossible) case a route is marked
 * both `@Public()` and `@Roles()`.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<
      RoleKey[] | undefined
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const role = request.user?.role;

    if (!role || !requiredRoles.includes(role)) {
      throw new AppError(
        'FORBIDDEN_ROLE',
        `This action requires one of the following roles: ${requiredRoles.join(', ')}.`,
      );
    }

    return true;
  }
}
