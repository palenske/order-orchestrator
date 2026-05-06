import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { OrderRepository } from '../../order/repositories/order.repository';
import { EnrichmentService } from '../services/enrichment.service';
import { OrderStatus } from '@prisma/client';

export interface OrderJobData {
  orderId: string;
}

@Processor('orders')
export class OrderProcessor extends WorkerHost {
  private readonly logger = new Logger(OrderProcessor.name);

  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly enrichmentService: EnrichmentService,
    @InjectQueue('orders-dlq') private readonly dlqQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<OrderJobData>) {
    return this.handleEnrichOrder(job);
  }

  async handleEnrichOrder(job: Job<OrderJobData>) {
    const { orderId } = job.data;
    this.logger.log(`Processing order: ${orderId}`);

    await this.orderRepository.updateStatus(orderId, OrderStatus.PROCESSING);

    const order = await this.orderRepository.findById(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    const enrichedData = await this.enrichmentService.enrich(order);

    const items = (order as any).items ?? [];
    const totalAmount = items.reduce(
      (sum: number, item: any) => sum + item.quantity * item.unitPrice,
      0,
    );

    await this.orderRepository.updateStatus(orderId, OrderStatus.ENRICHED, {
      totalAmount,
      conversionRate: enrichedData.exchangeRate,
      enrichedData: enrichedData as any,
      processedAt: new Date(),
    });

    this.logger.log(`Order enriched: ${orderId}`);
    return { orderId, enrichedData };
  }

  async onFailed(job: Job<OrderJobData>, error: Error) {
    const maxAttempts = job.opts.attempts ?? 1;

    if (job.attemptsMade < maxAttempts) {
      this.logger.warn(
        `Attempt ${job.attemptsMade}/${maxAttempts} failed for order ${job.data.orderId}: ${error.message}`,
      );
      return;
    }

    const { orderId } = job.data;
    this.logger.error(
      `Order failed after ${maxAttempts} attempts: ${orderId}`,
      error.stack,
    );

    await this.dlqQueue.add('dead-letter', {
      orderId,
      error: error.message,
      originalJobId: job.id,
      failedAt: new Date().toISOString(),
    });

    await this.orderRepository.createFailure(orderId, error.message);
    await this.orderRepository.updateStatus(
      orderId,
      OrderStatus.FAILED_ENRICHMENT,
    );
  }
}
