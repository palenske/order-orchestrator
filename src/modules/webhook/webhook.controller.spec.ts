import { Test, TestingModule } from '@nestjs/testing';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { WebhookSignatureGuard } from './guards/webhook-signature.guard';
import { OrderRepository } from '../order/repositories/order.repository';
import { ConflictException } from '@nestjs/common';

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
        WebhookSignatureGuard,
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

      const result = await service.receiveOrderWebhook(mockDto as any);

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

      await expect(service.receiveOrderWebhook(mockDto as any)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw ConflictException on unique constraint violation (P2002)', async () => {
      mockRepo.findByIdempotencyKey.mockResolvedValue(null);
      mockRepo.create.mockRejectedValue({
        code: 'P2002',
        meta: { target: ['idempotencyKey'] },
      });

      await expect(service.receiveOrderWebhook(mockDto as any)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('WebhookSignatureGuard', () => {
    it('should skip verification when WEBHOOK_SECRET is not configured', () => {
      const originalSecret = process.env.WEBHOOK_SECRET;
      delete process.env.WEBHOOK_SECRET;

      const guard = new WebhookSignatureGuard();
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({ headers: {}, body: {} }),
        }),
      } as any;

      const result = guard.canActivate(mockContext);
      expect(result).toBe(true);

      process.env.WEBHOOK_SECRET = originalSecret;
    });

    it('should reject request without signature when WEBHOOK_SECRET is set', () => {
      const originalSecret = process.env.WEBHOOK_SECRET;
      process.env.WEBHOOK_SECRET = 'test-secret';

      const guard = new WebhookSignatureGuard();
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({ headers: {}, body: {} }),
        }),
      } as any;

      expect(() => guard.canActivate(mockContext)).toThrow(
        'Missing webhook signature',
      );

      process.env.WEBHOOK_SECRET = originalSecret;
    });

    it('should reject request with invalid signature', () => {
      const originalSecret = process.env.WEBHOOK_SECRET;
      process.env.WEBHOOK_SECRET = 'test-secret';

      const guard = new WebhookSignatureGuard();
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            headers: { 'x-webhook-signature': 'invalid' },
            body: { order_id: 'test' },
          }),
        }),
      } as any;

      expect(() => guard.canActivate(mockContext)).toThrow(
        'Invalid webhook signature',
      );

      process.env.WEBHOOK_SECRET = originalSecret;
    });

    it('should accept request with valid signature', () => {
      const originalSecret = process.env.WEBHOOK_SECRET;
      process.env.WEBHOOK_SECRET = 'test-secret';
      const crypto = require('crypto');
      const body = JSON.stringify({ order_id: 'test' });
      const validSignature = crypto
        .createHmac('sha256', 'test-secret')
        .update(body)
        .digest('hex');

      const guard = new WebhookSignatureGuard();
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            headers: { 'x-webhook-signature': validSignature },
            body: { order_id: 'test' },
          }),
        }),
      } as any;

      const result = guard.canActivate(mockContext);
      expect(result).toBe(true);

      process.env.WEBHOOK_SECRET = originalSecret;
    });
  });
});
