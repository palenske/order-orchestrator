import {
  Processor,
  WorkerHost,
  InjectQueue,
  OnWorkerEvent,
} from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { OrderRepository } from '../../order/repositories/order.repository';
import { FailureRepository } from '../../order/repositories/failure.repository';
import { EnrichmentService } from '../services/enrichment.service';
import { MetricsService } from '../../../infrastructure/metrics/metrics.service';
import { OrderStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';

type JsonValue = Prisma.InputJsonValue;

export interface OrderJobData {
  orderId: string;
}

@Processor('orders')
export class OrderProcessor extends WorkerHost {
  private readonly logger = new Logger(OrderProcessor.name);

  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly failureRepository: FailureRepository,
    private readonly enrichmentService: EnrichmentService,
    @InjectQueue('orders-dlq') private readonly dlqQueue: Queue,
    private readonly metricsService: MetricsService,
  ) {
    super();
  }

  async process(job: Job<OrderJobData>) {
    return this.handleEnrichOrder(job);
  }

  async handleEnrichOrder(job: Job<OrderJobData>) {
    const { orderId } = job.data;
    this.logger.log(`Processing order: ${orderId}`);

    const order = await this.orderRepository.findById(orderId);
    if (!order) {
      this.logger.warn(`Order not found, skipping: ${orderId}`);
      return { orderId, skipped: true };
    }

    await this.orderRepository.updateStatus(orderId, OrderStatus.PROCESSING);

    const enrichedData = await this.enrichmentService.enrich(order);

    await this.orderRepository.updateStatus(orderId, OrderStatus.ENRICHED, {
      totalAmount: enrichedData.convertedTotal,
      conversionRate: enrichedData.exchangeRate,
      enrichedData: enrichedData as unknown as JsonValue,
      processedAt: new Date(),
    });

    await this.orderRepository.updateStatus(orderId, OrderStatus.COMPLETED);

    this.logger.log(`Order completed: ${orderId}`);
    this.metricsService.queueJobsProcessedTotal.inc({
      queue: 'orders',
      outcome: 'completed',
    });
    return { orderId, enrichedData };
  }

  @OnWorkerEvent('failed')
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

    const order = await this.orderRepository.findById(orderId);
    if (!order) {
      this.logger.warn(`Order not found in onFailed, skipping: ${orderId}`);
      return;
    }

    await this.dlqQueue.add('dead-letter', {
      orderId,
      error: error.message,
      originalJobId: job.id,
      failedAt: new Date().toISOString(),
    });

    this.metricsService.queueJobsProcessedTotal.inc({
      queue: 'orders',
      outcome: 'failed',
    });

    await this.failureRepository.create(orderId, error.message);
    await this.orderRepository.updateStatus(
      orderId,
      OrderStatus.FAILED_ENRICHMENT,
    );
  }
}
