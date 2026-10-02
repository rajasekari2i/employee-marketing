import { SetMetadata } from '@nestjs/common';

/**
 * Permission strings follow `resource:action:scope`, e.g.
 * `users:write:company`, `visits:read:own` (Architecture §7's permission
 * vocabulary). This is a documentation-only template-literal type — it
 * catches an obviously wrong literal (missing colon) at the call site but,
 * being a template type, cannot enforce that `resource`/`action`/`scope`
 * are themselves from a closed vocabulary; that enforcement lives in
 * `Role.permissions` seed data + review, not the type system.
 */
export type Permission = `${string}:${string}:${string}`;

/**
 * `@Permissions(...)` restricts a handler to callers whose JWT `permissions`
 * claim includes every listed permission. Read by `PermissionsGuard`
 * (apps/api/src/common/guards/permissions.guard.ts) via `Reflector`.
 *
 * Like `@Roles()`, not registered as a global `APP_GUARD` by this work unit
 * — applied per-route via `@UseGuards(PermissionsGuard)` by the module that
 * owns the route.
 */
export const PERMISSIONS_KEY = 'permissions';

export const Permissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
