import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  AppError,
  createShopSchema,
  listShopsQuerySchema,
  updateShopSchema,
} from '@field-sales/shared';

import { Audited } from '../../common/decorators/audited.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../../common/guards/jwt-auth.guard';
import { RequireIdempotencyKeyGuard } from '../../common/guards/require-idempotency-key.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ShopsService } from './shops.service';

/** Same figure as `files.controller.ts`'s `AVATAR_UPLOAD_MAX_BYTES` — see that file's comment for why it's re-declared rather than imported. */
const SHOP_PHOTO_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

class ListShopsQueryDto extends createZodDto(listShopsQuerySchema) {}
class CreateShopDto extends createZodDto(createShopSchema) {}
class UpdateShopDto extends createZodDto(updateShopSchema) {}

/**
 * 002-shops-crud / contracts/shops.md. Every route here is an ORDINARY
 * authenticated route (not `@Public()`, not `@SkipTenant()`) — see
 * `shops.service.ts`'s class doc for how it re-scopes the request's own
 * transaction to the caller's company before touching
 * `Shop`/`ShopPhoto`/`ShopPinChange`, same pattern `users.service.ts`
 * established.
 *
 * **Roles are per-method, never class-level.** Writing shops is the Company
 * Admin's alone; *reading* them is also the Manager's, because board 3.2
 * ("Add shop to today") is a shop search and FR-042 requires it. A
 * class-level `@Roles('COMPANY_ADMIN','MANAGER')` would have handed the
 * manager `POST` and `PATCH` as well — the same trap `reports.controller.ts`
 * and `visits.controller.ts` avoided the same way.
 */
@ApiTags('shops')
@Controller('shops')
@UseGuards(RolesGuard)
export class ShopsController {
  constructor(private readonly shopsService: ShopsService) {}

  /**
   * Read-only, and the one route a Manager may call.
   *
   * `03-ARCHITECTURE.md:814` groups `GET/POST/PATCH /shops` on one line
   * marked "Company Admin", which is what produced the class-level gate and
   * made board 3.2's search fail with `403` for every manager. That line is
   * the outlier: `02-PRD.md`'s capability matrix gives the Manager `R` on
   * Shops, the seeded `MANAGER` role carries `shops:read:company`, and
   * FR-042 has the manager searching the company's shops. The three agree;
   * the table collapsed a read and two writes into one row.
   */
  @Roles('COMPANY_ADMIN', 'MANAGER')
  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: ListShopsQueryDto,
  ) {
    return this.shopsService.list(
      this.requireCompanyId(request),
      this.requireCallerId(request),
      query,
    );
  }

  @Roles('COMPANY_ADMIN')
  @Post()
  @UseGuards(RequireIdempotencyKeyGuard)
  @Audited('shop.create', 'Shop')
  create(@Req() request: AuthenticatedRequest, @Body() body: CreateShopDto) {
    return this.shopsService.create(
      this.requireCompanyId(request),
      this.requireCallerId(request),
      body,
    );
  }

  @Roles('COMPANY_ADMIN')
  @Patch(':id')
  @UseGuards(RequireIdempotencyKeyGuard)
  @Audited('shop.update', 'Shop')
  update(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: UpdateShopDto,
  ) {
    return this.shopsService.update(
      this.requireCompanyId(request),
      this.requireCallerId(request),
      id,
      body,
    );
  }

  /** Multipart upload, mirroring `files.controller.ts`'s `uploadAvatar` route exactly (same `FileInterceptor`/`RequireIdempotencyKeyGuard` shape). */
  @Roles('COMPANY_ADMIN')
  @Post(':id/photos')
  @UseGuards(RequireIdempotencyKeyGuard)
  @Audited('shop.photo.add', 'Shop')
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: SHOP_PHOTO_UPLOAD_MAX_BYTES },
    }),
  )
  async addPhoto(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) {
      throw new AppError('VALIDATION_FAILED', 'No file was uploaded.');
    }
    return this.shopsService.addPhoto(
      this.requireCompanyId(request),
      this.requireCallerId(request),
      id,
      file.buffer,
      file.mimetype,
    );
  }

  @Roles('COMPANY_ADMIN')
  @Delete(':id/photos/:photoId')
  @HttpCode(204)
  @Audited('shop.photo.remove', 'Shop')
  async removePhoto(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('photoId') photoId: string,
  ): Promise<void> {
    await this.shopsService.removePhoto(
      this.requireCompanyId(request),
      id,
      photoId,
    );
  }

  /** Every route's own `@Roles` already guarantees a tenant companyId exists — defensive, same posture as `users.controller.ts`. */
  private requireCompanyId(request: AuthenticatedRequest): string {
    const companyId = request.user?.companyId;
    if (!companyId) {
      throw new AppError(
        'FORBIDDEN_ROLE',
        'This action requires a company-scoped account.',
      );
    }
    return companyId;
  }

  private requireCallerId(request: AuthenticatedRequest): string {
    const sub = request.user?.sub;
    if (!sub) {
      throw new AppError(
        'INVALID_CREDENTIALS',
        'Missing authenticated user context.',
      );
    }
    return sub;
  }
}
