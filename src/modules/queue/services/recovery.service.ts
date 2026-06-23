import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OrderRepository } from '../../order/repositories/order.repository';
import { OrderStatus } from '@prisma/client';
import { DEFAULT_JOB_OPTIONS } from '../queue.constants';

@Injectable()
export class RecoveryService {
  private readonly logger = new Logger(RecoveryService.name);

  constructor(
    private readonly orderRepository: OrderRepository,
    @InjectQueue('orders') private readonly ordersQueue: Queue,
  ) {}

  async recoverStuckOrders(): Promise<number> {
    const stuckOrders = await this.orderRepository.findAll({
      status: OrderStatus.RECEIVED,
    });

    if (stuckOrders.length === 0) {
      this.logger.log('No stuck orders found');
      return 0;
    }

    this.logger.warn(
      `Found ${stuckOrders.length} stuck order(s) with RECEIVED status, re-enqueueing`,
    );

    let recovered = 0;
    for (const order of stuckOrders) {
      try {
        await this.ordersQueue.add(
          'enrich-order',
          { orderId: order.id },
          DEFAULT_JOB_OPTIONS,
        );
        recovered++;
      } catch (error) {
        this.logger.error(
          `Failed to re-enqueue stuck order ${order.id}: ${error}`,
        );
      }
    }

    this.logger.log(`Re-enqueued ${recovered} stuck order(s)`);
    return recovered;
  }
}
