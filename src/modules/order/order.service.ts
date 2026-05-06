import { Injectable, Logger } from '@nestjs/common';
import { OrderRepository } from './repositories/order.repository';
import type { Order, OrderStatus } from '@prisma/client';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(private readonly orderRepository: OrderRepository) {}

  async getOrders(status?: OrderStatus): Promise<Order[]> {
    const orders = await this.orderRepository.findAll({ status });
    this.logger.log(`Orders: ${orders.length}`);
    return orders;
  }

  async getOrderById(id: string): Promise<Order | null> {
    return this.orderRepository.findById(id);
  }
}
