import { Module } from '@nestjs/common';

import { FilesModule } from '../files/files.module';
import { ShopsController } from './shops.controller';
import { ShopsService } from './shops.service';

/**
 * 002-shops-crud. Imports `FilesModule` to inject its exported
 * `FilesService` directly (`signFileUrl()` for each shop's `photoUrls`,
 * `uploadShopPhoto()` for `POST /shops/:id/photos` — no new HTTP call,
 * same in-process reuse `UsersModule` already established).
 */
@Module({
  imports: [FilesModule],
  controllers: [ShopsController],
  providers: [ShopsService],
})
export class ShopsModule {}
