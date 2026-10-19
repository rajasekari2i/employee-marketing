import { Module } from '@nestjs/common';

import { CompanyClock } from '../../infra/time/company-clock.service';
import { AssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { ExtraStopService } from './extra-stop.service';

/**
 * 005-executive-dashboard. Provides `CompanyClock` here rather than importing
 * it from a shared module because this is its first consumer; when attendance
 * or the reminder jobs need it too, it moves to a global `InfraModule` without
 * changing a caller (CLAUDE.md rule 8 requires one implementation, not one
 * provider location).
 */
@Module({
  controllers: [AssignmentsController],
  providers: [AssignmentsService, ExtraStopService, CompanyClock],
  exports: [CompanyClock],
})
export class AssignmentsModule {}
