import { SetMetadata } from '@nestjs/common';
import type { RoleKey } from '@field-sales/shared';

/**
 * `@Roles(...)` restricts a handler to the listed `RoleKey`s. Read by
 * `RolesGuard` (apps/api/src/common/guards/roles.guard.ts) via `Reflector`.
 *
 * Not registered as a global `APP_GUARD` by this work unit (WU-04's DoD
 * item 10 lists exactly five global providers and this isn't one of them) —
 * `RolesGuard` is applied per-route with `@UseGuards(RolesGuard)` alongside
 * this decorator, by the module that owns the route (starting with WU-05's
 * `AuthModule` and onward).
 */
export const ROLES_KEY = 'roles';

export const Roles = (...roles: RoleKey[]) => SetMetadata(ROLES_KEY, roles);
