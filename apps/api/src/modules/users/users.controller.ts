import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  AppError,
  createUserSchema,
  listUsersQuerySchema,
  salaryRateSchema,
  updateUserSchema,
} from '@field-sales/shared';

import { Audited } from '../../common/decorators/audited.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../../common/guards/jwt-auth.guard';
import { RequireIdempotencyKeyGuard } from '../../common/guards/require-idempotency-key.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UsersService } from './users.service';

/**
 * `createZodDto()` wrapping, same reasoning as `companies.controller.ts`:
 * keeps `nestjs-zod` out of `packages/shared` while the mobile app can still
 * import the bare schemas directly.
 */
class CreateUserDto extends createZodDto(createUserSchema) {}
class ListUsersQueryDto extends createZodDto(listUsersQuerySchema) {}
class UpdateUserDto extends createZodDto(updateUserSchema) {}
class SalaryRateDto extends createZodDto(salaryRateSchema) {}

/**
 * User Story 3 (specs/001-company-user-auth/orchestration-plan.md) /
 * contracts/users.md. Every route here is Company-Admin-only and an
 * ORDINARY authenticated route (not `@Public()`, not `@SkipTenant()`) — see
 * `users.service.ts`'s class doc for how it re-scopes the request's own
 * transaction to the caller's company before touching any tenant-isolated
 * table.
 */
@ApiTags('users')
@Controller('users')
@UseGuards(RolesGuard)
@Roles('COMPANY_ADMIN')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: ListUsersQueryDto,
  ) {
    return this.usersService.list(
      this.requireCompanyId(request),
      this.requireCallerId(request),
      query,
    );
  }

  /**
   * Requires `Idempotency-Key` (`RequireIdempotencyKeyGuard`, reused as-is
   * from User Story 1's `POST /companies`). `@Audited()` writes one
   * `AuditEvent` row inside this same request's transaction — `entityType`
   * passed explicitly as `'User'` rather than relying on
   * `AuditInterceptor`'s class-name-stripping default (`'Users'`, plural).
   */
  @Post()
  @UseGuards(RequireIdempotencyKeyGuard)
  @Audited('user.create', 'User')
  create(@Req() request: AuthenticatedRequest, @Body() body: CreateUserDto) {
    return this.usersService.create(
      this.requireCompanyId(request),
      this.requireCallerId(request),
      body,
    );
  }

  /** Requires `Idempotency-Key` (gap #6 — `contracts/auth.md`'s blanket rule covers every mutating endpoint under Users, not just `POST /users`). */
  @Patch(':id')
  @UseGuards(RequireIdempotencyKeyGuard)
  @Audited('user.update', 'User')
  update(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: UpdateUserDto,
  ) {
    return this.usersService.update(
      this.requireCompanyId(request),
      this.requireCallerId(request),
      id,
      body,
    );
  }

  /** Requires `Idempotency-Key` (gap #6, same reasoning as `PATCH /users/:id`). */
  @Post(':id/salary-rates')
  @UseGuards(RequireIdempotencyKeyGuard)
  @Audited('user.salary-rate.create', 'User')
  createSalaryRate(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: SalaryRateDto,
  ) {
    return this.usersService.changeSalaryRate(
      this.requireCompanyId(request),
      this.requireCallerId(request),
      id,
      body,
    );
  }

  /** `@Roles('COMPANY_ADMIN')` above already guarantees a tenant companyId exists (data-model.md: `companyId` is null only for `SYSTEM_ADMIN`) — this is defensive, same posture as `me.controller.ts`'s own `request.user` check. */
  private requireCompanyId(request: AuthenticatedRequest): string {
    const companyId = request.user?.companyId;
    if (!companyId) {
      throw new AppError(
        'FORBIDDEN_ROLE',
        'This action requires a company-scoped account.',
      );
    }
    return companyId;
  }

  private requireCallerId(request: AuthenticatedRequest): string {
    const sub = request.user?.sub;
    if (!sub) {
      throw new AppError(
        'INVALID_CREDENTIALS',
        'Missing authenticated user context.',
      );
    }
    return sub;
  }
}
