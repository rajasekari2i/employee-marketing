import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  AppError,
  capturePinSchema,
  submitVisitSchema,
} from '@field-sales/shared';

import { Audited } from '../../common/decorators/audited.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../../common/guards/jwt-auth.guard';
import { RequireIdempotencyKeyGuard } from '../../common/guards/require-idempotency-key.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ShopPinService } from './shop-pin.service';
import { VisitsService } from './visits.service';

class SubmitVisitDto extends createZodDto(submitVisitSchema) {}
class CapturePinDto extends createZodDto(capturePinSchema) {}

/**
 * 006-visit-outcomes / contracts/visits.md. Marketing Executive only, and
 * every route is additionally scoped to the caller's **own** executive id
 * taken from the verified JWT — never from a path or query parameter.
 *
 * `POST /shops/:id/pin` lives here rather than in the shops module because
 * it is the executive's field flow and writes the stop coordinate snapshot
 * the visit measurement depends on.
 */
@ApiTags('visits')
@Controller()
@UseGuards(RolesGuard)
@Roles('MARKETING_EXECUTIVE')
export class VisitsController {
  constructor(
    private readonly visitsService: VisitsService,
    private readonly shopPinService: ShopPinService,
  ) {}

  /** Wrapped in `{ stop }` to match contracts/visits.md. */
  @Get('stops/:id')
  async stopDetail(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const stop = await this.visitsService.getStopDetail(
      this.requireCompanyId(request),
      this.requireExecutiveId(request),
      id,
    );
    return { stop };
  }

  /**
   * The critical path. The response is deliberately three fields — **no
   * distance, no range verdict, no flags** (PRD FR-VISIT-12). The executive
   * is never told what was measured, and this is the first place that
   * guarantee has to hold.
   */
  @Post('visits')
  @UseGuards(RequireIdempotencyKeyGuard)
  @Audited('visit.create', 'Visit')
  submitVisit(
    @Req() request: AuthenticatedRequest,
    @Body() body: SubmitVisitDto,
  ) {
    return this.visitsService.submitVisit(
      this.requireCompanyId(request),
      this.requireExecutiveId(request),
      body,
    );
  }

  @Post('shops/:id/pin')
  @UseGuards(RequireIdempotencyKeyGuard)
  @Audited('shop-pin.capture', 'Shop')
  capturePin(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: CapturePinDto,
  ) {
    return this.shopPinService.capturePin(
      this.requireCompanyId(request),
      this.requireExecutiveId(request),
      id,
      body,
    );
  }

  /** Defensive — the class-level role already guarantees a tenant companyId. */
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

  /** The caller's own user id. The third scope, enforced on every route. */
  private requireExecutiveId(request: AuthenticatedRequest): string {
    const executiveId = request.user?.sub;
    if (!executiveId) {
      throw new AppError(
        'FORBIDDEN_ROLE',
        'This action requires a signed-in user.',
      );
    }
    return executiveId;
  }
}
