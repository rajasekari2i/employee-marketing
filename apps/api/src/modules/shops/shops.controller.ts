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
 * 002-shops-crud / contracts/shops.md. Every route on this controller is
 * Company-Admin-only and an ORDINARY authenticated route (not `@Public()`,
 * not `@SkipTenant()`) — see `shops.service.ts`'s class doc for how it
 * re-scopes the request's own transaction to the caller's company before
 * touching `Shop`/`ShopPhoto`/`ShopPinChange`, same pattern
 * `users.service.ts` established.
 */
@ApiTags('shops')
@Controller('shops')
@UseGuards(RolesGuard)
@Roles('COMPANY_ADMIN')
export class ShopsController {
  constructor(private readonly shopsService: ShopsService) {}

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

  /** `@Roles('COMPANY_ADMIN')` on the class already guarantees a tenant companyId exists — defensive, same posture as `users.controller.ts`. */
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
