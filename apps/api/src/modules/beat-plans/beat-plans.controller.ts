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
  createBeatPlanSchema,
  listBeatPlansQuerySchema,
  updateBeatPlanSchema,
} from '@field-sales/shared';

import { Audited } from '../../common/decorators/audited.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../../common/guards/jwt-auth.guard';
import { RequireIdempotencyKeyGuard } from '../../common/guards/require-idempotency-key.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BeatPlansService } from './beat-plans.service';

class ListBeatPlansQueryDto extends createZodDto(listBeatPlansQuerySchema) {}
class CreateBeatPlanDto extends createZodDto(createBeatPlanSchema) {}
class UpdateBeatPlanDto extends createZodDto(updateBeatPlanSchema) {}

/**
 * 003-beat-plans-crud / contracts/beat-plans.md. Every route on this
 * controller is Company-Admin-only and an ORDINARY authenticated route (not
 * `@Public()`, not `@SkipTenant()`) — see `beat-plans.service.ts`'s class
 * doc for how it re-scopes the request's own transaction to the caller's
 * company before touching `BeatPlan`/`BeatPlanShop`, same pattern
 * `shops.service.ts` established.
 */
@ApiTags('beat-plans')
@Controller('beat-plans')
@UseGuards(RolesGuard)
@Roles('COMPANY_ADMIN')
export class BeatPlansController {
  constructor(private readonly beatPlansService: BeatPlansService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: ListBeatPlansQueryDto,
  ) {
    return this.beatPlansService.list(this.requireCompanyId(request), query);
  }

  @Post()
  @UseGuards(RequireIdempotencyKeyGuard)
  @Audited('beat-plan.create', 'BeatPlan')
  create(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateBeatPlanDto,
  ) {
    return this.beatPlansService.create(this.requireCompanyId(request), body);
  }

  @Patch(':id')
  @UseGuards(RequireIdempotencyKeyGuard)
  @Audited('beat-plan.update', 'BeatPlan')
  update(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: UpdateBeatPlanDto,
  ) {
    return this.beatPlansService.update(
      this.requireCompanyId(request),
      id,
      body,
    );
  }

  /** `@Roles('COMPANY_ADMIN')` on the class already guarantees a tenant companyId exists — defensive, same posture as `shops.controller.ts`. */
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
