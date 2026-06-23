import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import type { Prisma } from '@prisma/client';
import { OrderStatus } from '@prisma/client';

type JsonValue = Prisma.InputJsonValue;

export type OrderWithRelations = Prisma.OrderGetPayload<{
  include: { items: true; customer: true };
}>;

@Injectable()
export class OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<OrderWithRelations | null> {
    return this.prisma.order.findUnique({
      where: { id },
      include: {
        customer: true,
        items: true,
      },
    });
  }

  async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<OrderWithRelations | null> {
    return this.prisma.order.findUnique({
      where: { idempotencyKey },
      include: {
        customer: true,
        items: true,
      },
    });
  }

  async findAll(params?: {
    status?: OrderStatus;
    skip?: number;
    take?: number;
  }): Promise<OrderWithRelations[]> {
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
    customer?: {
      email: string;
      name: string;
      cep?: string;
      externalId?: string;
    };
    items: { sku: string; quantity: number; unitPrice: number }[];
  }): Promise<OrderWithRelations> {
    const { customer, items, ...orderData } = data;

    return this.prisma.order.create({
      data: {
        ...orderData,
        customer: customer
          ? {
              create: {
                email: customer.email,
                name: customer.name,
                cep: customer.cep,
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
  ): Promise<OrderWithRelations> {
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
}
