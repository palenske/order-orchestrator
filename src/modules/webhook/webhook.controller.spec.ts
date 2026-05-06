import { Test, TestingModule } from '@nestjs/testing';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { CreateOrderWebhookDto } from './dto/create-order-webhook.dto';

describe('WebhookController', () => {
  let webhookController: WebhookController;

  const mockDto: CreateOrderWebhookDto = {
    order_id: 'ext-123',
    customer: { email: 'user@example.com', name: 'Ana' },
    items: [{ sku: 'ABC123', qty: 2, unit_price: 59.9 }],
    currency: 'USD',
    idempotency_key: 'uuid-123',
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [WebhookService],
    }).compile();

    webhookController = app.get<WebhookController>(WebhookController);
  });

  describe('receiveOrderWebhook', () => {
    it('should return success with order_id', () => {
      const result = webhookController.receiveOrderWebhook(mockDto);
      expect(result).toEqual({
        success: true,
        order_id: 'ext-123',
        idempotency_key: 'uuid-123',
      });
    });
  });
});