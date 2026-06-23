import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import type { OrderFailure } from '@prisma/client';

@Injectable()
export class FailureRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<OrderFailure | null> {
    return this.prisma.orderFailure.findUnique({ where: { id } });
  }

  async create(orderId: string, error: string): Promise<OrderFailure> {
    return this.prisma.orderFailure.create({
      data: { orderId, error, attempts: 1 },
    });
  }

  async findAll(unresolved?: boolean): Promise<OrderFailure[]> {
    return this.prisma.orderFailure.findMany({
      where: unresolved !== undefined ? { resolved: !unresolved } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  async resolve(id: string): Promise<OrderFailure> {
    return this.prisma.orderFailure.update({
      where: { id },
      data: { resolved: true, resolvedAt: new Date() },
    });
  }
}
