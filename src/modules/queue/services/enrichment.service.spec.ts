import { Test, TestingModule } from '@nestjs/testing';
import { EnrichmentService } from './enrichment.service';
import { OrderStatus } from '@prisma/client';

describe('EnrichmentService', () => {
  let service: EnrichmentService;

  const mockOrder = {
    id: 'order-1',
    externalId: 'ext-1',
    idempotencyKey: 'key-1',
    status: OrderStatus.RECEIVED,
    currency: 'EUR',
    items: [
      { id: 'item-1', sku: 'SKU1', quantity: 2, unitPrice: 50, orderId: 'order-1' },
    ],
  } as any;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      providers: [EnrichmentService],
    }).compile();

    service = app.get<EnrichmentService>(EnrichmentService);
  });

  describe('enrich', () => {
    it('should return enriched data with exchange rate and IP info', async () => {
      const result = await service.enrich(mockOrder);

      expect(result).toBeDefined();
      expect(result.exchangeRate).toBeDefined();
      expect(result.convertedTotal).toBeDefined();
      expect(result.rateSource).toBe('ExchangeRate-API');
      expect(result.timestamp).toBeDefined();
    });

    it('should calculate correct total amount', async () => {
      const result = await service.enrich(mockOrder);
      expect(result.convertedTotal).toBeCloseTo(100 * result.exchangeRate);
    });
  });
});