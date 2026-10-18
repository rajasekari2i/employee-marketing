import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import {
  AppError,
  type CreateShopInput,
  type ListShopsQuery,
  type LocationSource,
  type UpdateShopInput,
} from '@field-sales/shared';

import type { TransactionClsStore } from '../../common/interceptors/transaction.interceptor';
import { FilesService } from '../files/files.service';

/** Own module-level, unextended Prisma client — same established pattern as `users.service.ts`. */
const prisma = new PrismaClient();

/** FR-007: "up to 3" shop photos. */
const MAX_SHOP_PHOTOS = 3;

/** The subset of the active transaction client this service needs. */
type ShopsTx = Pick<
  PrismaClient,
  'shop' | 'shopPhoto' | 'shopPinChange' | '$executeRaw'
>;

/** One `GET /shops` list item (contracts/shops.md). */
export interface ShopListItem {
  id: string;
  name: string;
  shopCode: string;
  ownerName: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  pinStatus: 'NONE' | 'APPROVED';
  /** Both `null` unless `pinStatus` is `APPROVED` — this is what lets the edit form redraw the existing pin (spec.md US3 Acceptance Scenario 1: the form opens "pre-filled with that shop's current data"). Returned to the Company Admin only; this is not the Marketing-Executive-facing visit-flags rule (CLAUDE.md's role-visibility rule), which is about `distanceMeters`/`isExceedRange`, not a shop's own coordinates. */
  latitude: number | null;
  longitude: number | null;
  locationSource: LocationSource | null;
  /** `null` = using the company-wide default (FR-007) — missing from the edit form's prefill until this was added (found live: saved correctly on create/update, never returned by GET). */
  verificationRadiusMeters: number | null;
  isActive: boolean;
  /**
   * 003-beat-plans-crud follow-up: every beat plan this shop currently
   * belongs to (a shop can be on more than one plan, OD-03 — this is why
   * it's an array, not a single nullable name). Empty = not on any plan
   * ("Unassigned" in the UI). Ownership of the membership itself lives on
   * `BeatPlan`/`BeatPlanShop` (added/removed from the beat plan's own shop
   * list), never editable from here — this is read-only, display-only data.
   */
  beatPlanNames: string[];
  /** `id` is each `ShopPhoto` row's own id — needed by `DELETE /shops/:id/photos/:photoId`, not just display. */
  photos: Array<{ id: string; url: string }>;
}

export interface ShopListResult {
  items: ShopListItem[];
  nextCursor: string | null;
}

/** The subset of a looked-up `Shop` row {@link ShopsService.toListItem} needs. */
interface ShopRow {
  id: string;
  name: string;
  shopCode: string;
  ownerName: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  locationStatus: string;
  latitude: Prisma.Decimal | null;
  longitude: Prisma.Decimal | null;
  locationSource: string | null;
  verificationRadiusMeters: number | null;
  isActive: boolean;
  beatPlanShops: Array<{ beatPlan: { name: string } }>;
  photos: Array<{ id: string; fileId: string }>;
}

/**
 * Backs `GET/POST /shops`, `PATCH /shops/:id`, `POST/DELETE
 * /shops/:id/photos` (002-shops-crud; shapes per contracts/shops.md).
 *
 * Re-scopes the request's transaction to the caller's `companyId` the same
 * way `users.service.ts` does — see that file's class doc for the full
 * reasoning (`TransactionInterceptor` opens the transaction, this service
 * re-sets both the RLS session variable and CLS's `companyId` key from the
 * caller's own JWT-verified id at the top of every public method).
 */
@Injectable()
export class ShopsService {
  constructor(
    private readonly cls: ClsService<TransactionClsStore>,
    private readonly filesService: FilesService,
  ) {}

  /** The active request transaction, or the unextended fallback client (see class doc comment above for when that fallback would ever be used). */
  private tx(): ShopsTx {
    const store = this.cls.get();
    return (store?.tx as ShopsTx | undefined) ?? prisma;
  }

  /**
   * Re-scopes the already-open CLS transaction to the caller's own,
   * JWT-verified `companyId` — both the RLS session variable (Layer 2) and
   * CLS's own `companyId` key (which `tenant.extension.ts`'s Layer-1 filter
   * reads for every `tx.shop.*`/`tx.shopPhoto.*`/`tx.shopPinChange.*` call
   * that follows). Called at the top of EVERY public method below.
   */
  private async scopeToCaller(companyId: string): Promise<ShopsTx> {
    const tx = this.tx();
    await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
    this.cls.set('companyId', companyId);
    return tx;
  }

  /**
   * `GET /shops`. `search` matches name/shopCode/ownerName/phone (FR-003);
   * `pinStatus: 'NO_PIN'` filters to `locationStatus: 'NONE'`, `isActive`
   * filters on that boolean (FR-004); cursor-paginated, same shape as
   * `UsersService.list()`. `beatPlanId` (003-beat-plans-crud follow-up)
   * matches shops that are on that specific plan — the directory's "All
   * beats" filter.
   */
  async list(
    companyId: string,
    callerId: string,
    query: ListShopsQuery,
  ): Promise<ShopListResult> {
    const tx = await this.scopeToCaller(companyId);

    const where: Prisma.ShopWhereInput = {
      ...(query.pinStatus === 'NO_PIN' ? { locationStatus: 'NONE' } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.beatPlanId
        ? { beatPlanShops: { some: { beatPlanId: query.beatPlanId } } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { shopCode: { contains: query.search, mode: 'insensitive' } },
              { ownerName: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const rows = await tx.shop.findMany({
      where,
      take: query.limit,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: this.rowSelect,
    });

    const items = rows.map((row) => this.toListItem(companyId, callerId, row));

    return {
      items,
      nextCursor:
        rows.length === query.limit
          ? (rows[rows.length - 1]?.id ?? null)
          : null,
    };
  }

  /**
   * `POST /shops`. Rejects a duplicate `(companyId, shopCode)` as `409
   * DUPLICATE_SHOP_CODE` (FR-008) rather than overwriting. A provided
   * `location` is always a direct capture here — a brand-new shop has no
   * prior approved pin to protect, so `locationStatus` goes straight to
   * `APPROVED` with both captured-by and verified-by set to this caller
   * (data-model.md state transitions; no `ShopPinChange` row on create).
   */
  async create(
    companyId: string,
    callerId: string,
    input: CreateShopInput,
  ): Promise<ShopListItem> {
    const tx = await this.scopeToCaller(companyId);

    await this.assertShopCodeAvailable(tx, companyId, input.shopCode);

    const now = new Date();
    const shop = await tx.shop.create({
      data: {
        companyId,
        shopCode: input.shopCode,
        name: input.name,
        isActive: input.isActive,
        ownerName: input.ownerName,
        phone: input.phone,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2,
        city: input.city,
        state: input.state,
        postalCode: input.postalCode,
        verificationRadiusMeters: input.verificationRadiusMeters,
        ...(input.location
          ? {
              latitude: input.location.latitude,
              longitude: input.location.longitude,
              locationSource: input.location.source,
              locationStatus: 'APPROVED',
              locationCapturedAt: now,
              locationCapturedBy: callerId,
              locationVerifiedAt: now,
              locationVerifiedBy: callerId,
            }
          : {}),
      },
      select: this.rowSelect,
    });

    return this.toListItem(companyId, callerId, shop);
  }

  /**
   * `PATCH /shops/:id`. Re-validates `shopCode` uniqueness excluding the
   * shop's own row. When `location` is provided and the shop's current
   * `locationStatus` is already `APPROVED` and the new coordinates differ
   * from the stored ones, writes one `ShopPinChange` row in the same
   * transaction before applying the new coordinates (BUS-17; research.md
   * §3) — self-decided by the same Company Admin, consistent with their
   * existing decide-authority over pin-change requests. A shop still at
   * `NONE` is a direct capture, exactly like `create()`. `isActive: false`
   * only ever flips that flag — there is no delete path (FR-011).
   */
  async update(
    companyId: string,
    callerId: string,
    id: string,
    input: UpdateShopInput,
  ): Promise<ShopListItem> {
    const tx = await this.scopeToCaller(companyId);

    const existing = await tx.shop.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        shopCode: true,
        latitude: true,
        longitude: true,
        locationStatus: true,
      },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', `Shop "${id}" was not found.`);
    }

    if (input.shopCode && input.shopCode !== existing.shopCode) {
      await this.assertShopCodeAvailable(tx, companyId, input.shopCode, id);
    }

    const now = new Date();
    let locationData: Prisma.ShopUpdateInput = {};

    if (input.location) {
      if (existing.locationStatus === 'APPROVED') {
        const unchanged =
          existing.latitude?.toNumber() === input.location.latitude &&
          existing.longitude?.toNumber() === input.location.longitude;

        if (!unchanged) {
          await tx.shopPinChange.create({
            data: {
              companyId,
              shopId: id,
              status: 'DECIDED',
              fromLatitude: existing.latitude,
              fromLongitude: existing.longitude,
              toLatitude: input.location.latitude,
              toLongitude: input.location.longitude,
              source: input.location.source,
              requestedBy: callerId,
              requestedAt: now,
              decidedBy: callerId,
              decidedAt: now,
            },
          });
        }
      }

      locationData = {
        latitude: input.location.latitude,
        longitude: input.location.longitude,
        locationSource: input.location.source,
        locationStatus: 'APPROVED',
        locationCapturedAt: now,
        locationCapturedBy: callerId,
        locationVerifiedAt: now,
        locationVerifiedBy: callerId,
      };
    }

    const shop = await tx.shop.update({
      where: { id },
      data: {
        shopCode: input.shopCode,
        name: input.name,
        isActive: input.isActive,
        ownerName: input.ownerName,
        phone: input.phone,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2,
        city: input.city,
        state: input.state,
        postalCode: input.postalCode,
        verificationRadiusMeters: input.verificationRadiusMeters,
        ...locationData,
      },
      select: this.rowSelect,
    });

    return this.toListItem(companyId, callerId, shop);
  }

  /**
   * `POST /shops/:id/photos`. Rejects with `VALIDATION_FAILED` *before*
   * calling the upload pipeline if the shop already has
   * {@link MAX_SHOP_PHOTOS} photos (FR-007) — no point processing/storing
   * an image this call is about to refuse to attach.
   */
  async addPhoto(
    companyId: string,
    callerId: string,
    shopId: string,
    buffer: Buffer,
    declaredMimeType: string,
  ): Promise<{ id: string; url: string; sortOrder: number }> {
    const tx = await this.scopeToCaller(companyId);

    const shop = await tx.shop.findFirst({
      where: { id: shopId, companyId },
      select: { id: true, _count: { select: { photos: true } } },
    });
    if (!shop) {
      throw new AppError('NOT_FOUND', `Shop "${shopId}" was not found.`);
    }
    if (shop._count.photos >= MAX_SHOP_PHOTOS) {
      throw new AppError(
        'VALIDATION_FAILED',
        `A shop can have at most ${MAX_SHOP_PHOTOS} photos.`,
      );
    }

    const fileObject = await this.filesService.uploadShopPhoto(
      companyId,
      callerId,
      buffer,
      declaredMimeType,
    );

    const photo = await tx.shopPhoto.create({
      data: {
        companyId,
        shopId,
        fileId: fileObject.id,
        sortOrder: shop._count.photos,
      },
    });

    return {
      id: photo.id,
      url: this.filesService.signFileUrl(fileObject.id, callerId, companyId),
      sortOrder: photo.sortOrder,
    };
  }

  /** `DELETE /shops/:id/photos/:photoId`. The underlying `FileObject` is left in place — same posture as every other photo removal in this codebase. */
  async removePhoto(
    companyId: string,
    shopId: string,
    photoId: string,
  ): Promise<void> {
    const tx = await this.scopeToCaller(companyId);

    const photo = await tx.shopPhoto.findFirst({
      where: { id: photoId, shopId, companyId },
      select: { id: true },
    });
    if (!photo) {
      throw new AppError('NOT_FOUND', `Photo "${photoId}" was not found.`);
    }

    await tx.shopPhoto.delete({ where: { id: photoId } });
  }

  /** `select` shape shared by `create()`/`update()` — matches `list()`'s own `select`, used by `toListItem()`. */
  private readonly rowSelect = {
    id: true,
    name: true,
    shopCode: true,
    ownerName: true,
    phone: true,
    addressLine1: true,
    addressLine2: true,
    city: true,
    state: true,
    postalCode: true,
    locationStatus: true,
    latitude: true,
    longitude: true,
    locationSource: true,
    verificationRadiusMeters: true,
    isActive: true,
    beatPlanShops: {
      select: { beatPlan: { select: { name: true } } },
    },
    photos: {
      orderBy: { sortOrder: 'asc' as const },
      select: { id: true, fileId: true },
    },
  } satisfies Prisma.ShopSelect;

  /** Case-sensitive per data-model.md — `shopCode` is unique with `companyId` (FR-008). `excludeId` is passed from `update()` so a shop keeping its own code doesn't collide with itself. */
  private async assertShopCodeAvailable(
    tx: ShopsTx,
    companyId: string,
    shopCode: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await tx.shop.findFirst({
      where: {
        companyId,
        shopCode,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (existing) {
      throw new AppError(
        'DUPLICATE_SHOP_CODE',
        `Shop code "${shopCode}" is already in use in this company.`,
      );
    }
  }

  private toListItem(
    companyId: string,
    viewerId: string,
    row: ShopRow,
  ): ShopListItem {
    return {
      id: row.id,
      name: row.name,
      shopCode: row.shopCode,
      ownerName: row.ownerName,
      phone: row.phone,
      addressLine1: row.addressLine1,
      addressLine2: row.addressLine2,
      city: row.city,
      state: row.state,
      postalCode: row.postalCode,
      pinStatus: row.locationStatus as 'NONE' | 'APPROVED',
      latitude: row.latitude?.toNumber() ?? null,
      longitude: row.longitude?.toNumber() ?? null,
      locationSource: (row.locationSource as LocationSource | null) ?? null,
      verificationRadiusMeters: row.verificationRadiusMeters,
      isActive: row.isActive,
      beatPlanNames: row.beatPlanShops.map((bps) => bps.beatPlan.name),
      photos: row.photos.map((photo) => ({
        id: photo.id,
        url: this.filesService.signFileUrl(
          photo.fileId,
          viewerId,
          companyId,
          true,
        ),
      })),
    };
  }
}
