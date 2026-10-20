import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { AppError } from '@field-sales/shared';

import type { TransactionClsStore } from '../../common/interceptors/transaction.interceptor';

const prisma = new PrismaClient();

type OrderDeliveryTx = Pick<PrismaClient, 'order' | 'user' | '$executeRaw'>;

export interface MarkDeliveredResult {
  orderId: string;
  deliveryStatus: 'DELIVERED';
  deliveredAt: Date;
  deliveredByName: string | null;
}

/**
 * Backs `POST /orders/:id/deliver` — board 3.4's action (010-manager-app).
 * Path taken verbatim from `03-ARCHITECTURE.md:833`.
 *
 * **Delivery is one-way.** There is no un-deliver route, by decision: an
 * order that was delivered stays delivered, and a mistake is a conversation
 * rather than a silent reversal.
 */
@Injectable()
export class OrderDeliveryService {
  constructor(private readonly cls: ClsService<TransactionClsStore>) {}

  private tx(): OrderDeliveryTx {
    const store = this.cls.get();
    return (store?.tx as OrderDeliveryTx | undefined) ?? prisma;
  }

  private async scopeToCaller(companyId: string): Promise<OrderDeliveryTx> {
    const tx = this.tx();
    await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
    this.cls.set('companyId', companyId);
    return tx;
  }

  async markDelivered(
    companyId: string,
    managerId: string,
    orderId: string,
  ): Promise<MarkDeliveredResult> {
    const tx = await this.scopeToCaller(companyId);

    const order = await tx.order.findFirst({
      where: { id: orderId },
      select: { id: true, deliveryStatus: true },
    });

    if (!order) {
      // Unknown, or another company's — one 404 either way, so the response
      // cannot be used to probe for other companies' orders.
      throw new AppError('NOT_FOUND', 'Order not found.');
    }

    if (order.deliveryStatus === 'DELIVERED') {
      // A REFUSAL, not a silent success. Reporting success would tell this
      // manager they marked something another manager actually marked, and
      // would overwrite the attribution these columns exist to keep
      // (FR-024, SC-008).
      throw new AppError(
        'ORDER_ALREADY_DELIVERED',
        'This order has already been marked delivered.',
      );
    }

    const deliveredAt = new Date();
    await tx.order.update({
      where: { id: orderId },
      data: {
        deliveryStatus: 'DELIVERED',
        // The SERVER's clock and the JWT's user — neither is accepted from
        // the body, which is `z.object({}).strict()`.
        deliveredAt,
        deliveredBy: managerId,
      },
    });

    const marker = await tx.user.findUnique({
      where: { id: managerId },
      select: { name: true },
    });

    return {
      orderId,
      deliveryStatus: 'DELIVERED',
      deliveredAt,
      deliveredByName: marker?.name ?? null,
    };
  }
}
