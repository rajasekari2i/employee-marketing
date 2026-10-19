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
  createReasonSchema,
  reorderSchema,
  updateReasonSchema,
} from '@field-sales/shared';

import { Audited } from '../../common/decorators/audited.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../../common/guards/jwt-auth.guard';
import { RequireIdempotencyKeyGuard } from '../../common/guards/require-idempotency-key.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ReasonsService } from './reasons.service';

class CreateReasonDto extends createZodDto(createReasonSchema) {}
class UpdateReasonDto extends createZodDto(updateReasonSchema) {}
class ReorderReasonsDto extends createZodDto(reorderSchema) {}

/**
 * 004-brands-reasons-crud / contracts/masters.md. The mirror of
 * `BrandsController`; see that file's class doc. The system "Other" row's
 * guards live in `reasons.service.ts`, not here, so they apply no matter
 * which route reaches them.
 *
 * As with brands, there is deliberately NO `DELETE` route at any path.
 */
@ApiTags('reasons')
@Controller('reasons')
@UseGuards(RolesGuard)
@Roles('COMPANY_ADMIN')
export class ReasonsController {
  constructor(private readonly reasonsService: ReasonsService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.reasonsService.list(this.requireCompanyId(request));
  }

  @Post()
  @UseGuards(RequireIdempotencyKeyGuard)
  @Audited('reason.create', 'ReasonMessage')
  create(@Req() request: AuthenticatedRequest, @Body() body: CreateReasonDto) {
    return this.reasonsService.create(this.requireCompanyId(request), body);
  }

  /** MUST stay declared ABOVE `PATCH :id` — see `brands.controller.ts`. */
  @Patch('order')
  @UseGuards(RequireIdempotencyKeyGuard)
  @Audited('reason.reorder', 'ReasonMessage')
  reorder(
    @Req() request: AuthenticatedRequest,
    @Body() body: ReorderReasonsDto,
  ) {
    return this.reasonsService.reorder(this.requireCompanyId(request), body);
  }

  @Patch(':id')
  @UseGuards(RequireIdempotencyKeyGuard)
  @Audited('reason.update', 'ReasonMessage')
  update(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: UpdateReasonDto,
  ) {
    return this.reasonsService.update(this.requireCompanyId(request), id, body);
  }

  /** See `brands.controller.ts` — defensive, same posture. */
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
