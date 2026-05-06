import { Test, TestingModule } from '@nestjs/testing';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';

const mockOrderService = {
  getOrders: jest.fn(),
};

const mockResult = [{ id: '1', status: 'pending' }];

describe('OrderController', () => {
  let orderController: OrderController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [OrderController],
      providers: [
        {
          provide: OrderService,
          useValue: mockOrderService,
        },
      ],
    }).compile();

    orderController = app.get<OrderController>(OrderController);
  });

  describe('getOrders', () => {
    it('should return an empty array', () => {
      mockOrderService.getOrders.mockReturnValue([]);
      expect(orderController.getOrders()).toEqual([]);
    });

    it('should return an array with orders', () => {
      mockOrderService.getOrders.mockReturnValue(mockResult);
      expect(orderController.getOrders()).toEqual(mockResult);
    });
  });
});
