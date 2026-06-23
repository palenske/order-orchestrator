import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OrderRepository } from '../order/repositories/order.repository';
import { CreateOrderWebhookDto } from './dto/create-order-webhook.dto';
import type { OrderWithRelations } from '../order/repositories/order.repository';
import { DEFAULT_JOB_OPTIONS } from '../queue/queue.constants';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly orderRepository: OrderRepository,
    @InjectQueue('orders') private readonly ordersQueue: Queue,
  ) {}

  async receiveOrderWebhook(dto: CreateOrderWebhookDto) {
    this.logger.log(`Webhook: ${dto.order_id}`);

    const existingOrder = await this.orderRepository.findByIdempotencyKey(
      dto.idempotency_key,
    );
    if (existingOrder) {
      throw new ConflictException('Order already processed');
    }

    let order: OrderWithRelations;
    try {
      order = await this.orderRepository.create({
        externalId: dto.order_id,
        idempotencyKey: dto.idempotency_key,
        currency: dto.currency,
        customer: dto.customer
          ? {
              email: dto.customer.email,
              name: dto.customer.name,
              cep: dto.customer.cep,
            }
          : undefined,
        items: dto.items.map((item) => ({
          sku: item.sku,
          quantity: item.qty,
          unitPrice: item.unit_price,
        })),
      });
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: string }).code === 'P2002'
      ) {
        throw new ConflictException('Order already processed');
      }
      throw error;
    }

    await this.ordersQueue.add(
      'enrich-order',
      { orderId: order.id },
      DEFAULT_JOB_OPTIONS,
    );

    this.logger.log(`Order enqueued: ${order.id}`);

    return {
      success: true,
      order_id: order.id,
      external_order_id: order.externalId,
      idempotency_key: order.idempotencyKey,
      status: order.status,
    };
  }
}
