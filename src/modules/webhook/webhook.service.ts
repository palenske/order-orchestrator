import { Injectable, Logger, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OrderRepository } from '../order/repositories/order.repository';
import type { CreateOrderWebhookDto } from './dto/create-order-webhook.dto';
import { OrderStatus } from '@prisma/client';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly orderRepository: OrderRepository,
    @InjectQueue('orders') private readonly ordersQueue: Queue,
  ) {}

  async receiveOrderWebhook(dto: CreateOrderWebhookDto) {
    this.logger.log(`Webhook: ${dto.order_id}`);
    this.validatePayload(dto);

    const existingOrder = await this.orderRepository.findByIdempotencyKey(dto.idempotency_key);
    if (existingOrder) {
      throw new ConflictException('Order already processed');
    }

    const order = await this.orderRepository.create({
      externalId: dto.order_id,
      idempotencyKey: dto.idempotency_key,
      currency: dto.currency,
      customer: dto.customer
        ? { email: dto.customer.email, name: dto.customer.name }
        : undefined,
      items: dto.items.map((item) => ({
        sku: item.sku,
        quantity: item.qty,
        unitPrice: item.unit_price,
      })),
    });

    await this.ordersQueue.add('enrich-order', { orderId: order.id }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    });

    this.logger.log(`Order enqueued: ${order.id}`);

    return {
      success: true,
      order_id: order.externalId,
      idempotency_key: order.idempotencyKey,
      status: order.status,
    };
  }

  private validatePayload(dto: CreateOrderWebhookDto) {
    if (!dto.order_id || typeof dto.order_id !== 'string') {
      throw new BadRequestException('Invalid order_id');
    }
    if (!dto.idempotency_key || typeof dto.idempotency_key !== 'string') {
      throw new BadRequestException('Invalid idempotency_key');
    }
    if (!dto.currency || typeof dto.currency !== 'string') {
      throw new BadRequestException('Invalid currency');
    }
    if (!dto.customer || !dto.customer.email || !dto.customer.name) {
      throw new BadRequestException('Invalid customer');
    }
    if (!dto.items || !Array.isArray(dto.items) || dto.items.length === 0) {
      throw new BadRequestException('Invalid items');
    }
    for (const item of dto.items) {
      if (!item.sku || typeof item.sku !== 'string') {
        throw new BadRequestException('Invalid item sku');
      }
      if (!item.qty || typeof item.qty !== 'number' || item.qty < 1) {
        throw new BadRequestException('Invalid item qty');
      }
      if (
        typeof item.unit_price !== 'number' ||
        item.unit_price <= 0
      ) {
        throw new BadRequestException('Invalid item unit_price');
      }
    }
  }
}