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
  addExtraStopSchema,
  endBeatSchema,
  managerAddStopSchema,
  managerAssignmentsQuerySchema,
  startBeatSchema,
} from '@field-sales/shared';

import { Audited } from '../../common/decorators/audited.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../../common/guards/jwt-auth.guard';
import { RequireIdempotencyKeyGuard } from '../../common/guards/require-idempotency-key.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AssignmentsService } from './assignments.service';
import { ExtraStopService } from './extra-stop.service';

class StartBeatDto extends createZodDto(startBeatSchema) {}
class EndBeatDto extends createZodDto(endBeatSchema) {}
class AddExtraStopDto extends createZodDto(addExtraStopSchema) {}
class ManagerAddStopDto extends createZodDto(managerAddStopSchema) {}
class ManagerAssignmentsQueryDto extends createZodDto(
  managerAssignmentsQuerySchema,
) {}

/**
 * 005-executive-dashboard / contracts/assignments.md. Marketing Executive
 * only, and every route is additionally scoped to the caller's **own**
 * executive id taken from the verified JWT — never from a path or query
 * parameter — so company-level tenant isolation is never what keeps one
 * executive out of another's day.
 *
 * The manager/admin variant (`GET /assignments?date=&executiveId=`) is
 * deliberately not here; it belongs to the manager review feature.
 */
@ApiTags('assignments')
@Controller('assignments')
@UseGuards(RolesGuard)
export class AssignmentsController {
  constructor(
    private readonly assignmentsService: AssignmentsService,
    private readonly extraStopService: ExtraStopService,
  ) {}

  /**
   * **This read may write.** When no route exists for the caller's
   * company-local business date and their beat plan covers today, the service
   * creates it and returns it (research.md §1 — the chosen alternative to an
   * overnight job).
   *
   * It deliberately takes **no** `Idempotency-Key`: the write is idempotent by
   * construction via the unique index on
   * `(companyId, businessDate, executiveId)`, so a race loses the insert and
   * re-reads the winner. This is the only read in this codebase permitted to
   * write.
   *
   * It also takes no date parameter — accepting one from the client is exactly
   * the bug FR-005 exists to prevent.
   */
  @Roles('MARKETING_EXECUTIVE')
  @Get('today')
  today(@Req() request: AuthenticatedRequest) {
    return this.assignmentsService.getToday(
      this.requireCompanyId(request),
      this.requireExecutiveId(request),
    );
  }

  /** Returns `200`, not `201` — a repeated start is an expected outcome, not a creation. */
  @Roles('MARKETING_EXECUTIVE')
  @Post(':id/start')
  @UseGuards(RequireIdempotencyKeyGuard)
  @Audited('beat-day.start', 'DailyAssignment')
  start(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: StartBeatDto,
  ) {
    return this.assignmentsService.start(
      this.requireCompanyId(request),
      this.requireExecutiveId(request),
      id,
      body,
    );
  }

  @Roles('MARKETING_EXECUTIVE')
  @Post(':id/end')
  @UseGuards(RequireIdempotencyKeyGuard)
  @Audited('beat-day.end', 'DailyAssignment')
  end(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: EndBeatDto,
  ) {
    return this.assignmentsService.end(
      this.requireCompanyId(request),
      this.requireExecutiveId(request),
      id,
      body,
    );
  }

  /**
   * `POST /assignments/:id/stops` — one extra shop onto the caller's own
   * running day (007-extra-shops, board 1.4).
   *
   * The path is taken verbatim from `03-ARCHITECTURE.md:824`. The manager's
   * sibling on the next line of that table —
   * `POST /assignments/:id/stops/manager`, with its required `reason` — is a
   * later slice; building the executive's one here leaves it a sibling
   * rather than a refactor.
   *
   * `201`, unlike `start`/`end`: this genuinely creates a row. A repeat with
   * the same key replays the stored response; a *different* request naming a
   * shop that is already on the day gets `409 SHOP_ALREADY_IN_BEAT`. Two
   * mechanisms, one situation each.
   */
  @Roles('MARKETING_EXECUTIVE')
  @Post(':id/stops')
  @UseGuards(RequireIdempotencyKeyGuard)
  @Audited('extra-shop.create', 'AssignmentStop')
  addExtraStop(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: AddExtraStopDto,
  ) {
    return this.extraStopService.addExtraStop(
      this.requireCompanyId(request),
      this.requireExecutiveId(request),
      id,
      body,
    );
  }

  /**
   * `POST /assignments/:id/stops/manager` — board 3.2 (010-manager-app).
   * Path taken verbatim from `03-ARCHITECTURE.md:825`, which sits one line
   * BELOW the executive's route above, exactly as slice 007 anticipated.
   *
   * **The role is per-method, not on the class**: this controller now holds
   * four executive routes and one manager route, and a class-level
   * `@Roles('MARKETING_EXECUTIVE','MANAGER')` would let a manager start an
   * executive's beat and an executive add a stop to anyone's day.
   */
  /**
   * `GET /assignments` — the manager's view of a day, for board 3.2. Path
   * from `03-ARCHITECTURE.md:821`. Declared BEFORE `:id/...` routes so it
   * cannot be shadowed.
   */
  @Roles('MANAGER')
  @Get()
  managerAssignments(
    @Req() request: AuthenticatedRequest,
    @Query() query: ManagerAssignmentsQueryDto,
  ) {
    return this.assignmentsService.listForManager(
      this.requireCompanyId(request),
      query,
    );
  }

  @Roles('MANAGER')
  @Post(':id/stops/manager')
  @UseGuards(RequireIdempotencyKeyGuard)
  @Audited('extra-shop.manager-create', 'AssignmentStop')
  addManagerExtraStop(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: ManagerAddStopDto,
  ) {
    return this.extraStopService.addManagerExtraStop(
      this.requireCompanyId(request),
      this.requireExecutiveId(request),
      id,
      body,
    );
  }

  /** The class no longer carries a role — each method declares its own. Defensive, same posture as the other controllers. */
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

  /** The caller's own user id (`sub`). The second scope, enforced on every route. */
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
