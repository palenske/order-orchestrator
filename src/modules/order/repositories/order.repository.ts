import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import type { Prisma, Order } from '@prisma/client';
import { OrderStatus } from '@prisma/client';

type JsonValue = Prisma.InputJsonValue;

@Injectable()
export class OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Order | null> {
    return this.prisma.order.findUnique({
      where: { id },
      include: {
        customer: true,
        items: true,
      },
    });
  }

  async findByExternalId(externalId: string): Promise<Order | null> {
    return this.prisma.order.findUnique({
      where: { externalId },
      include: {
        customer: true,
        items: true,
      },
    });
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<Order | null> {
    return this.prisma.order.findUnique({
      where: { idempotencyKey },
    });
  }

  async findAll(params?: {
    status?: OrderStatus;
    skip?: number;
    take?: number;
  }): Promise<Order[]> {
    const { status, skip = 0, take = 50 } = params || {};
    return this.prisma.order.findMany({
      where: status ? { status } : undefined,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: true,
        items: true,
      },
    });
  }

  async create(data: {
    externalId: string;
    idempotencyKey: string;
    currency: string;
    customer?: { email: string; name: string; externalId?: string };
    items: { sku: string; quantity: number; unitPrice: number }[];
  }): Promise<Order> {
    const { customer, items, ...orderData } = data;

    return this.prisma.order.create({
      data: {
        ...orderData,
        customer: customer
          ? {
              create: {
                email: customer.email,
                name: customer.name,
                externalId: customer.externalId,
              },
            }
          : undefined,
        items: {
          create: items,
        },
      },
      include: {
        customer: true,
        items: true,
      },
    });
  }

  async updateStatus(
    id: string,
    status: OrderStatus,
    data?: {
      totalAmount?: number;
      conversionRate?: number;
      enrichedData?: JsonValue;
      processedAt?: Date;
    },
  ): Promise<Order> {
    return this.prisma.order.update({
      where: { id },
      data: {
        status,
        ...data,
        updatedAt: new Date(),
      },
      include: {
        customer: true,
        items: true,
      },
    });
  }

  async count(params?: { status?: OrderStatus }): Promise<number> {
    const { status } = params || {};
    return this.prisma.order.count({
      where: status ? { status } : undefined,
    });
  }

  async createFailure(orderId: string, error: string): Promise<any> {
    return this.prisma.orderFailure.create({
      data: {
        orderId,
        error,
        attempts: 1,
      },
    });
  }

  async incrementFailureAttempts(id: string): Promise<any> {
    return this.prisma.orderFailure.update({
      where: { id },
      data: {
        attempts: { increment: 1 },
        lastAttempt: new Date(),
      },
    });
  }

  async findFailures(unresolved?: boolean): Promise<any[]> {
    return this.prisma.orderFailure.findMany({
      where: unresolved !== undefined ? { resolved: !unresolved } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  async resolveFailure(id: string): Promise<any> {
    return this.prisma.orderFailure.update({
      where: { id },
      data: { resolved: true, resolvedAt: new Date() },
    });
  }
}
