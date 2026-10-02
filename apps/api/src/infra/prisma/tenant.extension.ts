import { InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ClsService, ClsStore } from 'nestjs-cls';

/**
 * Shape of the CLS store this tenant-isolation layer depends on.
 *
 * `companyId` is populated upstream — by the request pipeline's tenant
 * context stage (Architecture §4's `TenantContextInterceptor`, built in a
 * later work unit) from the authenticated user's verified JWT claims —
 * never from client-supplied input (Constitution rule 1 / Architecture §5).
 */
export interface TenantClsStore extends ClsStore {
  companyId?: string;
}

/**
 * Prisma model names (NOT the mapped DB table names — e.g. `User`, not
 * `users`) that carry a `companyId` column and must therefore be scoped to
 * the current request's tenant on every single operation.
 *
 * Architecture §5 (Layer 1) / CLAUDE.md Constitution rule 2: this is the
 * one list a new tenant-scoped model must be added to, or it slips through
 * unscoped. The DMMF-driven "every tenant model is registered" automated
 * test described in Architecture §5 is deferred per CLAUDE.md's no-tests
 * policy (WU-03 scope note) — this set is the only guard for now.
 */
export const TENANT_MODELS = new Set<string>(['User', 'FileObject']);

/** Operations whose `where` clause must be narrowed to the tenant. */
const READ_OPS = new Set<string>([
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

/** Write operations that take a `where` and must also be narrowed. */
const WRITE_SCOPED_OPS = new Set<string>([
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

type ScopedArgs = {
  where?: Record<string, unknown>;
  data?: Record<string, unknown> | Record<string, unknown>[];
};

function toArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

/**
 * Layer 1 of the two-layer tenant isolation (Architecture §5; CLAUDE.md
 * Constitution rule 2). For every operation against a model in
 * `TENANT_MODELS`:
 *   - `create` / `createMany` have `companyId` injected into `data` from CLS
 *   - every other read or write-scoped operation has its `where` narrowed
 *     to `{ AND: [originalWhere, { companyId }] }`
 *   - if CLS has no `companyId` for the current async context, the query is
 *     refused outright (never silently run unscoped, never silently
 *     no-op'd) — this is deliberate: a bug upstream that forgets to
 *     populate CLS must be loud, not a silent cross-tenant leak risk.
 *
 * Models NOT in `TENANT_MODELS` (e.g. `Company`, `Role`, `AuditEvent`,
 * `IdempotencyKey`) pass through untouched — they are guarded in
 * application code instead (Architecture §5's documented exemption list).
 *
 * Postgres row-level security (Layer 2, see the RLS migration alongside
 * this file) is the defence-in-depth backstop for the case this layer is
 * ever bypassed — e.g. a raw query, or code that grabs a non-extended
 * Prisma client.
 */
export const tenantExtension = (cls: ClsService<TenantClsStore>) =>
  Prisma.defineExtension((base) =>
    base.$extends({
      name: 'tenant-isolation',
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            if (!model || !TENANT_MODELS.has(model)) {
              return query(args);
            }

            const companyId = cls.get('companyId');
            if (!companyId) {
              throw new InternalServerErrorException(
                `Tenant context missing for ${model}.${operation} — refusing to run an unscoped query against a tenant-isolated model.`,
              );
            }

            const scopedArgs = args as ScopedArgs;

            if (READ_OPS.has(operation) || WRITE_SCOPED_OPS.has(operation)) {
              scopedArgs.where = {
                AND: [scopedArgs.where ?? {}, { companyId }],
              };
            }

            if (operation === 'create') {
              scopedArgs.data = {
                ...(scopedArgs.data as Record<string, unknown> | undefined),
                companyId,
              };
            }

            if (operation === 'createMany') {
              scopedArgs.data = toArray(
                scopedArgs.data as
                  Record<string, unknown> | Record<string, unknown>[],
              ).map((row) => ({ ...row, companyId }));
            }

            return query(args);
          },
        },
      },
    }),
  );
