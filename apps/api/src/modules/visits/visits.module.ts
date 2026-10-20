import { Module } from '@nestjs/common';

import { AssignmentsModule } from '../assignments/assignments.module';

import { ManagerVisitsService } from './manager-visits.service';
import { MyVisitsService } from './my-visits.service';
import { OrderDeliveryService } from './order-delivery.service';
import { NearbyShopsService } from './nearby-shops.service';
import { ShopPinService } from './shop-pin.service';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';

/**
 * 006-visit-outcomes. One controller covering `GET /stops/:id`,
 * `POST /visits` and `POST /shops/:id/pin` — the executive's whole outcome
 * path — backed by two services so the visit critical path and the pin
 * capture stay separately readable.
 *
 * 007-extra-shops adds `GET /shops/nearby`, board 1.4's picker. Same
 * reasoning for the placement: an executive field route on a `/shops` path.
 *
 * 008-my-visits adds `GET /visits/mine`, board 1.5's history. It needs
 * `CompanyClock` for the date-range window, which `AssignmentsModule`
 * exports.
 */
@Module({
  // `CompanyClock` lives in AssignmentsModule, which exports it. Imported
  // rather than re-provided so there is one instance as well as one
  // implementation — rule 8 requires the second, and this gets the first for
  // free. No cycle: AssignmentsModule does not import this one.
  imports: [AssignmentsModule],
  controllers: [VisitsController],
  providers: [
    VisitsService,
    ShopPinService,
    NearbyShopsService,
    MyVisitsService,
    ManagerVisitsService,
    OrderDeliveryService,
  ],
})
export class VisitsModule {}
