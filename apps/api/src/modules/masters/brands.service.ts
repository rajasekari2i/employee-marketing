import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import {
  AppError,
  type CreateBrandInput,
  type ReorderInput,
  type UpdateBrandInput,
} from '@field-sales/shared';

import type { TransactionClsStore } from '../../common/interceptors/transaction.interceptor';

/** Own module-level, unextended Prisma client — same established pattern as `beat-plans.service.ts`. */
const prisma = new PrismaClient();

/** The subset of the active transaction client this service needs. */
type BrandsTx = Pick<PrismaClient, 'brand' | '$executeRaw'>;

/** One `GET /brands` list item (contracts/masters.md). */
export interface BrandListItem {
  id: string;
  label: string;
  displayOrder: number;
  isActive: boolean;
}

export interface BrandListResult {
  items: BrandListItem[];
}

/**
 * Backs `GET/POST /brands`, `PATCH /brands/order`, `PATCH /brands/:id`
 * (004-brands-reasons-crud; shapes per contracts/masters.md).
 *
 * Re-scopes the request's transaction to the caller's `companyId` the same
 * way `beat-plans.service.ts` does — see that file's class doc for the full
 * reasoning (`TransactionInterceptor` opens the transaction, this service
 * re-sets both the RLS session variable and CLS's `companyId` key from the
 * caller's own JWT-verified id at the top of every public method).
 */
@Injectable()
export class BrandsService {
  constructor(private readonly cls: ClsService<TransactionClsStore>) {}

  private readonly rowSelect = {
    id: true,
    label: true,
    displayOrder: true,
    isActive: true,
  } as const;

  /** The active request transaction, or the unextended fallback client. */
  private tx(): BrandsTx {
    const store = this.cls.get();
    return (store?.tx as BrandsTx | undefined) ?? prisma;
  }

  /**
   * Re-scopes the already-open CLS transaction to the caller's own,
   * JWT-verified `companyId` — both the RLS session variable (Layer 2) and
   * CLS's own `companyId` key (which `tenant.extension.ts`'s Layer-1 filter
   * reads for every `tx.brand.*` call that follows). Called at the top of
   * EVERY public method below.
   */
  private async scopeToCaller(companyId: string): Promise<BrandsTx> {
    const tx = this.tx();
    await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
    this.cls.set('companyId', companyId);
    return tx;
  }

  /**
   * `GET /brands`. Deliberately unpaginated and unfiltered (research.md
   * §2): reordering needs the whole list in hand, board 4.12 has neither a
   * search field nor filter chips, and these lists are tens of rows per
   * company. Active and inactive rows come back interleaved in one
   * ordering — the design distinguishes them by row styling, not by
   * segregating them.
   */
  async list(companyId: string): Promise<BrandListResult> {
    const tx = await this.scopeToCaller(companyId);

    const items = await tx.brand.findMany({
      orderBy: { displayOrder: 'asc' },
      select: this.rowSelect,
    });

    return { items };
  }

  /**
   * `POST /brands`. Rejects a case-insensitive duplicate label within the
   * company as `409 DUPLICATE_BRAND_LABEL` (FR-007) rather than creating a
   * near-twin. `displayOrder` is server-derived as "last position" — never
   * accepted from the client (CLAUDE.md rule 1).
   *
   * The label arrives already trimmed by `labelSchema` (`z.string().trim()`
   * transforms, it does not merely validate), so what is compared here is
   * what gets stored.
   */
  async create(
    companyId: string,
    input: CreateBrandInput,
  ): Promise<BrandListItem> {
    const tx = await this.scopeToCaller(companyId);

    const existing = await tx.brand.findFirst({
      where: { label: { equals: input.label, mode: 'insensitive' } },
      select: { id: true },
    });

    if (existing) {
      throw new AppError(
        'DUPLICATE_BRAND_LABEL',
        'A brand with this label already exists.',
      );
    }

    const last = await tx.brand.aggregate({ _max: { displayOrder: true } });
    const displayOrder = (last._max.displayOrder ?? -1) + 1;

    return tx.brand.create({
      data: { companyId, label: input.label, displayOrder, isActive: true },
      select: this.rowSelect,
    });
  }

  /**
   * `PATCH /brands/order`. `ids` must be EXACTLY this company's set of
   * brands — every one, each once, nothing else. A list that is missing a
   * row, repeats one, or carries an unknown/foreign id is rejected rather
   * than partially applied, so a reorder submitted against a stale list
   * (another admin added a brand meanwhile) fails visibly instead of
   * silently dropping the row this client never saw (contracts/masters.md).
   *
   * `displayOrder` is written from each id's position in the array, so a
   * gap, duplicate or collision is structurally impossible rather than
   * something to validate afterwards.
   */
  async reorder(
    companyId: string,
    input: ReorderInput,
  ): Promise<BrandListResult> {
    const tx = await this.scopeToCaller(companyId);

    const stored = await tx.brand.findMany({ select: { id: true } });
    const storedIds = new Set(stored.map((row) => row.id));
    const submitted = new Set(input.ids);

    if (
      submitted.size !== input.ids.length ||
      submitted.size !== storedIds.size ||
      input.ids.some((id) => !storedIds.has(id))
    ) {
      throw new AppError(
        'VALIDATION_FAILED',
        'The submitted order must list every brand in this company exactly once. Reload the list and try again.',
        [
          {
            path: 'ids',
            message: 'Must match the current brand list exactly.',
          },
        ],
      );
    }

    await Promise.all(
      input.ids.map((id, index) =>
        tx.brand.update({ where: { id }, data: { displayOrder: index } }),
      ),
    );

    return this.list(companyId);
  }

  /**
   * `PATCH /brands/:id`. Renames and/or activates — only the fields present
   * in the body change (`updateBrandSchema` makes both optional and rejects
   * an empty body).
   *
   * A rename is re-checked for a case-insensitive duplicate the same way
   * create is, EXCLUDING this row's own id — otherwise re-saving a label
   * unchanged (or changing only its capitalisation) would collide with
   * itself. `displayOrder` is untouched by a rename: renaming a row does
   * not move it.
   *
   * There is deliberately no delete path anywhere on this resource:
   * deactivation is the only way to retire a brand (FR-015, PRD FR-ADM-09),
   * so a brand already referenced by recorded history keeps that history.
   */
  async update(
    companyId: string,
    id: string,
    input: UpdateBrandInput,
  ): Promise<BrandListItem> {
    const tx = await this.scopeToCaller(companyId);

    const existing = await tx.brand.findFirst({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new AppError('NOT_FOUND', 'Brand not found.');
    }

    if (input.label !== undefined) {
      const clash = await tx.brand.findFirst({
        where: {
          label: { equals: input.label, mode: 'insensitive' },
          id: { not: id },
        },
        select: { id: true },
      });

      if (clash) {
        throw new AppError(
          'DUPLICATE_BRAND_LABEL',
          'A brand with this label already exists.',
        );
      }
    }

    return tx.brand.update({
      where: { id },
      data: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      select: this.rowSelect,
    });
  }
}
