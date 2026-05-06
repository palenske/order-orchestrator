import { Test, TestingModule } from '@nestjs/testing';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { OrderRepository } from '../order/repositories/order.repository';
import { ConflictException } from '@nestjs/common';
import { Queue } from 'bullmq';

describe('WebhookController', () => {
  let controller: WebhookController;
  let service: WebhookService;
  let repository: OrderRepository;

  const mockDto = {
    order_id: 'ext-123',
    customer: { email: 'user@example.com', name: 'Ana' },
    items: [{ sku: 'ABC123', qty: 2, unit_price: 59.9 }],
    currency: 'USD',
    idempotency_key: 'uuid-123',
  };

  const mockCreatedOrder = {
    id: 'order-1',
    externalId: 'ext-123',
    idempotencyKey: 'uuid-123',
    status: 'RECEIVED',
    currency: 'USD',
  };

  let mockRepo: any;
  let mockQueue: any;

  beforeEach(async () => {
    mockRepo = {
      findByIdempotencyKey: jest.fn(),
      create: jest.fn(),
    };

    mockQueue = {
      add: jest.fn().mockResolvedValue({}),
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        WebhookService,
        { provide: OrderRepository, useValue: mockRepo },
        { provide: 'BullQueue_orders', useValue: mockQueue },
      ],
    }).compile();

    controller = app.get<WebhookController>(WebhookController);
    service = app.get<WebhookService>(WebhookService);
    repository = app.get<OrderRepository>(OrderRepository);
  });

  describe('receiveOrderWebhook', () => {
    it('should create order and return success', async () => {
      mockRepo.findByIdempotencyKey.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue(mockCreatedOrder as any);

      const result = await service.receiveOrderWebhook(mockDto);

      expect(mockRepo.findByIdempotencyKey).toHaveBeenCalledWith('uuid-123');
      expect(mockRepo.create).toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        order_id: 'ext-123',
        idempotency_key: 'uuid-123',
        status: 'RECEIVED',
      });
    });

    it('should throw ConflictException for duplicate idempotency_key', async () => {
      mockRepo.findByIdempotencyKey.mockResolvedValue({ id: 'existing' });

      await expect(service.receiveOrderWebhook(mockDto)).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException for invalid payload - missing order_id', async () => {
      const invalidDto = { ...mockDto, order_id: '' };
      await expect(service.receiveOrderWebhook(invalidDto)).rejects.toThrow();
    });

    it('should throw BadRequestException for invalid payload - empty items', async () => {
      const invalidDto = { ...mockDto, items: [] };
      await expect(service.receiveOrderWebhook(invalidDto)).rejects.toThrow();
    });
  });
});