import { Module } from '@nestjs/common';

import { AssignmentsModule } from '../assignments/assignments.module';

import { PayslipService } from './payslip.service';
import { SalaryController } from './salary.controller';
import { SalaryRunService } from './salary-run.service';

/**
 * 012-monthly-salary-run. Salary is its own aggregate — it does not merely
 * report over attendance, it WRITES records that must outlive the data they
 * were computed from, with their own versioning and lock rules. That is the
 * whole difference between this module and `reports`.
 *
 * Two providers, split on a real seam: `SalaryRunService` owns the arithmetic
 * and the state machine, `PayslipService` owns rendering and holds the only
 * `pdfkit` import. A document format changes independently of money.
 *
 * `CompanyClock` comes from `AssignmentsModule`, which exports it, as
 * `VisitsModule`, `ReportsModule` and `AttendanceModule` all do.
 */
@Module({
  imports: [AssignmentsModule],
  controllers: [SalaryController],
  providers: [SalaryRunService, PayslipService],
})
export class SalaryModule {}
