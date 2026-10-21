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
  managerVisitsQuerySchema,
  markDeliveredSchema,
  myVisitsQuerySchema,
  nearbyShopsQuerySchema,
  submitVisitSchema,
} from '@field-sales/shared';

import { Audited } from '../../common/decorators/audited.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../../common/guards/jwt-auth.guard';
import { RequireIdempotencyKeyGuard } from '../../common/guards/require-idempotency-key.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ManagerVisitsService } from './manager-visits.service';
import { MyVisitsService } from './my-visits.service';
import { OrderDeliveryService } from './order-delivery.service';
import { NearbyShopsService } from './nearby-shops.service';
import { ShopPinService } from './shop-pin.service';
import { VisitsService } from './visits.service';

class SubmitVisitDto extends createZodDto(submitVisitSchema) {}
class CapturePinDto extends createZodDto(capturePinSchema) {}
class NearbyShopsQueryDto extends createZodDto(nearbyShopsQuerySchema) {}
class MyVisitsQueryDto extends createZodDto(myVisitsQuerySchema) {}
class ManagerVisitsQueryDto extends createZodDto(managerVisitsQuerySchema) {}
class MarkDeliveredDto extends createZodDto(markDeliveredSchema) {}

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
export class VisitsController {
  constructor(
    private readonly visitsService: VisitsService,
    private readonly shopPinService: ShopPinService,
    private readonly nearbyShopsService: NearbyShopsService,
    private readonly myVisitsService: MyVisitsService,
    private readonly managerVisitsService: ManagerVisitsService,
    private readonly orderDeliveryService: OrderDeliveryService,
  ) {}

  /**
   * `GET /visits` — the company-wide list: board 3.3 for a Manager
   * (010-manager-app) and board 4.2 for a Company Admin (011-admin-visits).
   * Path taken verbatim from `03-ARCHITECTURE.md:829`.
   *
   * **One route for two roles, not two routes.** `ManagerVisitsService.list`
   * scopes by `companyId` alone — there has never been a manager-level
   * filter in it — so both roles are asking the identical question of the
   * identical data, and boards 3.3 and 4.2 differ only in their subtitle and
   * their bottom bar. A second route would be the same query twice.
   *
   * **Still a separate route from `GET /visits/mine` by design.** That split
   * is the architecture's own and it is load-bearing: this response carries
   * `distanceMeters` and `isExceedRange`, which the executive's must never.
   * Two routes backed by two services means neither can acquire the other's
   * fields by someone refactoring one. Adding COMPANY_ADMIN here does not
   * weaken that — the executive is the role the rule is about (FR-046/047),
   * and they are not on this list.
   */
  @Roles('MANAGER', 'COMPANY_ADMIN')
  @Get('visits')
  async managerVisits(
    @Req() request: AuthenticatedRequest,
    @Query() query: ManagerVisitsQueryDto,
  ) {
    return this.managerVisitsService.list(
      this.requireCompanyId(request),
      query,
    );
  }

  /**
   * `POST /orders/:id/deliver` — board 3.4's action, and board 4.3's
   * (011-admin-visits): the admin board is titled "Order visit · mark
   * delivered" and its markup is byte-identical to 3.4's, so the admin gets
   * the action, not a read-only copy of the screen.
   *
   * The body is `z.object({}).strict()`: who marked it is the JWT's and when
   * is the server's clock, so a body carrying `deliveredBy` or `deliveredAt`
   * is a `400`. Marking an already-delivered order is a `409`, never a
   * silent overwrite of who marked it first — which is also what stops an
   * admin and a manager racing each other over the same order.
   */
  @Roles('MANAGER', 'COMPANY_ADMIN')
  @Post('orders/:id/deliver')
  @UseGuards(RequireIdempotencyKeyGuard)
  @Audited('order.delivered', 'Order')
  async markDelivered(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    // Declared so nestjs-zod VALIDATES the body: `markDeliveredSchema` is
    // `z.object({}).strict()`, so a client sending `deliveredBy` or
    // `deliveredAt` gets a 400. Nothing in it is read, by design.
    @Body() body: MarkDeliveredDto,
  ) {
    void body;
    return this.orderDeliveryService.markDelivered(
      this.requireCompanyId(request),
      this.requireExecutiveId(request),
      id,
    );
  }

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
  @Roles('MARKETING_EXECUTIVE')
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
  // ──────────────────────────────────────────────────────────────────────
  // ORDER MATTERS BELOW THIS LINE.
  //
  // `@Get('visits/:id')` is a WILDCARD and must stay AFTER every static
  // `visits/...` path, because Nest matches routes in declaration order
  // within a controller. Declared earlier, it swallows `GET /visits/mine`:
  // the executive's own history then resolves to the manager's detail
  // handler, fails its `@Roles('MANAGER', 'COMPANY_ADMIN')` gate, and
  // returns 403 — which is
  // exactly what happened when this was written the other way round, and
  // what quickstart Scenario 10 caught.
  // ──────────────────────────────────────────────────────────────────────
  /**
   * `GET /visits/:id` — boards 3.4, 3.5 AND 3.6 from one route, and their
   * admin twins 4.3, 4.4 and 4.5 (011-admin-visits), whose decoded markup is
   * identical to the manager's bar one name in the sample data.
   *
   * The client picks the screen; the server cannot know which. The same
   * out-of-range order shows the read-only range screen from the
   * Out-of-range tab and the delivery screen from the Order tab (FR-029), so
   * this returns what all three need rather than taking a mode parameter.
   */
  @Roles('MANAGER', 'COMPANY_ADMIN')
  @Get('visits/:id')
  async managerVisitDetail(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.managerVisitsService.detail(this.requireCompanyId(request), id);
  }

  @Roles('MARKETING_EXECUTIVE')
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
  @Roles('MARKETING_EXECUTIVE')
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
  @Roles('MARKETING_EXECUTIVE')
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

  @Roles('MARKETING_EXECUTIVE')
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
