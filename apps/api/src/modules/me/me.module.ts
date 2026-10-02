import { Module } from '@nestjs/common';

import { MeController } from './me.controller';
import { MeService } from './me.service';

/** User Story 2 (specs/001-company-user-auth/orchestration-plan.md), DoD item 1. */
@Module({
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
