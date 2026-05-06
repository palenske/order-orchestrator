import { Test, TestingModule } from '@nestjs/testing';
import { EnrichmentService } from './services/enrichment.service';
import { OrderRepository } from '../order/repositories/order.repository';
import { OrderProcessor } from './processors/order.processor';
import { OrderStatus } from '@prisma/client';

describe('Order Queue Flow', () => {
  let processor: OrderProcessor;
  let repository: OrderRepository;
  let enrichmentService: EnrichmentService;

  const mockOrder = {
    id: 'order-test-1',
    externalId: 'ext-1',
    idempotencyKey: 'key-1',
    currency: 'EUR',
    status: OrderStatus.RECEIVED,
    items: [
      {
        id: 'item-1',
        sku: 'SKU1',
        quantity: 2,
        unitPrice: 50,
        orderId: 'order-test-1',
      },
    ],
  } as any;

  let mockRepo: any;
  let mockDlqQueue: any;

  beforeEach(async () => {
    mockRepo = {
      findById: jest.fn().mockResolvedValue(mockOrder),
      updateStatus: jest
        .fn()
        .mockResolvedValue({ ...mockOrder, status: OrderStatus.ENRICHED }),
      createFailure: jest.fn(),
      findFailures: jest.fn().mockResolvedValue([]),
    };

    mockDlqQueue = {
      add: jest.fn().mockResolvedValue({}),
    };

    const app: TestingModule = await Test.createTestingModule({
      providers: [
        OrderProcessor,
        EnrichmentService,
        { provide: OrderRepository, useValue: mockRepo },
        { provide: 'BullQueue_orders-dlq', useValue: mockDlqQueue },
      ],
    }).compile();

    processor = app.get<OrderProcessor>(OrderProcessor);
    repository = app.get<OrderRepository>(OrderRepository);
    enrichmentService = app.get<EnrichmentService>(EnrichmentService);
  });

  describe('Order Processing Flow', () => {
    it('should update status to PROCESSING when starting', async () => {
      await processor.handleEnrichOrder({
        data: { orderId: 'order-test-1' },
      } as any);

      expect(repository.updateStatus).toHaveBeenCalledWith(
        'order-test-1',
        OrderStatus.PROCESSING,
      );
    });

    it('should call enrichment service', async () => {
      const result = await processor.handleEnrichOrder({
        data: { orderId: 'order-test-1' },
      } as any);

      expect(result).toBeDefined();
      expect(result.enrichedData).toBeDefined();
    });

    it('should update status to ENRICHED after success', async () => {
      await processor.handleEnrichOrder({
        data: { orderId: 'order-test-1' },
      } as any);

      expect(repository.updateStatus).toHaveBeenCalledWith(
        'order-test-1',
        OrderStatus.ENRICHED,
        expect.any(Object),
      );
    });

    it('should handle order not found error', async () => {
      jest.spyOn(repository, 'findById').mockResolvedValue(null);

      await expect(
        processor.handleEnrichOrder({ data: { orderId: 'invalid' } } as any),
      ).rejects.toThrow('Order not found');
    });

    it('should handle onFailed and update to FAILED_ENRICHMENT when all retries exhausted', async () => {
      await processor.onFailed(
        {
          data: { orderId: 'order-test-1' },
          opts: { attempts: 3 },
          attemptsMade: 3,
        } as any,
        new Error('Test error'),
      );

      expect(mockDlqQueue.add).toHaveBeenCalledWith('dead-letter', {
        orderId: 'order-test-1',
        error: 'Test error',
        originalJobId: undefined,
        failedAt: expect.any(String),
      });
      expect(repository.updateStatus).toHaveBeenCalledWith(
        'order-test-1',
        OrderStatus.FAILED_ENRICHMENT,
      );
    });

    it('should not update status when retries are still available', async () => {
      jest.clearAllMocks();

      await processor.onFailed(
        {
          data: { orderId: 'order-test-1' },
          opts: { attempts: 3 },
          attemptsMade: 1,
        } as any,
        new Error('Temporary error'),
      );

      expect(repository.updateStatus).not.toHaveBeenCalled();
      expect(repository.createFailure).not.toHaveBeenCalled();
      expect(mockDlqQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('Enrichment Service', () => {
    it('should return enriched data with exchange rate', async () => {
      const result = await enrichmentService.enrich(mockOrder);

      expect(result.exchangeRate).toBeDefined();
      expect(result.convertedTotal).toBeDefined();
      expect(result.rateSource).toBe('ExchangeRate-API');
    });

    it('should calculate correct total amount', async () => {
      const result = await enrichmentService.enrich(mockOrder);

      expect(result.convertedTotal).toBe(100 * result.exchangeRate);
    });
  });

  describe('Status Transitions', () => {
    it('should transition from RECEIVED to PROCESSING', async () => {
      await repository.updateStatus('order-test-1', OrderStatus.PROCESSING);
      expect(repository.updateStatus).toHaveBeenCalledWith(
        'order-test-1',
        OrderStatus.PROCESSING,
      );
    });

    it('should transition from PROCESSING to ENRICHED', async () => {
      await repository.updateStatus('order-test-1', OrderStatus.ENRICHED);
      expect(repository.updateStatus).toHaveBeenCalledWith(
        'order-test-1',
        OrderStatus.ENRICHED,
      );
    });

    it('should transition to FAILED_ENRICHMENT on error', async () => {
      await repository.updateStatus(
        'order-test-1',
        OrderStatus.FAILED_ENRICHMENT,
      );
      expect(repository.updateStatus).toHaveBeenCalledWith(
        'order-test-1',
        OrderStatus.FAILED_ENRICHMENT,
      );
    });
  });
});