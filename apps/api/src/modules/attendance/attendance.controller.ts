import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  AppError,
  attendanceDayQuerySchema,
  recordAttendanceSchema,
} from '@field-sales/shared';

import { Audited } from '../../common/decorators/audited.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../../common/guards/jwt-auth.guard';
import { RequireIdempotencyKeyGuard } from '../../common/guards/require-idempotency-key.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AttendanceService } from './attendance.service';

class AttendanceDayQueryDto extends createZodDto(attendanceDayQuerySchema) {}
class RecordAttendanceDto extends createZodDto(recordAttendanceSchema) {}

/**
 * 010-manager-app / contracts/manager-app.md. Boards 3.7 and 3.8.
 *
 * Unlike the visits, assignments and reports controllers — which each hold
 * executive routes and gained a manager one beside them — this controller
 * is manager-only throughout, so the role sits at class level.
 */
@ApiTags('attendance')
@Controller('attendance')
@UseGuards(RolesGuard)
@Roles('MANAGER')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  /** Board 3.7's day sheet. A read: no key, no audit. */
  @Get()
  async day(
    @Req() request: AuthenticatedRequest,
    @Query() query: AttendanceDayQueryDto,
  ) {
    return this.attendanceService.day(this.requireCompanyId(request), query);
  }

  /**
   * Board 3.8. An upsert to the caller, an **insert** to the database — an
   * amendment adds a version and keeps the one before (FR-037).
   *
   * `latenessFlag` and `payableUnits` are derived server-side and are absent
   * from the schema, which is `.strict()`, so a client sending either gets a
   * `400` rather than a silent strip.
   */
  @Post()
  @UseGuards(RequireIdempotencyKeyGuard)
  @Audited('attendance.record', 'Attendance')
  async record(
    @Req() request: AuthenticatedRequest,
    @Body() body: RecordAttendanceDto,
  ) {
    return this.attendanceService.record(
      this.requireCompanyId(request),
      this.requireManagerId(request),
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

  /** The acting manager, recorded on every attendance row. */
  private requireManagerId(request: AuthenticatedRequest): string {
    const managerId = request.user?.sub;
    if (!managerId) {
      throw new AppError(
        'FORBIDDEN_ROLE',
        'This action requires a signed-in user.',
      );
    }
    return managerId;
  }
}
