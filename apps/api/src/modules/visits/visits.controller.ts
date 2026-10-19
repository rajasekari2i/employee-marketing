import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  AppError,
  capturePinSchema,
  myVisitsQuerySchema,
  nearbyShopsQuerySchema,
  submitVisitSchema,
} from '@field-sales/shared';

import { Audited } from '../../common/decorators/audited.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../../common/guards/jwt-auth.guard';
import { RequireIdempotencyKeyGuard } from '../../common/guards/require-idempotency-key.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { MyVisitsService } from './my-visits.service';
import { NearbyShopsService } from './nearby-shops.service';
import { ShopPinService } from './shop-pin.service';
import { VisitsService } from './visits.service';

class SubmitVisitDto extends createZodDto(submitVisitSchema) {}
class CapturePinDto extends createZodDto(capturePinSchema) {}
class NearbyShopsQueryDto extends createZodDto(nearbyShopsQuerySchema) {}
class MyVisitsQueryDto extends createZodDto(myVisitsQuerySchema) {}

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
    private readonly nearbyShopsService: NearbyShopsService,
    private readonly myVisitsService: MyVisitsService,
  ) {}

  /**
   * `GET /visits/mine` — the executive's own history, board 1.5
   * (008-my-visits). Path taken verbatim from `03-ARCHITECTURE.md:830`.
   *
   * The manager's `GET /visits` on the line ABOVE it in that table is a
   * **separate route by design**, not a role-filtered variant of this one.
   * That split is what keeps the measurement, the flags and the review
   * status out of an executive response structurally rather than by a
   * conditional — the manager's list carries all of them deliberately.
   *
   * A read, so no `Idempotency-Key` and no audit. The caller's own executive
   * id comes from the verified JWT; there is no parameter for it.
   */
  @Get('visits/mine')
  async myVisits(
    @Req() request: AuthenticatedRequest,
    @Query() query: MyVisitsQueryDto,
  ) {
    return this.myVisitsService.list(
      this.requireCompanyId(request),
      this.requireExecutiveId(request),
      query,
    );
  }

  /**
   * `GET /shops/nearby` — board 1.4's picker (007-extra-shops). Path taken
   * verbatim from `03-ARCHITECTURE.md:826`.
   *
   * Here, not in the admin-only shops module, for the reason recorded above
   * for `POST /shops/:id/pin`: it is the executive's field flow.
   *
   * A read, so no `Idempotency-Key`. The response is a purpose-built
   * projection that never carries a shop coordinate or a radius — see
   * `nearby-shops.service.ts`.
   */
  @Get('shops/nearby')
  async nearbyShops(
    @Req() request: AuthenticatedRequest,
    @Query() query: NearbyShopsQueryDto,
  ) {
    return this.nearbyShopsService.list(
      this.requireCompanyId(request),
      this.requireExecutiveId(request),
      query,
    );
  }

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
