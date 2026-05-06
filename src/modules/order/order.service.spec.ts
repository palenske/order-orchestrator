import { Test, TestingModule } from '@nestjs/testing';
import { OrderService } from './order.service';
import { OrderRepository } from './repositories/order.repository';

describe('OrderService', () => {
  let service: OrderService;
  let repository: OrderRepository;

  const mockOrders = [
    {
      id: 'order-1',
      externalId: 'ext-1',
      idempotencyKey: 'key-1',
      status: 'RECEIVED' as const,
      currency: 'USD',
      totalAmount: null,
      conversionRate: null,
      enrichedData: null,
      customerId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      processedAt: null,
      customer: null,
      items: [],
    },
  ];

  beforeEach(async () => {
    const mockRepository = {
      findAll: jest.fn(),
      findById: jest.fn(),
    };

    const app: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: OrderRepository, useValue: mockRepository },
      ],
    }).compile();

    service = app.get<OrderService>(OrderService);
    repository = app.get<OrderRepository>(OrderRepository);
  });

  describe('getOrders', () => {
    it('should return orders without filter', async () => {
      jest.spyOn(repository, 'findAll').mockResolvedValue(mockOrders);
      const result = await service.getOrders();
      expect(result).toEqual(mockOrders);
      expect(repository.findAll).toHaveBeenCalledWith({});
    });

    it('should return orders with status filter', async () => {
      jest.spyOn(repository, 'findAll').mockResolvedValue([mockOrders[0]]);
      await service.getOrders('RECEIVED');
      expect(repository.findAll).toHaveBeenCalledWith({ status: 'RECEIVED' });
    });
  });

  describe('getOrderById', () => {
    it('should return order by id', async () => {
      jest.spyOn(repository, 'findById').mockResolvedValue(mockOrders[0]);
      const result = await service.getOrderById('order-1');
      expect(result).toEqual(mockOrders[0]);
      expect(repository.findById).toHaveBeenCalledWith('order-1');
    });

    it('should return null for non-existent order', async () => {
      jest.spyOn(repository, 'findById').mockResolvedValue(null);
      const result = await service.getOrderById('invalid');
      expect(result).toBeNull();
    });
  });
});
