import { Injectable } from '@nestjs/common';
import { OrderRepository } from './repositories/order.repository';
import type { OrderWithRelations } from './repositories/order.repository';
import type { OrderStatus } from '@prisma/client';

@Injectable()
export class OrderService {
  constructor(private readonly orderRepository: OrderRepository) {}

  async getOrders(
    status?: OrderStatus,
    skip?: number,
    take?: number,
  ): Promise<OrderWithRelations[]> {
    return this.orderRepository.findAll({ status, skip, take });
  }

  async getOrderById(id: string): Promise<OrderWithRelations | null> {
    return this.orderRepository.findById(id);
  }
}
