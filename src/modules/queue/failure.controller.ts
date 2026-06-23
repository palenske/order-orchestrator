import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OrderRepository } from '../order/repositories/order.repository';
import { FailureRepository } from '../order/repositories/failure.repository';
import { OrderStatus } from '@prisma/client';
import { DEFAULT_JOB_OPTIONS } from './queue.constants';

@Controller('admin/failures')
export class FailureController {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly failureRepository: FailureRepository,
    @InjectQueue('orders') private readonly ordersQueue: Queue,
  ) {}

  @Get()
  getFailures(@Query('unresolved') unresolved?: string) {
    return this.failureRepository.findAll(
      unresolved === undefined ? undefined : unresolved === 'true',
    );
  }

  @Post(':id/resolve')
  async resolveFailure(@Param('id') id: string) {
    const failure = await this.failureRepository.findById(id);
    if (!failure) {
      throw new NotFoundException('Failure not found');
    }
    await this.failureRepository.resolve(id);
    return { success: true };
  }

  @Post(':id/reprocess')
  async reprocessFailure(@Param('id') id: string) {
    const failure = await this.failureRepository.findById(id);
    if (!failure) {
      throw new NotFoundException('Failure not found');
    }

    const orderId = failure.orderId;
    await this.orderRepository.updateStatus(orderId, OrderStatus.RECEIVED);
    await this.ordersQueue.add(
      'enrich-order',
      { orderId },
      DEFAULT_JOB_OPTIONS,
    );
    await this.failureRepository.resolve(id);
    return { success: true, message: `Order ${orderId} re-enqueued` };
  }
}
