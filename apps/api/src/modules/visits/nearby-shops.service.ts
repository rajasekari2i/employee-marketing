import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { AppError, type NearbyShopsQuery } from '@field-sales/shared';

import type { TransactionClsStore } from '../../common/interceptors/transaction.interceptor';
import { haversineMetres } from './haversine';

const prisma = new PrismaClient();

type NearbyShopsTx = Pick<
  PrismaClient,
  'shop' | 'dailyAssignment' | 'assignmentStop' | '$executeRaw'
>;

/**
 * One row of board 1.4's picker.
 *
 * **This shape is deliberately NOT `ShopListItem`** (data-model.md, *Entity:
 * the shop choice*). The following never appear here, and a later
 * contributor should see the boundary rather than infer it:
 *
 *   * `latitude`, `longitude` — the device must never hold a shop
 *     coordinate. `ShopsService.toListItem` returns these and is documented
 *     "Returned to the Company Admin only"; that is the precise reason this
 *     projection exists instead of reusing it.
 *   * `verificationRadiusMeters`, and the company's `defaultRadiusMeters` —
 *     with a coordinate and a radius the device could compute its own range
 *     verdict, which is the inference `assignments.service.ts` drops both
 *     fields at its response boundary to prevent.
 *   * `geohash`, `locationCapturedBy`, `locationVerifiedBy`,
 *     `locationCapturedAt`, `locationVerifiedAt` — not needed by the board,
 *     and the last four name people and times an executive has no business
 *     seeing in a picker.
 *   * Anything from `Visit` — no measured distance, no range verdict, no
 *     flag, no review status (FR-021).
 *
 * The `distanceMeters` below is a DIFFERENT quantity from a visit's measured
 * distance and the two must not converge: this one is measured from where
 * the executive is *now*, to a shop **not** on today's route, rounded for
 * display, and decides nothing (research.md §3).
 */
export interface ShopChoice {
  id: string;
  name: string;
  addressLine: string | null;
  pinStatus: 'NONE' | 'PENDING_VERIFICATION' | 'APPROVED';
  /** `null` renders as the board's "No beat" chip. */
  beatPlanName: string | null;
  /** `null` when the shop has no approved pin, or the device sent no position. */
  distanceMeters: number | null;
  /** `"90 m"` / `"1.2 km"` — formatted here, never on the device. */
  distanceLabel: string | null;
}

export interface NearbyShopsResult {
  items: ShopChoice[];
  /** `false` → the list is name-ordered and the screen hides distances. */
  positionUsed: boolean;
}

/**
 * The window around the executive for the unsearched "nearby" list. Applied
 * only to shops that HAVE approved coordinates — see {@link list}.
 */
const NEARBY_RADIUS_KM = 5;

/** Degrees of latitude per kilometre, as `03-ARCHITECTURE.md:776-787` writes it. */
const KM_PER_DEGREE = 111.32;

/**
 * The architecture's hard cap for this query (§8). Candidates are narrowed in
 * SQL, then ranked in Node — one distance implementation, not two.
 */
const CANDIDATE_CAP = 200;

/**
 * Backs `GET /shops/nearby` — the source for board 1.4's picker
 * (007-extra-shops, contracts/extra-shops.md).
 *
 * Lives in the visits module rather than the admin-only shops module for the
 * same reason `POST /shops/:id/pin` does: it is the executive's field flow,
 * not the noun in its path (research.md §1).
 *
 * Company scoping is not enough here. Every read additionally narrows to the
 * caller's own JWT-verified `executiveId`, so one executive can never use
 * another's day as the exclusion set.
 */
@Injectable()
export class NearbyShopsService {
  constructor(private readonly cls: ClsService<TransactionClsStore>) {}

  private tx(): NearbyShopsTx {
    const store = this.cls.get();
    return (store?.tx as NearbyShopsTx | undefined) ?? prisma;
  }

  private async scopeToCaller(companyId: string): Promise<NearbyShopsTx> {
    const tx = this.tx();
    await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
    this.cls.set('companyId', companyId);
    return tx;
  }

  /**
   * Two stages (research.md §2, Architecture D-13). SQL narrows the candidate
   * set and applies the exclusions; the existing `haversineMetres` ranks what
   * comes back. PostGIS is a documented later upgrade (ADR-0007, T-04), not a
   * shortcut being taken here.
   */
  async list(
    companyId: string,
    executiveId: string,
    query: NearbyShopsQuery,
  ): Promise<NearbyShopsResult> {
    const tx = await this.scopeToCaller(companyId);

    // The exclusion set must be the caller's OWN day. An id that is unknown,
    // another company's or another executive's is a 404 alike — the response
    // never reveals which.
    const assignment = await tx.dailyAssignment.findFirst({
      where: { id: query.excludeAssignment, executiveId },
      select: { id: true },
    });
    if (!assignment) {
      throw new AppError('NOT_FOUND', 'Beat day not found.');
    }

    // FR-EXTRA-08. This is also what stops the picker being used to
    // range-find a stop the executive is about to visit (research.md §3), so
    // it survives search rather than being a convenience of the unsearched
    // list.
    const onToday = await tx.assignmentStop.findMany({
      where: { assignmentId: assignment.id },
      select: { shopId: true },
    });
    const excludedShopIds = onToday.map((stop) => stop.shopId);

    const hasPosition = query.lat !== undefined && query.lng !== undefined;

    const rows = await tx.shop.findMany({
      where: {
        isActive: true,
        ...(excludedShopIds.length > 0
          ? { id: { notIn: excludedShopIds } }
          : {}),
        ...(query.search
          ? {
              // FR-006 must find a shop WHEREVER it is, so a search term
              // lifts the bounding box entirely — a shop 30 km away is still
              // addable. Matches the same three columns `ShopsService.list`
              // already does, case-insensitive.
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { shopCode: { contains: query.search, mode: 'insensitive' } },
                { ownerName: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : hasPosition
            ? { OR: this.boundingBox(query.lat!, query.lng!) }
            : {}),
      },
      select: {
        id: true,
        name: true,
        addressLine1: true,
        city: true,
        latitude: true,
        longitude: true,
        locationStatus: true,
        beatPlanShops: {
          select: { beatPlan: { select: { name: true, isActive: true } } },
        },
      },
      take: CANDIDATE_CAP,
    });

    const items = rows
      .map((row) => this.toChoice(row, hasPosition ? query : null))
      .sort(this.byNearestThenName)
      .slice(0, query.limit);

    return { items, positionUsed: hasPosition };
  }

  /**
   * The architecture's window — `lat ± (radiusKm / 111.32)`,
   * `lng ± (radiusKm / (111.32 * cos(lat)))`.
   *
   * **A deliberate departure from the documented SQL** (research.md §2,
   * departure 1): the documented `latitude BETWEEN … AND longitude BETWEEN …`
   * silently drops every row with NULL coordinates, which would remove
   * exactly the pin-less shops board 1.4 draws with a "No pin — capture on
   * arrival" chip, and which FR-005 requires. So the box is applied ONLY to
   * rows that have an approved pin; a shop without one is never filtered out
   * by a geometry it does not have. It simply has no distance and sorts
   * after the ones that do.
   */
  private boundingBox(lat: number, lng: number): Prisma.ShopWhereInput[] {
    const latDelta = NEARBY_RADIUS_KM / KM_PER_DEGREE;
    const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
    const lngDelta = NEARBY_RADIUS_KM / (KM_PER_DEGREE * cosLat);

    return [
      { locationStatus: { not: 'APPROVED' } },
      { latitude: null },
      { longitude: null },
      {
        AND: [
          { latitude: { gte: lat - latDelta, lte: lat + latDelta } },
          { longitude: { gte: lng - lngDelta, lte: lng + lngDelta } },
        ],
      },
    ];
  }

  private toChoice(
    row: {
      id: string;
      name: string;
      addressLine1: string | null;
      city: string | null;
      latitude: Prisma.Decimal | null;
      longitude: Prisma.Decimal | null;
      locationStatus: string;
      beatPlanShops: Array<{ beatPlan: { name: string; isActive: boolean } }>;
    },
    position: { lat?: number; lng?: number } | null,
  ): ShopChoice {
    const pinStatus = row.locationStatus as ShopChoice['pinStatus'];

    // Only an APPROVED pin is a coordinate worth measuring to — a pending one
    // is not yet the shop's location, and data-model.md says the distance is
    // null in that case.
    const measurable =
      pinStatus === 'APPROVED' &&
      row.latitude !== null &&
      row.longitude !== null;

    const distanceMeters =
      position && measurable
        ? Math.round(
            haversineMetres(
              position.lat!,
              position.lng!,
              Number(row.latitude),
              Number(row.longitude),
            ),
          )
        : null;

    return {
      id: row.id,
      name: row.name,
      addressLine: this.addressLine(row),
      pinStatus,
      beatPlanName:
        row.beatPlanShops.find((link) => link.beatPlan.isActive)?.beatPlan
          .name ?? null,
      distanceMeters,
      distanceLabel:
        distanceMeters === null ? null : this.distanceLabel(distanceMeters),
    };
  }

  /** The same `addressLine1` + `city` join the assignment view uses. */
  private addressLine(shop: {
    addressLine1: string | null;
    city: string | null;
  }): string | null {
    const parts = [shop.addressLine1, shop.city].filter(
      (part): part is string => Boolean(part),
    );
    return parts.length > 0 ? parts.join(', ') : null;
  }

  /**
   * The two forms board 1.4 shows and nothing in between (research.md §10):
   * metres below 1000, kilometres with one decimal at or above.
   *
   * Formatted HERE, not on the device, so the "one distance implementation"
   * rule holds in spirit as well as letter — the device neither computes nor
   * interprets a distance, it renders a string. The raw number travels
   * alongside so the client can sort stably without re-deriving anything.
   */
  private distanceLabel(metres: number): string {
    if (metres < 1000) {
      return `${metres} m`;
    }
    return `${(metres / 1000).toFixed(1)} km`;
  }

  /**
   * 1. Shops with approved coordinates, nearest first.
   * 2. Shops without, by name.
   *
   * With no position every shop falls to rule 2 and `positionUsed` is false.
   * FR-004's ordering is a convenience — refusing the screen because a GPS
   * fix was slow would be the worse failure.
   */
  private byNearestThenName = (a: ShopChoice, b: ShopChoice): number => {
    if (a.distanceMeters !== null && b.distanceMeters !== null) {
      return a.distanceMeters - b.distanceMeters;
    }
    if (a.distanceMeters !== null) {
      return -1;
    }
    if (b.distanceMeters !== null) {
      return 1;
    }
    return a.name.localeCompare(b.name);
  };
}
