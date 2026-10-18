import { Module } from '@nestjs/common';

import { BeatPlansController } from './beat-plans.controller';
import { BeatPlansService } from './beat-plans.service';

/**
 * 003-beat-plans-crud. Unlike `ShopsModule`, this module needs no
 * `FilesModule` import — nothing on `BeatPlan`/`BeatPlanShop` is a photo or
 * any other file-backed field.
 */
@Module({
  controllers: [BeatPlansController],
  providers: [BeatPlansService],
})
export class BeatPlansModule {}
