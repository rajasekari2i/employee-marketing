import { Module } from '@nestjs/common';

import { AssignmentsModule } from '../assignments/assignments.module';

import { ExecutiveTotalsService } from './executive-totals.service';
import { ReportsController } from './reports.controller';

/**
 * 009-my-totals. The reports module — new in this slice, and the place
 * slice 014's `previous-day`, `shop-history` and CSV export routes will join.
 *
 * It is not part of `visits`: this read spans `DailyAssignment`,
 * `AssignmentStop`, `Visit`, `Order` and `OrderLine` together and belongs to
 * none of them, and putting it there would mean moving four routes out again
 * later.
 *
 * `CompanyClock` comes from `AssignmentsModule`, which exports it — imported
 * rather than re-provided so there is one instance as well as one
 * implementation (rule 8). `VisitsModule` does the same. No cycle:
 * `AssignmentsModule` imports neither.
 */
@Module({
  imports: [AssignmentsModule],
  controllers: [ReportsController],
  providers: [ExecutiveTotalsService],
})
export class ReportsModule {}
