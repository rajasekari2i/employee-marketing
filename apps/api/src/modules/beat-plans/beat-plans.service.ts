import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import {
  AppError,
  type CreateBeatPlanInput,
  type ListBeatPlansQuery,
  type UpdateBeatPlanInput,
} from '@field-sales/shared';

import type { TransactionClsStore } from '../../common/interceptors/transaction.interceptor';

/** Own module-level, unextended Prisma client — same established pattern as `shops.service.ts`. */
const prisma = new PrismaClient();

/** The subset of the active transaction client this service needs. */
type BeatPlansTx = Pick<
  PrismaClient,
  'beatPlan' | 'beatPlanShop' | 'user' | 'shop' | '$executeRaw'
>;

/** One `GET /beat-plans` list item (contracts/beat-plans.md). */
export interface BeatPlanListItem {
  id: string;
  name: string;
  code: string;
  executive: { id: string; name: string } | null;
  workingDays: number[];
  isActive: boolean;
  shops: Array<{ id: string; name: string; pinStatus: 'NONE' | 'APPROVED' }>;
}

export interface BeatPlanListResult {
  items: BeatPlanListItem[];
  nextCursor: string | null;
}

/** The subset of a looked-up `BeatPlan` row {@link BeatPlansService.toListItem} needs. */
interface BeatPlanRow {
  id: string;
  name: string;
  code: string;
  executive: { id: string; name: string } | null;
  workingDays: number[];
  isActive: boolean;
  shops: Array<{
    sequence: number;
    shop: { id: string; name: string; locationStatus: string };
  }>;
}

/**
 * Backs `GET/POST /beat-plans`, `PATCH /beat-plans/:id` (003-beat-plans-crud;
 * shapes per contracts/beat-plans.md).
 *
 * Re-scopes the request's transaction to the caller's `companyId` the same
 * way `shops.service.ts` does — see that file's class doc for the full
 * reasoning (`TransactionInterceptor` opens the transaction, this service
 * re-sets both the RLS session variable and CLS's `companyId` key from the
 * caller's own JWT-verified id at the top of every public method).
 */
@Injectable()
export class BeatPlansService {
  constructor(private readonly cls: ClsService<TransactionClsStore>) {}

  /** The active request transaction, or the unextended fallback client (see class doc comment above for when that fallback would ever be used). */
  private tx(): BeatPlansTx {
    const store = this.cls.get();
    return (store?.tx as BeatPlansTx | undefined) ?? prisma;
  }

  /**
   * Re-scopes the already-open CLS transaction to the caller's own,
   * JWT-verified `companyId` — both the RLS session variable (Layer 2) and
   * CLS's own `companyId` key (which `tenant.extension.ts`'s Layer-1 filter
   * reads for every `tx.beatPlan.*`/`tx.beatPlanShop.*` call that follows).
   * Called at the top of EVERY public method below.
   */
  private async scopeToCaller(companyId: string): Promise<BeatPlansTx> {
    const tx = this.tx();
    await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
    this.cls.set('companyId', companyId);
    return tx;
  }

  /**
   * `GET /beat-plans`. `search` matches the plan's `name` or its assigned
   * executive's `name` (FR-003); `assignment: 'UNASSIGNED'` filters to
   * `executiveId: null`, `isActive` filters on that boolean (FR-004);
   * cursor-paginated, same shape as `ShopsService.list()`.
   */
  async list(
    companyId: string,
    query: ListBeatPlansQuery,
  ): Promise<BeatPlanListResult> {
    const tx = await this.scopeToCaller(companyId);

    const where: Prisma.BeatPlanWhereInput = {
      ...(query.assignment === 'UNASSIGNED' ? { executiveId: null } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              {
                executive: {
                  name: { contains: query.search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };

    const rows = await tx.beatPlan.findMany({
      where,
      take: query.limit,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: this.rowSelect,
    });

    const items = rows.map((row) => this.toListItem(row));

    return {
      items,
      nextCursor:
        rows.length === query.limit
          ? (rows[rows.length - 1]?.id ?? null)
          : null,
    };
  }

  /**
   * `POST /beat-plans`. Rejects a duplicate `(companyId, code)` as `409
   * DUPLICATE_BEAT_PLAN_CODE` (FR-010) rather than overwriting. Validates
   * `executiveId`/`shopIds` (data-model.md's Validation rules) before
   * writing anything. `shopIds` is de-duplicated keeping first occurrence,
   * then one `BeatPlanShop` per id is created with `sequence` set to that
   * id's position in the de-duplicated array.
   */
  async create(
    companyId: string,
    input: CreateBeatPlanInput,
  ): Promise<BeatPlanListItem> {
    const tx = await this.scopeToCaller(companyId);

    await this.assertCodeAvailable(tx, companyId, input.code);
    if (input.executiveId) {
      await this.assertExecutiveValid(tx, companyId, input.executiveId);
    }
    const shopIds = await this.dedupeAndValidateShopIds(
      tx,
      companyId,
      input.shopIds,
    );

    const plan = await tx.beatPlan.create({
      data: {
        companyId,
        code: input.code,
        name: input.name,
        isActive: input.isActive,
        executiveId: input.executiveId,
        workingDays: input.workingDays,
        shops: {
          create: shopIds.map((shopId, index) => ({
            companyId,
            shopId,
            sequence: index,
          })),
        },
      },
      select: this.rowSelect,
    });

    return this.toListItem(plan);
  }

  /**
   * `PATCH /beat-plans/:id`. Re-validates `code` uniqueness excluding the
   * plan's own row; re-validates `executiveId`/`shopIds` the same way
   * `create()` does when either is provided. When `shopIds` is provided
   * (including `[]`), every existing `BeatPlanShop` row for this plan is
   * deleted and recreated from the submitted array in the same transaction
   * (data-model.md's full-replace state transition); omitting it entirely
   * leaves the existing list untouched. `isActive: false` only ever flips
   * that flag — there is no delete method on this service (FR-013).
   */
  async update(
    companyId: string,
    id: string,
    input: UpdateBeatPlanInput,
  ): Promise<BeatPlanListItem> {
    const tx = await this.scopeToCaller(companyId);

    const existing = await tx.beatPlan.findFirst({
      where: { id, companyId },
      select: { id: true, code: true },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', `Beat plan "${id}" was not found.`);
    }

    if (input.code && input.code !== existing.code) {
      await this.assertCodeAvailable(tx, companyId, input.code, id);
    }
    if (input.executiveId) {
      await this.assertExecutiveValid(tx, companyId, input.executiveId);
    }

    const shopIds =
      input.shopIds !== undefined
        ? await this.dedupeAndValidateShopIds(tx, companyId, input.shopIds)
        : undefined;

    if (shopIds !== undefined) {
      await tx.beatPlanShop.deleteMany({ where: { beatPlanId: id } });
    }

    const plan = await tx.beatPlan.update({
      where: { id },
      data: {
        code: input.code,
        name: input.name,
        isActive: input.isActive,
        // `null` explicitly clears the assignment; `undefined` (the field
        // simply absent from the request) leaves it untouched — Prisma's
        // own distinction between "key omitted" and "key: null" in a
        // partial update, which `updateBeatPlanSchema`'s `executiveId:
        // string | null | undefined` already preserves end to end.
        executiveId: input.executiveId,
        workingDays: input.workingDays,
        ...(shopIds !== undefined
          ? {
              shops: {
                create: shopIds.map((shopId, index) => ({
                  companyId,
                  shopId,
                  sequence: index,
                })),
              },
            }
          : {}),
      },
      select: this.rowSelect,
    });

    return this.toListItem(plan);
  }

  /** Case-sensitive per data-model.md — `code` is unique with `companyId` (FR-010). `excludeId` is passed from `update()` so a plan keeping its own code doesn't collide with itself. */
  private async assertCodeAvailable(
    tx: BeatPlansTx,
    companyId: string,
    code: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await tx.beatPlan.findFirst({
      where: {
        companyId,
        code,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (existing) {
      throw new AppError(
        'DUPLICATE_BEAT_PLAN_CODE',
        `Beat plan code "${code}" is already in use in this company.`,
      );
    }
  }

  /** data-model.md: `executiveId` must resolve to an `ACTIVE` `MARKETING_EXECUTIVE` user in the caller's own company. */
  private async assertExecutiveValid(
    tx: BeatPlansTx,
    companyId: string,
    executiveId: string,
  ): Promise<void> {
    const executive = await tx.user.findFirst({
      where: {
        id: executiveId,
        companyId,
        status: 'ACTIVE',
        role: { key: 'MARKETING_EXECUTIVE' },
      },
      select: { id: true },
    });
    if (!executive) {
      throw new AppError(
        'VALIDATION_FAILED',
        `"${executiveId}" is not an active Marketing Executive in this company.`,
      );
    }
  }

  /** data-model.md: every `shopIds` entry must resolve to a `Shop` in the caller's own company; duplicates collapse to the first occurrence. */
  private async dedupeAndValidateShopIds(
    tx: BeatPlansTx,
    companyId: string,
    shopIds: string[],
  ): Promise<string[]> {
    const deduped = [...new Set(shopIds)];
    if (deduped.length === 0) {
      return deduped;
    }

    const found = await tx.shop.findMany({
      where: { id: { in: deduped }, companyId },
      select: { id: true },
    });
    const foundIds = new Set(found.map((shop) => shop.id));
    const missing = deduped.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Shop id(s) not found in this company: ${missing.join(', ')}.`,
      );
    }

    return deduped;
  }

  /** `select` shape shared by `list()`/`create()`/`update()`, used by `toListItem()`. */
  private readonly rowSelect = {
    id: true,
    name: true,
    code: true,
    executive: { select: { id: true, name: true } },
    workingDays: true,
    isActive: true,
    shops: {
      orderBy: { sequence: 'asc' as const },
      select: {
        sequence: true,
        shop: { select: { id: true, name: true, locationStatus: true } },
      },
    },
  } satisfies Prisma.BeatPlanSelect;

  private toListItem(row: BeatPlanRow): BeatPlanListItem {
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      executive: row.executive,
      workingDays: row.workingDays,
      isActive: row.isActive,
      shops: row.shops.map(({ shop }) => ({
        id: shop.id,
        name: shop.name,
        pinStatus: shop.locationStatus as 'NONE' | 'APPROVED',
      })),
    };
  }
}
