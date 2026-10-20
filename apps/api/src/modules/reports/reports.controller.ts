import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  AppError,
  executiveTotalsQuerySchema,
  previousDayQuerySchema,
} from '@field-sales/shared';

import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ExecutiveTotalsService } from './executive-totals.service';
import { PreviousDayService } from './previous-day.service';

class ExecutiveTotalsQueryDto extends createZodDto(
  executiveTotalsQuerySchema,
) {}
class PreviousDayQueryDto extends createZodDto(previousDayQuerySchema) {}

/**
 * 009-my-totals / contracts/executive-totals.md. Board 1.6.
 *
 * The first controller in the `reports` module. `03-ARCHITECTURE.md:836-839`
 * lists four `/reports/*` routes — `previous-day`, `executive-totals`,
 * `shop-history` and the CSV exports — and slice 014 adds the other three
 * beside this one.
 *
 * **A trap recorded for that slice, because it will look like a one-line
 * addition at the time and it is not.** That table marks
 * `/reports/executive-totals` as "all, scoped" — one route every role may
 * call. This slice implements the executive's half, `MARKETING_EXECUTIVE`
 * only. When Manager and Admin are added, their report carries an
 * **out-of-range count** (`02-PRD.md` FR-MGR-02). Widening THIS response by
 * role would put the product's most load-bearing privacy rule inside an
 * `if` — exactly what slice 008 split `GET /visits/mine` from `GET /visits`
 * to avoid. The fix then is a sibling route or a second projection, never a
 * conditional field.
 */
@ApiTags('reports')
@Controller('reports')
@UseGuards(RolesGuard)
export class ReportsController {
  constructor(
    private readonly executiveTotalsService: ExecutiveTotalsService,
    private readonly previousDayService: PreviousDayService,
  ) {}

  /**
   * `GET /reports/previous-day` — board 3.1 (010-manager-app). Path taken
   * verbatim from `03-ARCHITECTURE.md:836`.
   *
   * **The role is per-method, not on the class**, because this controller
   * now serves two: a class-level `@Roles('MARKETING_EXECUTIVE','MANAGER')`
   * would make an executive's token acceptable on this route and a
   * manager's on `/executive-totals`.
   *
   * `date` IS accepted here, unlike the totals route — see
   * `reports.schema.ts` for why a single calendar date is not the period
   * calculation rule 8 keeps in one place.
   */
  @Roles('MANAGER')
  @Get('previous-day')
  async previousDay(
    @Req() request: AuthenticatedRequest,
    @Query() query: PreviousDayQueryDto,
  ) {
    return this.previousDayService.get(this.requireCompanyId(request), query);
  }

  /**
   * A read: no `Idempotency-Key` and no `@Audited`. The CSV export route in
   * that table is the audited one; this is not an export.
   *
   * The query carries a period NAME and nothing else — no `executiveId` and
   * no `from`/`to`. See `reports.schema.ts` for why both absences matter.
   */
  @Roles('MARKETING_EXECUTIVE')
  @Get('executive-totals')
  async executiveTotals(
    @Req() request: AuthenticatedRequest,
    @Query() query: ExecutiveTotalsQueryDto,
  ) {
    return this.executiveTotalsService.get(
      this.requireCompanyId(request),
      this.requireExecutiveId(request),
      query,
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
