import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { AppError, type ManagerVisitsQuery } from '@field-sales/shared';

import type { TransactionClsStore } from '../../common/interceptors/transaction.interceptor';
import { CompanyClock } from '../../infra/time/company-clock.service';

const prisma = new PrismaClient();

type ManagerVisitsTx = Pick<PrismaClient, 'visit' | '$executeRaw'>;

/**
 * One row of board 3.3.
 *
 * **`distanceMeters` and `isExceedRange` are REQUIRED here** — board 3.3's
 * distance column, its "· out" marker and its Out-of-range tab have no other
 * source. Slice 008's `my-visits.service.ts` lists both as FORBIDDEN by
 * name, for the executive's version of this same list.
 *
 * That is not a contradiction, it is the point: a manager may see what an
 * executive may not (FR-046), and the executive's rule must stay unbroken
 * (FR-047). The two are kept apart **structurally** — two services, two
 * shapes, in two files. **This file and `my-visits.service.ts` must never be
 * merged, parameterised or refactored into one**: a single shape with a
 * role-conditional projection would put the product's most load-bearing
 * privacy rule inside an `if`, in the one service where both roles meet.
 */
export interface ManagerVisitRow {
  id: string;
  businessDate: string;
  outcome: 'ORDER' | 'NO_ORDER';
  shopName: string;
  executiveName: string;
  occurredAt: Date;
  summary: string;
  /** null for a no-order — drives board 3.3's chip. */
  deliveryStatus: 'TO_DELIVER' | 'DELIVERED' | null;
  distanceMeters: number;
  isExceedRange: boolean;
}

export interface ManagerVisitsResult {
  items: ManagerVisitRow[];
  counts?: { all: number; order: number; noOrder: number; outOfRange: number };
  nextCursor: string | null;
}

export interface ManagerVisitDetail {
  id: string;
  outcome: 'ORDER' | 'NO_ORDER';
  shopName: string;
  executiveName: string;
  beatPlanName: string | null;
  businessDate: string;
  occurredAt: Date;
  sampleShown: boolean;
  order: {
    /**
     * `POST /orders/:id/deliver` is addressed by the ORDER, while this route
     * is addressed by the visit — and an order is reachable only through its
     * visit (`Order.visitId` is unique). So the id travels here, rather than
     * leaving the client to guess it from the visit id, which it is not.
     */
    orderId: string;
    lines: Array<{ brandLabel: string; quantity: number }>;
    totalQuantity: number;
    deliveryStatus: 'TO_DELIVER' | 'DELIVERED';
    deliveredAt: Date | null;
    deliveredByName: string | null;
  } | null;
  noOrder: {
    reasonLabel: string | null;
    lastFiveReasons: Array<{
      businessDate: string;
      reasonLabel: string | null;
      executiveName: string;
    }>;
  } | null;
  measurement: {
    distanceMeters: number;
    isExceedRange: boolean;
    effectiveRadiusMeters: number;
    accuracyMeters: number;
    flags: string[];
    submittedAt: Date;
  };
  location: {
    shopLatitude: number | null;
    shopLongitude: number | null;
    capturedLatitude: number;
    capturedLongitude: number;
  };
}

/**
 * Backs `GET /visits` and `GET /visits/:id` — boards 3.3 to 3.6
 * (010-manager-app). Paths taken verbatim from `03-ARCHITECTURE.md:829-831`.
 *
 * **Company-scoped, with no executive narrowing** — a manager reviews every
 * executive (FR-050). Unlike `my-visits.service.ts` beside it, that absence
 * is correct rather than missing.
 */
@Injectable()
export class ManagerVisitsService {
  constructor(
    private readonly cls: ClsService<TransactionClsStore>,
    private readonly clock: CompanyClock,
  ) {}

  private tx(): ManagerVisitsTx {
    const store = this.cls.get();
    return (store?.tx as ManagerVisitsTx | undefined) ?? prisma;
  }

  private async scopeToCaller(companyId: string): Promise<ManagerVisitsTx> {
    const tx = this.tx();
    await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
    this.cls.set('companyId', companyId);
    return tx;
  }

  async list(
    companyId: string,
    query: ManagerVisitsQuery,
  ): Promise<ManagerVisitsResult> {
    const tx = await this.scopeToCaller(companyId);
    const where = this.buildWhere(query);

    const rows = await tx.visit.findMany({
      where,
      take: query.limit,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
      // The same day-major ordering the executive's list uses. It matters
      // less here (no day headings) but one ordering rule in the product is
      // better than two, and `id` last makes it TOTAL — which a keyset
      // cursor needs to be correct.
      orderBy: [
        { businessDate: 'desc' },
        { submittedAt: 'desc' },
        { id: 'desc' },
      ],
      select: this.rowSelect,
    });

    return {
      items: rows.map((row) => this.toRow(row)),
      ...(query.cursor ? {} : { counts: await this.counts(tx, query) }),
      nextCursor:
        rows.length === query.limit
          ? (rows[rows.length - 1]?.id ?? null)
          : null,
    };
  }

  /**
   * The four tab counts, for the current filters **minus the tab itself**.
   *
   * `outcome` and `outOfRange` are dropped here because the tabs need to
   * know how many the *other* tabs hold — the same rule slice 008
   * established for the executive's list.
   */
  private async counts(
    tx: ManagerVisitsTx,
    query: ManagerVisitsQuery,
  ): Promise<{
    all: number;
    order: number;
    noOrder: number;
    outOfRange: number;
  }> {
    const base = this.buildWhere({
      ...query,
      outcome: undefined,
      outOfRange: undefined,
    });

    const [grouped, outOfRange] = await Promise.all([
      tx.visit.groupBy({
        by: ['outcome'],
        where: base,
        _count: { _all: true },
      }),
      tx.visit.count({ where: { ...base, isExceedRange: true } }),
    ]);

    const order = grouped.find((g) => g.outcome === 'ORDER')?._count._all ?? 0;
    const noOrder =
      grouped.find((g) => g.outcome === 'NO_ORDER')?._count._all ?? 0;

    return { all: order + noOrder, order, noOrder, outOfRange };
  }

  /**
   * **`outcome` and `outOfRange` are applied independently**, because
   * exceeding the radius is a property of the measurement rather than a
   * third kind of outcome — which is why the Out-of-range tab holds both
   * orders and no-orders (research.md §4).
   */
  private buildWhere(query: ManagerVisitsQuery): Prisma.VisitWhereInput {
    return {
      ...(query.date
        ? { businessDate: this.clock.toDateColumn(query.date) }
        : {}),
      ...(query.outcome ? { outcome: query.outcome } : {}),
      ...(query.outOfRange ? { isExceedRange: true } : {}),
      ...(query.executiveId ? { executiveId: query.executiveId } : {}),
      // Reaches Visit -> AssignmentStop -> DailyAssignment.beatPlanId. It
      // goes through `stop` because `Visit` carries `assignmentId` as a
      // scalar and declares no relation on it. No index serves this walk
      // directly; recorded rather than pre-optimised, since the driving
      // filter is always the company and usually a date.
      ...(query.beatPlanId
        ? { stop: { assignment: { beatPlanId: query.beatPlanId } } }
        : {}),
    };
  }

  /**
   * One shape for **all three** detail boards (3.4, 3.5, 3.6).
   *
   * The client picks the screen; the server cannot. The same out-of-range
   * order shows board 3.6 from the Out-of-range tab and board 3.4 — with
   * Mark as delivered — from the Order tab (FR-029). So this returns what
   * all three need, rather than taking a mode parameter a caller could get
   * wrong.
   */
  async detail(
    companyId: string,
    visitId: string,
  ): Promise<ManagerVisitDetail> {
    const tx = await this.scopeToCaller(companyId);

    const visit = await tx.visit.findFirst({
      where: { id: visitId },
      select: {
        id: true,
        outcome: true,
        businessDate: true,
        submittedAt: true,
        sampleShown: true,
        reasonLabel: true,
        shopId: true,
        distanceMeters: true,
        isExceedRange: true,
        effectiveRadiusMeters: true,
        accuracyMeters: true,
        flags: true,
        // Frozen on the VISIT, never the shop's current row (FR-030).
        shopLatitude: true,
        shopLongitude: true,
        capturedLatitude: true,
        capturedLongitude: true,
        shop: { select: { name: true } },
        executive: { select: { name: true } },
        // Via the stop: `Visit.assignmentId` is a scalar with no relation.
        stop: { select: { assignment: { select: { beatPlanName: true } } } },
        order: {
          select: {
            id: true,
            totalQuantity: true,
            deliveryStatus: true,
            deliveredAt: true,
            deliveredBy: true,
            lines: { select: { brandLabel: true, quantity: true } },
          },
        },
      },
    });

    if (!visit) {
      // Never a 403 — that would confirm the row exists.
      throw new AppError('NOT_FOUND', 'Visit not found.');
    }

    let deliveredByName: string | null = null;
    if (visit.order?.deliveredBy) {
      const marker = await prisma.user.findUnique({
        where: { id: visit.order.deliveredBy },
        select: { name: true },
      });
      deliveredByName = marker?.name ?? null;
    }

    const noOrder =
      visit.outcome === 'NO_ORDER'
        ? {
            reasonLabel: visit.reasonLabel,
            lastFiveReasons: await this.lastFiveReasons(
              tx,
              visit.shopId,
              visit.id,
            ),
          }
        : null;

    return {
      id: visit.id,
      outcome: visit.outcome,
      shopName: visit.shop.name,
      executiveName: visit.executive.name,
      beatPlanName: visit.stop.assignment.beatPlanName,
      businessDate: this.toDateString(visit.businessDate),
      occurredAt: visit.submittedAt,
      sampleShown: visit.sampleShown,
      order: visit.order
        ? {
            orderId: visit.order.id,
            lines: visit.order.lines,
            totalQuantity: visit.order.totalQuantity,
            deliveryStatus: visit.order.deliveryStatus,
            deliveredAt: visit.order.deliveredAt,
            deliveredByName,
          }
        : null,
      noOrder,
      measurement: {
        distanceMeters: visit.distanceMeters,
        isExceedRange: visit.isExceedRange,
        effectiveRadiusMeters: visit.effectiveRadiusMeters,
        accuracyMeters: visit.accuracyMeters,
        flags: visit.flags,
        submittedAt: visit.submittedAt,
      },
      location: {
        shopLatitude:
          visit.shopLatitude === null ? null : Number(visit.shopLatitude),
        shopLongitude:
          visit.shopLongitude === null ? null : Number(visit.shopLongitude),
        capturedLatitude: Number(visit.capturedLatitude),
        capturedLongitude: Number(visit.capturedLongitude),
      },
    };
  }

  /**
   * That **shop's** last five no-order visits **by anyone**, newest first
   * (FR-026) — excluding the one being viewed, so board 3.5's history is
   * five *other* occasions rather than four plus itself.
   */
  private async lastFiveReasons(
    tx: ManagerVisitsTx,
    shopId: string,
    excludeVisitId: string,
  ) {
    const rows = await tx.visit.findMany({
      where: { shopId, outcome: 'NO_ORDER', id: { not: excludeVisitId } },
      orderBy: [{ businessDate: 'desc' }, { submittedAt: 'desc' }],
      take: 5,
      select: {
        businessDate: true,
        reasonLabel: true,
        executive: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      businessDate: this.toDateString(r.businessDate),
      reasonLabel: r.reasonLabel,
      executiveName: r.executive.name,
    }));
  }

  private toRow(row: {
    id: string;
    businessDate: Date;
    outcome: 'ORDER' | 'NO_ORDER';
    submittedAt: Date;
    reasonLabel: string | null;
    distanceMeters: number;
    isExceedRange: boolean;
    shop: { name: string };
    executive: { name: string };
    order: {
      brandCount: number;
      totalQuantity: number;
      deliveryStatus: 'TO_DELIVER' | 'DELIVERED';
    } | null;
  }): ManagerVisitRow {
    return {
      id: row.id,
      businessDate: this.toDateString(row.businessDate),
      outcome: row.outcome,
      shopName: row.shop.name,
      executiveName: row.executive.name,
      occurredAt: row.submittedAt,
      summary:
        row.outcome === 'ORDER'
          ? `${row.order?.brandCount ?? 0} brand${(row.order?.brandCount ?? 0) === 1 ? '' : 's'} · ${row.order?.totalQuantity ?? 0} qty`
          : (row.reasonLabel ?? 'No order'),
      deliveryStatus: row.order?.deliveryStatus ?? null,
      distanceMeters: row.distanceMeters,
      isExceedRange: row.isExceedRange,
    };
  }

  private toDateString(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private readonly rowSelect = {
    id: true,
    businessDate: true,
    outcome: true,
    submittedAt: true,
    reasonLabel: true,
    // The two an executive may never see (FR-046 / FR-047).
    distanceMeters: true,
    isExceedRange: true,
    shop: { select: { name: true } },
    executive: { select: { name: true } },
    order: {
      select: {
        brandCount: true,
        totalQuantity: true,
        deliveryStatus: true,
      },
    },
  } as const;
}
