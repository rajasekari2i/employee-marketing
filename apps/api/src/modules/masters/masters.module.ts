import { Module } from '@nestjs/common';

import { BrandsController } from './brands.controller';
import { BrandsService } from './brands.service';
import { ReasonsController } from './reasons.controller';
import { ReasonsService } from './reasons.service';

/**
 * 004-brands-reasons-crud. One module, two resources — Architecture §3's
 * directory sketch names the folder (`modules/masters/ # brands, reasons`)
 * while §7's API surface table keeps the two route bases separate
 * (`/brands`, `/reasons`), which is exactly this shape (research.md §6).
 *
 * The two resources stay as sibling controller/service pairs rather than one
 * generic parameterised service: their shared surface is small, and every
 * guard that actually matters (the system "Other" row's immutability, the
 * "Other"-last ordering, the per-company bootstrap invariant) exists on
 * reasons only.
 */
@Module({
  controllers: [BrandsController, ReasonsController],
  providers: [BrandsService, ReasonsService],
})
export class MastersModule {}
