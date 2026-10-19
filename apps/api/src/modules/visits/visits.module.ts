import { Module } from '@nestjs/common';

import { ShopPinService } from './shop-pin.service';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';

/**
 * 006-visit-outcomes. One controller covering `GET /stops/:id`,
 * `POST /visits` and `POST /shops/:id/pin` — the executive's whole outcome
 * path — backed by two services so the visit critical path and the pin
 * capture stay separately readable.
 */
@Module({
  controllers: [VisitsController],
  providers: [VisitsService, ShopPinService],
})
export class VisitsModule {}
