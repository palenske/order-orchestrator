import { Test, TestingModule } from '@nestjs/testing';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';

describe('OrderController', () => {
  let controller: OrderController;
  let service: OrderService;

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
    const mockService = {
      getOrders: jest.fn().mockResolvedValue(mockOrders),
      getOrderById: jest.fn().mockResolvedValue(mockOrders[0]),
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [OrderController],
      providers: [{ provide: OrderService, useValue: mockService }],
    }).compile();

    controller = app.get<OrderController>(OrderController);
    service = app.get<OrderService>(OrderService);
  });

  describe('getOrders', () => {
    it('should return all orders without filter', async () => {
      const result = await controller.getOrders();
      expect(result).toEqual(mockOrders);
      expect(service.getOrders).toHaveBeenCalledWith(undefined);
    });

    it('should return orders filtered by status', async () => {
      await controller.getOrders('RECEIVED');
      expect(service.getOrders).toHaveBeenCalledWith('RECEIVED');
    });
  });

  describe('getOrderById', () => {
    it('should return order by id', async () => {
      const result = await controller.getOrderById('order-1');
      expect(result).toEqual(mockOrders[0]);
      expect(service.getOrderById).toHaveBeenCalledWith('order-1');
    });

    it('should throw NotFoundException when order not found', async () => {
      jest.spyOn(service, 'getOrderById').mockResolvedValue(null);
      await expect(controller.getOrderById('invalid-id')).rejects.toThrow();
    });
  });
});
