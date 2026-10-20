import { Module } from '@nestjs/common';

import { AssignmentsModule } from '../assignments/assignments.module';

import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

/**
 * 010-manager-app. Attendance is its own aggregate — its own model, its own
 * append-only versioning rules, its own settings — so it gets its own
 * module rather than joining `visits` or `reports`.
 *
 * `CompanyClock` comes from `AssignmentsModule`, which exports it, as
 * `VisitsModule` and `ReportsModule` both do.
 */
@Module({
  imports: [AssignmentsModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
})
export class AttendanceModule {}
