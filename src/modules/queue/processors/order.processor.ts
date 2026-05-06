import { Processor } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { OrderRepository } from '../../order/repositories/order.repository';
import { EnrichmentService } from '../services/enrichment.service';
import { OrderStatus } from '@prisma/client';

export interface OrderJobData {
  orderId: string;
}

@Processor('orders')
export class OrderProcessor {
  private readonly logger = new Logger(OrderProcessor.name);

  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly enrichmentService: EnrichmentService,
  ) {}

  async handleEnrichOrder(job: Job<OrderJobData>) {
    const { orderId } = job.data;
    this.logger.log(`Processing order: ${orderId}`);

    await this.orderRepository.updateStatus(orderId, OrderStatus.PROCESSING);

    const order = await this.orderRepository.findById(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    const enrichedData = await this.enrichmentService.enrich(order);

    const totalAmount = (order as any).items.reduce(
      (sum: number, item: any) => sum + item.quantity * item.unitPrice,
      0,
    );

    await this.orderRepository.updateStatus(orderId, OrderStatus.ENRICHED, {
      totalAmount,
      enrichedData: enrichedData as any,
      processedAt: new Date(),
    });

    this.logger.log(`Order enriched: ${orderId}`);
    return { orderId, enrichedData };
  }

  async onCompleted(job: Job) {
    this.logger.log(`Job completed: ${job.id}`);
  }

  async onFailed(job: Job, error: Error) {
    const { orderId } = job.data as OrderJobData;
    this.logger.error(`Order failed: ${orderId}`);

    await this.orderRepository.createFailure(orderId, error.message);
    await this.orderRepository.updateStatus(
      orderId,
      OrderStatus.FAILED_ENRICHMENT,
    );
  }
}
