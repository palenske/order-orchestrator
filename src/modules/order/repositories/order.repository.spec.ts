import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../database/prisma.service';
import { OrderRepository } from './order.repository';
import { OrderStatus } from '@prisma/client';

describe('OrderRepository', () => {
  let repository: OrderRepository;
  let prisma: PrismaService;

  const mockOrder = {
    id: 'order-1',
    externalId: 'ext-1',
    idempotencyKey: 'key-1',
    status: OrderStatus.RECEIVED,
    currency: 'USD',
    totalAmount: null,
    conversionRate: null,
    enrichedData: null,
    customerId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    processedAt: null,
  };

  beforeEach(async () => {
    const mockPrisma = {
      order: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      customer: {
        create: jest.fn(),
      },
      orderItem: {
        create: jest.fn(),
      },
    };

    const app: TestingModule = await Test.createTestingModule({
      providers: [
        OrderRepository,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    repository = app.get<OrderRepository>(OrderRepository);
    prisma = app.get<PrismaService>(PrismaService);
  });

  describe('findById', () => {
    it('should return order by id', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      const result = await repository.findById('order-1');
      expect(result).toEqual(mockOrder);
    });

    it('should return null when not found', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);
      const result = await repository.findById('invalid');
      expect(result).toBeNull();
    });
  });

  describe('findByIdempotencyKey', () => {
    it('should return order by idempotencyKey', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      const result = await repository.findByIdempotencyKey('key-1');
      expect(result).toEqual(mockOrder);
    });
  });

  describe('findAll', () => {
    it('should return all orders without filter', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([mockOrder]);
      const result = await repository.findAll();
      expect(result).toHaveLength(1);
    });

    it('should return orders with status filter', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([mockOrder]);
      await repository.findAll({ status: OrderStatus.RECEIVED });
      expect(prisma.order.findMany).toHaveBeenCalledWith({
        where: { status: OrderStatus.RECEIVED },
        skip: 0,
        take: 50,
        orderBy: { createdAt: 'desc' },
        include: { customer: true, items: true },
      });
    });
  });

  describe('create', () => {
    it('should create order with customer and items', async () => {
      (prisma.order.create as jest.Mock).mockResolvedValue({
        ...mockOrder,
        customer: { id: 'cust-1', email: 'test@test.com', name: 'Test' },
        items: [{ id: 'item-1', sku: 'SKU1', quantity: 1, unitPrice: 10 }],
      });

      const result = await repository.create({
        externalId: 'ext-1',
        idempotencyKey: 'key-1',
        currency: 'USD',
        customer: { email: 'test@test.com', name: 'Test' },
        items: [{ sku: 'SKU1', quantity: 1, unitPrice: 10 }],
      });

      expect(result).toBeDefined();
      expect(prisma.order.create).toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('should update order status', async () => {
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.ENRICHED,
      });

      const result = await repository.updateStatus(
        'order-1',
        OrderStatus.ENRICHED,
      );
      expect(result.status).toBe(OrderStatus.ENRICHED);
    });
  });
});
