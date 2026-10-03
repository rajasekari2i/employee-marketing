import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '@field-sales/shared';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import {
  PERMISSIONS_KEY,
  type Permission,
} from '../decorators/permissions.decorator';
import type { AuthenticatedRequest } from './jwt-auth.guard';

/**
 * Enforces `@Permissions(...)` (apps/api/src/common/decorators/
 * permissions.decorator.ts): the authenticated user's JWT `permissions`
 * claim must include *every* listed `resource:action:scope` string (AND
 * semantics, not "any one of"). A handler/class with no `@Permissions()`
 * metadata is allowed through unrestricted.
 *
 * Not a global `APP_GUARD` in this work unit, same reasoning as
 * `RolesGuard` — applied per-route via `@UseGuards(PermissionsGuard)`.
 *
 * Uses the same `FORBIDDEN_ROLE` error code as `RolesGuard` — this slice's
 * error vocabulary (`packages/shared/src/errors.ts`) has no separate
 * "permission denied" code distinct from "role forbidden"; both represent
 * the same caller-facing outcome ("you are authenticated but not allowed
 * to do this").
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const requiredPermissions = this.reflector.getAllAndOverride<
      Permission[] | undefined
    >(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const granted = new Set(request.user?.permissions ?? []);

    const missing = requiredPermissions.filter((perm) => !granted.has(perm));

    if (missing.length > 0) {
      throw new AppError(
        'FORBIDDEN_ROLE',
        `This action requires the following permission(s): ${missing.join(', ')}.`,
      );
    }

    return true;
  }
}
