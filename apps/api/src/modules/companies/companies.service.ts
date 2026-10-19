import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  AppError,
  RoleKey,
  type CreateCompanyInput,
  type ListCompaniesQuery,
  type UpdateCompanyInput,
} from '@field-sales/shared';
import { ClsService } from 'nestjs-cls';

import * as password from '../../infra/security/password';
import type { TransactionClsStore } from '../../common/interceptors/transaction.interceptor';

/**
 * Own module-level, unextended Prisma client — same established pattern as
 * `auth.service.ts`/`active-account.guard.ts`/the global interceptors (see
 * those files for why there is no shared `PrismaService` yet). Used only as
 * a defensive fallback if this service is ever invoked with no active
 * transaction on CLS, which should not happen on a real request: every
 * route this service backs is `@SkipTenant()`, so `TransactionInterceptor`
 * always opens one before this service runs.
 */
const prisma = new PrismaClient();

/** The subset of the active transaction client this service needs. */
type CompaniesTx = Pick<
  PrismaClient,
  | 'company'
  | 'companySettings'
  | 'role'
  | 'user'
  // 004-brands-reasons-crud: every company is created with exactly one
  // system "Other" reason (see `create()` below).
  | 'reasonMessage'
  | '$executeRaw'
>;

export interface CreateCompanyResult {
  company: {
    id: string;
    code: string;
    name: string;
    status: 'ACTIVE';
    timezone: string;
  };
  admin: { id: string; username: string; role: 'COMPANY_ADMIN' };
}

export interface CompanyListItem {
  id: string;
  code: string;
  name: string;
  status: string;
  timezone: string;
  createdAt: Date;
}

/**
 * Backs `POST/GET/PATCH /companies` (User Story 1,
 * specs/001-company-user-auth/orchestration-plan.md; shapes per
 * contracts/companies.md). Every route on `CompaniesController` is
 * `@Roles('SYSTEM_ADMIN')` + `@SkipTenant()`, so `TransactionInterceptor`
 * (apps/api/src/common/interceptors/transaction.interceptor.ts) has already
 * opened one transaction for the whole request under
 * `app.is_system_context = 'true'` and attached it to CLS as `tx` by the
 * time any method here runs.
 */
@Injectable()
export class CompaniesService {
  constructor(private readonly cls: ClsService<TransactionClsStore>) {}

  /** The active request transaction, or the unextended fallback client (see class doc comment above for when that fallback would ever be used). */
  private tx(): CompaniesTx {
    const store = this.cls.get();
    return (store?.tx as CompaniesTx | undefined) ?? prisma;
  }

  /**
   * `POST /companies` (DoD item 3 / contracts/companies.md). One
   * transaction creates, in order: `Company` (rejecting a duplicate `code`
   * as `409 COMPANY_CODE_TAKEN` — FR-001/FR-003), its `CompanySettings` row
   * (architecture defaults — every field but `companyId` is `@default(...)`
   * in `schema.prisma`, so a bare `{ companyId }` create picks all of them
   * up automatically), and the first `User` with `role.key = COMPANY_ADMIN`
   * from the request's nested `admin` object (FR-002), password hashed via
   * `password.ts` (WU-05). `Role` is application-wide, not per-company
   * (`roles.seed.ts`) — this only looks the `COMPANY_ADMIN` row up, it
   * never creates one.
   */
  async create(input: CreateCompanyInput): Promise<CreateCompanyResult> {
    const tx = this.tx();

    const existing = await tx.company.findUnique({
      where: { code: input.code },
    });
    if (existing) {
      throw new AppError(
        'COMPANY_CODE_TAKEN',
        `Company code "${input.code}" is already in use.`,
      );
    }

    const company = await tx.company.create({
      data: {
        code: input.code,
        name: input.name,
        place: input.place,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        timezone: input.timezone,
      },
    });

    await tx.companySettings.create({ data: { companyId: company.id } });

    const companyAdminRole = await tx.role.findUnique({
      where: { key: RoleKey.COMPANY_ADMIN },
    });
    if (!companyAdminRole) {
      // Defensive only — prisma/seed.ts's ensureGlobalRoles() runs as part
      // of every deploy and always creates all four ROLE_DEFINITIONS,
      // COMPANY_ADMIN among them; this can only happen if that seed step
      // was never run against this database.
      throw new Error(
        'Global Role rows are missing — run `prisma db seed` against this database first.',
      );
    }

    // From here on, this transaction writes to `User` — a
    // `tenant.extension.ts` `TENANT_MODELS` table — scoped to the
    // brand-new company, not the system-wide context
    // `TransactionInterceptor` opened this transaction under for
    // `@SkipTenant()`. Both isolation layers need to be switched, on this
    // same connection/transaction, before that write:
    //   - Layer 2 (Postgres RLS): `app.company_id` must be set, or the
    //     "users" RLS policy's `WITH CHECK` (neither OR-branch matches a
    //     non-NULL company_id under plain `app.is_system_context`) would
    //     reject the insert outright.
    //   - Layer 1 (Prisma extension): `cls.get('companyId')` must be
    //     truthy, or `tenant.extension.ts` refuses to run the query at all
    //     ("Tenant context missing ... refusing to run an unscoped query").
    // `app.is_system_context` is deliberately left set rather than
    // cleared — harmless (the policy's first OR-branch now matches on
    // `app.company_id` regardless of the second), and nothing later in
    // this same request needs a `companyId IS NULL` row.
    await tx.$executeRaw`SELECT set_config('app.company_id', ${company.id}, true)`;
    this.cls.set('companyId', company.id);

    // 004-brands-reasons-crud (research.md §3, FR-011): every company has
    // exactly one system "Other" no-order reason. Created here, inside the
    // same transaction as the company, its settings and its first admin, so
    // a company can never exist without one. Safe at this point precisely
    // because the pivot above has already switched BOTH isolation layers to
    // this brand-new company — `app.company_id` for the RLS policy's WITH
    // CHECK, and CLS's `companyId` for the Prisma extension — so this needs
    // no RLS escape hatch of its own.
    //
    // Companies that predate this slice were given theirs by the backfill in
    // 20261019093000_masters/migration.sql. A partial unique index in that
    // same migration makes a second system row impossible either way.
    //
    // `displayOrder: 0` is never used for sorting — reason lists order by
    // (isSystem ASC, displayOrder ASC), so this row is last by construction.
    await tx.reasonMessage.create({
      data: {
        companyId: company.id,
        label: 'Other',
        displayOrder: 0,
        isActive: true,
        requiresText: true,
        isSystem: true,
      },
    });

    const passwordHash = await password.hash(input.admin.temporaryPassword);

    const admin = await tx.user.create({
      data: {
        companyId: company.id,
        roleId: companyAdminRole.id,
        name: input.admin.name,
        email: input.admin.email,
        username: input.admin.username,
        passwordHash,
        mobile: input.admin.mobile,
        status: 'ACTIVE',
      },
    });

    return {
      company: {
        id: company.id,
        code: company.code,
        name: company.name,
        status: 'ACTIVE',
        timezone: company.timezone,
      },
      admin: {
        id: admin.id,
        username: admin.username ?? input.admin.username,
        role: 'COMPANY_ADMIN',
      },
    };
  }

  /** `GET /companies` (DoD item 4) — cursor-paginated, newest-created-last so a stable cursor never shifts under a later insert. */
  async list(query: ListCompaniesQuery): Promise<CompanyListItem[]> {
    const tx = this.tx();

    return tx.company.findMany({
      take: query.limit,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        timezone: true,
        createdAt: true,
      },
    });
  }

  /**
   * `PATCH /companies/:id` (DoD item 5). `status: "SUSPENDED"` needs no
   * extra code to take effect at next sign-in — `ActiveAccountGuard`
   * (WU-04) already checks the live `company.status` on every authenticated
   * request.
   */
  async update(
    id: string,
    input: UpdateCompanyInput,
  ): Promise<CompanyListItem> {
    const tx = this.tx();

    const existing = await tx.company.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError('NOT_FOUND', `Company "${id}" was not found.`);
    }

    return tx.company.update({
      where: { id },
      data: {
        name: input.name,
        place: input.place,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        status: input.status,
      },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        timezone: true,
        createdAt: true,
      },
    });
  }
}
