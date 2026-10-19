import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  AppError,
  createBrandSchema,
  reorderSchema,
  updateBrandSchema,
} from '@field-sales/shared';

import { Audited } from '../../common/decorators/audited.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../../common/guards/jwt-auth.guard';
import { RequireIdempotencyKeyGuard } from '../../common/guards/require-idempotency-key.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BrandsService } from './brands.service';

class CreateBrandDto extends createZodDto(createBrandSchema) {}
class UpdateBrandDto extends createZodDto(updateBrandSchema) {}
class ReorderBrandsDto extends createZodDto(reorderSchema) {}

/**
 * 004-brands-reasons-crud / contracts/masters.md. Every route here is
 * Company-Admin-only and an ORDINARY authenticated route (not `@Public()`,
 * not `@SkipTenant()`) — see `brands.service.ts`'s class doc for how it
 * re-scopes the request's own transaction to the caller's company before
 * touching `Brand`, the same pattern `beat-plans.service.ts` established.
 *
 * There is deliberately NO `DELETE` route at any path: retirement is
 * `PATCH /brands/:id { isActive: false }` and nothing else (FR-015, PRD
 * FR-ADM-09), matching `/shops`, `/users` and `/beat-plans`.
 */
@ApiTags('brands')
@Controller('brands')
@UseGuards(RolesGuard)
@Roles('COMPANY_ADMIN', 'MARKETING_EXECUTIVE')
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  /**
   * 006-visit-outcomes widened this to the Marketing Executive, who needs it
   * to populate the outcome screens. The executive receives ACTIVE entries
   * only; the Company Admin's response is unchanged.
   *
   * Only this GET is shared — every mutating route below re-asserts
   * `@Roles('COMPANY_ADMIN')`, so widening the class-level role cannot
   * accidentally let an executive create, reorder or deactivate a master.
   */
  @Get()
  list(@Req() request: AuthenticatedRequest) {
    const isExecutive = request.user?.role === 'MARKETING_EXECUTIVE';
    return this.brandsService.list(this.requireCompanyId(request), isExecutive);
  }

  @Post()
  @Roles('COMPANY_ADMIN')
  @UseGuards(RequireIdempotencyKeyGuard)
  @Audited('brand.create', 'Brand')
  create(@Req() request: AuthenticatedRequest, @Body() body: CreateBrandDto) {
    return this.brandsService.create(this.requireCompanyId(request), body);
  }

  /**
   * MUST stay declared ABOVE `PATCH :id`. NestJS matches routes in
   * declaration order, so a `:id` route declared first would swallow
   * `/order` and treat the literal string "order" as a brand id
   * (contracts/masters.md implementation note).
   */
  @Patch('order')
  @Roles('COMPANY_ADMIN')
  @UseGuards(RequireIdempotencyKeyGuard)
  @Audited('brand.reorder', 'Brand')
  reorder(
    @Req() request: AuthenticatedRequest,
    @Body() body: ReorderBrandsDto,
  ) {
    return this.brandsService.reorder(this.requireCompanyId(request), body);
  }

  @Patch(':id')
  @Roles('COMPANY_ADMIN')
  @UseGuards(RequireIdempotencyKeyGuard)
  @Audited('brand.update', 'Brand')
  update(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: UpdateBrandDto,
  ) {
    return this.brandsService.update(this.requireCompanyId(request), id, body);
  }

  /** `@Roles('COMPANY_ADMIN')` on the class already guarantees a tenant companyId exists — defensive, same posture as `beat-plans.controller.ts`. */
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
}
