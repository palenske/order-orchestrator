import { Injectable } from '@nestjs/common';
import { OrderRepository } from './repositories/order.repository';
import type { Order, OrderStatus } from '@prisma/client';

@Injectable()
export class OrderService {
  constructor(private readonly orderRepository: OrderRepository) {}

  async getOrders(status?: OrderStatus): Promise<Order[]> {
    return this.orderRepository.findAll({ status });
  }

  async getOrderById(id: string): Promise<Order | null> {
    return this.orderRepository.findById(id);
  }
}