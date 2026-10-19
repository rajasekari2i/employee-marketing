import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { AppError, type CapturePinInput } from '@field-sales/shared';

import type { TransactionClsStore } from '../../common/interceptors/transaction.interceptor';

const prisma = new PrismaClient();

type ShopPinTx = Pick<
  PrismaClient,
  'shop' | 'assignmentStop' | 'companySettings' | '$executeRaw'
>;

export interface CapturePinResult {
  shopId: string;
  pinStatus: 'APPROVED' | 'PENDING_VERIFICATION';
  canRecordOutcome: boolean;
}

/**
 * Backs `POST /shops/:id/pin` — an executive's FIRST capture of a shop's
 * location (board 1.8, contracts/visits.md).
 *
 * Lives in the visits module rather than shops because it is the executive's
 * field flow: it shares this module's executive scoping and, critically, it
 * writes the coordinate snapshot onto today's stop that the visit
 * measurement depends on. The Company Admin's own pin setting stays in the
 * shops module and is unaffected.
 */
@Injectable()
export class ShopPinService {
  constructor(private readonly cls: ClsService<TransactionClsStore>) {}

  private tx(): ShopPinTx {
    const store = this.cls.get();
    return (store?.tx as ShopPinTx | undefined) ?? prisma;
  }

  private async scopeToCaller(companyId: string): Promise<ShopPinTx> {
    const tx = this.tx();
    await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
    this.cls.set('companyId', companyId);
    return tx;
  }

  async capturePin(
    companyId: string,
    executiveId: string,
    shopId: string,
    input: CapturePinInput,
  ): Promise<CapturePinResult> {
    const tx = await this.scopeToCaller(companyId);

    const shop = await tx.shop.findFirst({
      where: { id: shopId },
      select: { id: true, locationStatus: true },
    });

    if (!shop) {
      throw new AppError('NOT_FOUND', 'Shop not found.');
    }

    // An executive can never MOVE a saved pin (FR-034) — they raise a
    // correction request for a manager to decide. Only a first capture is
    // allowed here.
    if (shop.locationStatus === 'APPROVED') {
      throw new AppError(
        'PIN_ALREADY_SET',
        "This shop's location is already saved. Raise a correction request to change it.",
      );
    }

    const settings = await tx.companySettings.findUnique({
      where: { companyId },
      select: { maxAccuracyMeters: true, autoApproveExecPins: true },
    });
    const maxAccuracy = settings?.maxAccuracyMeters ?? 20;

    // **The one place in this product where accuracy BLOCKS rather than
    // merely flags.** Everywhere else a poor reading is recorded and routed
    // for review; here it is refused, because a bad pin becomes the fixed
    // point every future visit at this shop is measured against — one sloppy
    // capture would silently corrupt every later distance.
    if (input.accuracyMeters > maxAccuracy) {
      throw new AppError(
        'PIN_ACCURACY_TOO_LOW',
        `Accuracy must be ${maxAccuracy} m or better to save a pin.`,
      );
    }

    const autoApprove = settings?.autoApproveExecPins ?? false;
    const pinStatus = autoApprove ? 'APPROVED' : 'PENDING_VERIFICATION';
    const latitude = new Prisma.Decimal(input.latitude);
    const longitude = new Prisma.Decimal(input.longitude);

    await tx.shop.update({
      where: { id: shopId },
      data: {
        latitude,
        longitude,
        locationAccuracyMeters: input.accuracyMeters,
        locationSource: input.source,
        locationStatus: pinStatus,
        locationCapturedAt: new Date(input.capturedAt),
        locationCapturedBy: executiveId,
      },
    });

    // Freeze the coordinate onto this executive's stops for this shop that
    // have not yet been completed (research.md §4). Without this the stop
    // keeps the null it was created with and the visit would be refused for
    // a missing pin even after the capture succeeded.
    //
    // Only done when the pin is immediately usable: a pending pin must not
    // let an outcome through.
    if (pinStatus === 'APPROVED') {
      await tx.assignmentStop.updateMany({
        where: { shopId, status: 'PENDING' },
        data: { shopLatitude: latitude, shopLongitude: longitude },
      });
    }

    return {
      shopId,
      pinStatus,
      canRecordOutcome: pinStatus === 'APPROVED',
    };
  }
}
