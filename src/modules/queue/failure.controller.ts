import { Controller, Get, Post, Param, Query, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OrderRepository } from '../order/repositories/order.repository';
import { OrderStatus } from '@prisma/client';

@Controller('admin/failures')
export class FailureController {
  constructor(
    private readonly orderRepository: OrderRepository,
    @InjectQueue('orders') private readonly ordersQueue: Queue,
  ) {}

  @Get()
  getFailures(@Query('unresolved') unresolved?: string) {
    const onlyUnresolved = unresolved === 'true';
    return this.orderRepository.findFailures(onlyUnresolved);
  }

  @Post(':id/resolve')
  async resolveFailure(@Param('id') id: string) {
    await this.orderRepository.resolveFailure(id);
    return { success: true };
  }

  @Post(':id/reprocess')
  async reprocessFailure(@Param('id') id: string) {
    const orderId = id;
    await this.orderRepository.updateStatus(orderId, OrderStatus.RECEIVED);
    await this.ordersQueue.add(
      'enrich-order',
      { orderId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      },
    );
    return { success: true, message: `Order ${orderId} re-enqueued` };
  }
}
