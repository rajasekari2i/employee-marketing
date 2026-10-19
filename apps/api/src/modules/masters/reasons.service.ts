import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import {
  AppError,
  type CreateReasonInput,
  type ReorderInput,
  type UpdateReasonInput,
} from '@field-sales/shared';

import type { TransactionClsStore } from '../../common/interceptors/transaction.interceptor';

/** Own module-level, unextended Prisma client — same established pattern as `beat-plans.service.ts`. */
const prisma = new PrismaClient();

/** The subset of the active transaction client this service needs. */
type ReasonsTx = Pick<PrismaClient, 'reasonMessage' | '$executeRaw'>;

/** One `GET /reasons` list item (contracts/masters.md). */
export interface ReasonListItem {
  id: string;
  label: string;
  displayOrder: number;
  isActive: boolean;
  requiresText: boolean;
  isSystem: boolean;
}

export interface ReasonListResult {
  items: ReasonListItem[];
}

/**
 * Backs `GET/POST /reasons`, `PATCH /reasons/order`, `PATCH /reasons/:id`
 * (004-brands-reasons-crud; shapes per contracts/masters.md).
 *
 * The mirror of `BrandsService`, plus the guards around the one system
 * "Other" row every company has: it can never be deactivated, reordered,
 * relabelled or removed (FR-011/FR-013). Those guards live here, server
 * side — the UI also hides the controls, but that is a convenience, not the
 * enforcement.
 */
@Injectable()
export class ReasonsService {
  constructor(private readonly cls: ClsService<TransactionClsStore>) {}

  private readonly rowSelect = {
    id: true,
    label: true,
    displayOrder: true,
    isActive: true,
    requiresText: true,
    isSystem: true,
  } as const;

  /** The active request transaction, or the unextended fallback client. */
  private tx(): ReasonsTx {
    const store = this.cls.get();
    return (store?.tx as ReasonsTx | undefined) ?? prisma;
  }

  /** See `BrandsService.scopeToCaller` — identical, for `tx.reasonMessage.*`. */
  private async scopeToCaller(companyId: string): Promise<ReasonsTx> {
    const tx = this.tx();
    await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
    this.cls.set('companyId', companyId);
    return tx;
  }

  /**
   * `GET /reasons`. Unpaginated, for the same reasons as `BrandsService.list`.
   *
   * Ordered by `isSystem` first, so the "Other" row lands LAST by
   * construction rather than by holding a large `displayOrder` that a later
   * insert could overtake (data-model.md "Ordering"). `false` sorts before
   * `true` in Postgres, so the ascending direction is what puts the system
   * row at the end. The client never has to sort or special-case it.
   *
   * Every company always returns at least this one row.
   */
  async list(companyId: string, activeOnly = false): Promise<ReasonListResult> {
    const tx = await this.scopeToCaller(companyId);

    const items = await tx.reasonMessage.findMany({
      // 006-visit-outcomes: ACTIVE reasons only for a Marketing Executive
      // (FR-013), same reasoning as BrandsService.list. The system "Other"
      // row is always active, so it survives this filter and still sorts
      // last via the isSystem ordering below.
      ...(activeOnly ? { where: { isActive: true } } : {}),
      orderBy: [{ isSystem: 'asc' }, { displayOrder: 'asc' }],
      select: this.rowSelect,
    });

    return { items };
  }

  /**
   * `POST /reasons`. A client-supplied label of `Other` needs no
   * special-casing: it collides with the system row through the ordinary
   * case-insensitive duplicate path below and comes back as
   * `409 DUPLICATE_REASON_LABEL` (spec US2 scenario 4).
   *
   * `isSystem`/`requiresText` are always false for an admin-created reason —
   * only the company-bootstrap path ever sets them (companies.service.ts).
   */
  async create(
    companyId: string,
    input: CreateReasonInput,
  ): Promise<ReasonListItem> {
    const tx = await this.scopeToCaller(companyId);

    const existing = await tx.reasonMessage.findFirst({
      where: { label: { equals: input.label, mode: 'insensitive' } },
      select: { id: true },
    });

    if (existing) {
      throw new AppError(
        'DUPLICATE_REASON_LABEL',
        'A reason with this label already exists.',
      );
    }

    // Last position among the NON-system rows: the system row's own
    // displayOrder is meaningless for ordering (it always sorts last via
    // isSystem) and must not drag the next new reason's position with it.
    const last = await tx.reasonMessage.aggregate({
      where: { isSystem: false },
      _max: { displayOrder: true },
    });
    const displayOrder = (last._max.displayOrder ?? -1) + 1;

    return tx.reasonMessage.create({
      data: {
        companyId,
        label: input.label,
        displayOrder,
        isActive: true,
        requiresText: false,
        isSystem: false,
      },
      select: this.rowSelect,
    });
  }

  /**
   * `PATCH /reasons/order`. As `BrandsService.reorder`, with the system row
   * excluded throughout: the reorderable set is every NON-system reason, so
   * `ids` must contain all of them and must not contain the system row's id
   * (FR-013). An empty `ids` for a company whose only reason is "Other" is
   * valid and is a no-op.
   */
  async reorder(
    companyId: string,
    input: ReorderInput,
  ): Promise<ReasonListResult> {
    const tx = await this.scopeToCaller(companyId);

    const stored = await tx.reasonMessage.findMany({
      select: { id: true, isSystem: true },
    });

    const systemIds = new Set(
      stored.filter((row) => row.isSystem).map((row) => row.id),
    );

    if (input.ids.some((id) => systemIds.has(id))) {
      throw new AppError(
        'SYSTEM_REASON_IMMUTABLE',
        'The "Other" reason is always last and cannot be reordered.',
      );
    }

    const reorderableIds = new Set(
      stored.filter((row) => !row.isSystem).map((row) => row.id),
    );
    const submitted = new Set(input.ids);

    if (
      submitted.size !== input.ids.length ||
      submitted.size !== reorderableIds.size ||
      input.ids.some((id) => !reorderableIds.has(id))
    ) {
      throw new AppError(
        'VALIDATION_FAILED',
        'The submitted order must list every reason in this company exactly once, excluding "Other". Reload the list and try again.',
        [
          {
            path: 'ids',
            message: 'Must match the current reason list exactly.',
          },
        ],
      );
    }

    await Promise.all(
      input.ids.map((id, index) =>
        tx.reasonMessage.update({
          where: { id },
          data: { displayOrder: index },
        }),
      ),
    );

    return this.list(companyId);
  }

  /**
   * `PATCH /reasons/:id`. As `BrandsService.update` — renames and/or
   * activates, only the provided fields change — plus the FR-011 guard: the
   * system "Other" row can be neither renamed nor deactivated. Rejecting it
   * here, rather than only hiding the controls, is what makes the rule
   * structural.
   */
  async update(
    companyId: string,
    id: string,
    input: UpdateReasonInput,
  ): Promise<ReasonListItem> {
    const tx = await this.scopeToCaller(companyId);

    const existing = await tx.reasonMessage.findFirst({
      where: { id },
      select: { id: true, isSystem: true },
    });

    if (!existing) {
      throw new AppError('NOT_FOUND', 'Reason not found.');
    }

    if (existing.isSystem) {
      throw new AppError(
        'SYSTEM_REASON_IMMUTABLE',
        'The "Other" reason is always last and always available — it cannot be renamed or deactivated.',
      );
    }

    if (input.label !== undefined) {
      const clash = await tx.reasonMessage.findFirst({
        where: {
          label: { equals: input.label, mode: 'insensitive' },
          id: { not: id },
        },
        select: { id: true },
      });

      if (clash) {
        throw new AppError(
          'DUPLICATE_REASON_LABEL',
          'A reason with this label already exists.',
        );
      }
    }

    return tx.reasonMessage.update({
      where: { id },
      data: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      select: this.rowSelect,
    });
  }
}
