import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  AppError,
  finaliseSalaryRunSchema,
  generateSalaryRunSchema,
  salaryRunQuerySchema,
} from '@field-sales/shared';

import { Audited } from '../../common/decorators/audited.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../../common/guards/jwt-auth.guard';
import { RequireIdempotencyKeyGuard } from '../../common/guards/require-idempotency-key.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PayslipService } from './payslip.service';
import { SalaryRunService } from './salary-run.service';

class SalaryRunQueryDto extends createZodDto(salaryRunQuerySchema) {}
class GenerateSalaryRunDto extends createZodDto(generateSalaryRunSchema) {}
class FinaliseSalaryRunDto extends createZodDto(finaliseSalaryRunSchema) {}

/**
 * 012-monthly-salary-run / contracts/salary.md. Board 4.13 and its employee
 * detail.
 *
 * **Roles are per-method, never class-level.** Four of the five routes are
 * Company-Admin-only and the fifth is `@Public()` with its own signed token,
 * so a class-level `@Roles` would have to be overridden on that one anyway —
 * and a class-level gate is exactly what `011` had to unpick on
 * `shops.controller.ts` when a second role needed one route and not the rest.
 *
 * The four permissions (`salary-runs:create|read|update|finalise:company`)
 * are already seeded on `COMPANY_ADMIN` (`roles.seed.ts`), so there is no
 * permission work in this slice.
 */
@ApiTags('salary')
@Controller('salary-runs')
@UseGuards(RolesGuard)
export class SalaryController {
  constructor(
    private readonly salaryRunService: SalaryRunService,
    private readonly payslipService: PayslipService,
  ) {}

  /**
   * `GET /salary-runs` — board 4.13. A read: no key, no audit.
   *
   * Omitting `year`/`month` means the previous month, resolved from the
   * company's timezone. The client never names the default (FR-002).
   */
  @Roles('COMPANY_ADMIN')
  @Get()
  async getRun(
    @Req() request: AuthenticatedRequest,
    @Query() query: SalaryRunQueryDto,
  ) {
    return this.salaryRunService.getRun(this.requireCompanyId(request), query);
  }

  /**
   * `POST /salary-runs` — generate.
   *
   * The body is a period and nothing else: `generateSalaryRunSchema` is
   * `.strict()` and carries no figure, so a client proposing a `grossTotal`
   * gets a `400` rather than a silent strip (Constitution rule 1, FR-020).
   */
  @Roles('COMPANY_ADMIN')
  @Post()
  @UseGuards(RequireIdempotencyKeyGuard)
  @Audited('salary-run.generated', 'SalaryRun')
  async generate(
    @Req() request: AuthenticatedRequest,
    @Body() body: GenerateSalaryRunDto,
  ) {
    return this.salaryRunService.generate(
      this.requireCompanyId(request),
      this.requireCallerId(request),
      body,
    );
  }

  /**
   * `POST /salary-runs/:id/finalise` — the lock.
   *
   * Board 4.13's `Finalize August…`; the ellipsis is the confirmation
   * FR-026 requires, which lives in the client. The body is
   * `z.object({}).strict()`: who finalised it is the JWT's and when is the
   * server's clock. A second finalise is a `409`, never a silent overwrite
   * of who locked it first.
   */
  @Roles('COMPANY_ADMIN')
  @Post(':id/finalise')
  @UseGuards(RequireIdempotencyKeyGuard)
  @Audited('salary-run.finalised', 'SalaryRun')
  async finalise(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    // Declared so nestjs-zod VALIDATES the body: `finaliseSalaryRunSchema`
    // is `z.object({}).strict()`, so a client sending `finalisedBy` or
    // `finalisedAt` gets a 400. Nothing in it is read, by design — the same
    // shape `visits.controller.ts`'s markDelivered uses.
    @Body() body: FinaliseSalaryRunDto,
  ) {
    void body;
    return this.salaryRunService.finalise(
      this.requireCompanyId(request),
      this.requireCallerId(request),
      id,
    );
  }

  /**
   * `GET /salary-runs/:id/lines/:userId` — the employee detail (US3).
   *
   * Also where the payslip token is minted: this authenticated call returns
   * the signed URL, so the device never constructs one.
   */
  @Roles('COMPANY_ADMIN')
  @Get(':id/lines/:userId')
  async getLine(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    const companyId = this.requireCompanyId(request);
    const detail = await this.salaryRunService.getLine(companyId, id, userId);
    return {
      ...detail,
      payslipUrl: this.payslipService.signUrl(id, userId, companyId),
    };
  }

  /**
   * `GET /salary-runs/:id/payslip/:userId.pdf?token=` — the payslip.
   *
   * `@Public()` with its own signed HMAC rather than a bearer header,
   * modelled on `files.controller.ts`: the device hands this URL to Android's
   * own browser through `Linking`, and a browser sends no `Authorization`.
   * That is what keeps the mobile app free of a native rebuild.
   *
   * **Never log this URL whole** — the token is in the query string, and
   * tokens are on the redaction list (Constitution rule 9).
   */
  @Public()
  @Get(':id/payslip/:userId.pdf')
  async payslip(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Query('token') token: string | string[] | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const tokenValue = typeof token === 'string' ? token : '';
    const claims = this.payslipService.verifyToken(tokenValue);

    // One error for malformed, forged, expired and mismatched alike — saying
    // which would tell a prober how close they are.
    if (!claims || claims.runId !== id || claims.userId !== userId) {
      throw new AppError('INVALID_CREDENTIALS', 'Invalid or expired link.');
    }

    // `getLineForServing`, not `getLine`: this route is `@Public()`, so it
    // has no CLS transaction and must open its own for RLS to see anything.
    const detail = await this.salaryRunService.getLineForServing(
      claims.companyId,
      id,
      userId,
    );
    const companyName = await this.salaryRunService.companyName(
      claims.companyId,
    );
    const pdf = await this.payslipService.render(detail, companyName);

    response.setHeader('Content-Type', 'application/pdf');
    // Built by the payslip service, which sanitises the employee's name —
    // it is admin-entered free text going into a header. See its doc.
    response.setHeader(
      'Content-Disposition',
      this.payslipService.contentDisposition(detail),
    );
    response.send(pdf);
  }

  /** Every route's own `@Roles` already guarantees a tenant companyId exists — defensive, same posture as `users.controller.ts`. */
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
