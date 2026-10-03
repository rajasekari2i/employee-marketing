import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import {
  createCompanySchema,
  listCompaniesQuerySchema,
  updateCompanySchema,
} from '@field-sales/shared';

import { Audited } from '../../common/decorators/audited.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SkipTenant } from '../../common/decorators/skip-tenant.decorator';
import { RequireIdempotencyKeyGuard } from '../../common/guards/require-idempotency-key.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CompaniesService } from './companies.service';

/**
 * `createZodDto()` wrapping, same reasoning as `auth.controller.ts`: keeps
 * `nestjs-zod` out of `packages/shared` while the mobile app (and any future
 * System-Admin console) can still import the bare schemas directly.
 */
class CreateCompanyDto extends createZodDto(createCompanySchema) {}
class ListCompaniesQueryDto extends createZodDto(listCompaniesQuerySchema) {}
class UpdateCompanyDto extends createZodDto(updateCompanySchema) {}

/**
 * User Story 1 (specs/001-company-user-auth/orchestration-plan.md) /
 * contracts/companies.md. Every route here is System-Admin-only and
 * `@SkipTenant()` — see that decorator and `transaction.interceptor.ts` for
 * why: these routes are authenticated but have no tenant to scope a
 * transaction to (only `SYSTEM_ADMIN`, `companyId: null`, can ever reach
 * them — enforced by `RolesGuard` reading `@Roles('SYSTEM_ADMIN')` below,
 * not by `@SkipTenant()` itself).
 *
 * `RolesGuard` is not a global `APP_GUARD` (apps/api/src/common/guards/
 * roles.guard.ts's own doc comment) — applied here via `@UseGuards()`,
 * the first controller in this codebase to need it.
 */
@Controller('companies')
@UseGuards(RolesGuard)
@Roles('SYSTEM_ADMIN')
@SkipTenant()
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  /**
   * Requires `Idempotency-Key` (contracts/companies.md). The global
   * `IdempotencyInterceptor` (WU-04) replays/conflicts correctly whenever
   * the header IS present, but treats it as optional when absent — by
   * design, left to each route to enforce (see that interceptor's class
   * doc). `RequireIdempotencyKeyGuard` is this route's own enforcement,
   * added after adversarial review live-verified a request with no header
   * at all otherwise succeeded with zero duplicate-submission protection.
   * `@Audited()` writes one `AuditEvent` row inside this same request's
   * transaction (DoD item 3) — `entityType` passed explicitly as
   * `'Company'` rather than relying on `AuditInterceptor`'s
   * class-name-stripping default (`'Companies'`, plural, from
   * `CompaniesController`).
   */
  @Post()
  @UseGuards(RequireIdempotencyKeyGuard)
  @Audited('company.create', 'Company')
  create(@Body() body: CreateCompanyDto) {
    return this.companiesService.create(body);
  }

  @Get()
  list(@Query() query: ListCompaniesQueryDto) {
    return this.companiesService.list(query);
  }

  @Patch(':id')
  @Audited('company.update', 'Company')
  update(@Param('id') id: string, @Body() body: UpdateCompanyDto) {
    return this.companiesService.update(id, body);
  }
}
