import { Test, TestingModule } from '@nestjs/testing';
import { EnrichmentService } from './services/enrichment.service';
import { OrderRepository } from '../order/repositories/order.repository';
import { OrderProcessor } from './processors/order.processor';
import { MetricsService } from '../../infrastructure/metrics/metrics.service';
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
    customer: null,
    totalAmount: null,
    conversionRate: null,
    enrichedData: null,
    customerId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    processedAt: null,
  } as any;

  let mockRepo: any;
  let mockDlqQueue: any;
  let mockMetricsService: any;
  let fetchSpy: jest.SpiedFunction<typeof globalThis.fetch>;

  beforeEach(async () => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('exchangerate-api')) {
        return new Response(
          JSON.stringify({ base_code: 'EUR', rates: { USD: 1.1 } }),
          { status: 200 },
        );
      }
      if (urlStr.includes('ip-api')) {
        return new Response(
          JSON.stringify({
            status: 'success',
            query: '1.2.3.4',
            country: 'US',
            city: 'New York',
            isp: 'TestISP',
          }),
          { status: 200 },
        );
      }
      if (urlStr.includes('fakestoreapi')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });

    mockRepo = {
      findById: jest.fn().mockResolvedValue(mockOrder),
      updateStatus: jest
        .fn()
        .mockResolvedValue({ ...mockOrder, status: OrderStatus.COMPLETED }),
      createFailure: jest.fn(),
      findFailures: jest.fn().mockResolvedValue([]),
    };

    mockDlqQueue = {
      add: jest.fn().mockResolvedValue({}),
    };

    mockMetricsService = {
      queueJobsProcessedTotal: { inc: jest.fn() } as any,
      externalApiRequestDurationSeconds: { labels: jest.fn().mockReturnValue({ observe: jest.fn() }) } as any,
    };

    const app: TestingModule = await Test.createTestingModule({
      providers: [
        OrderProcessor,
        EnrichmentService,
        { provide: OrderRepository, useValue: mockRepo },
        { provide: 'BullQueue_orders-dlq', useValue: mockDlqQueue },
        { provide: MetricsService, useValue: mockMetricsService },
      ],
    }).compile();

    processor = app.get<OrderProcessor>(OrderProcessor);
    repository = app.get<OrderRepository>(OrderRepository);
    enrichmentService = app.get<EnrichmentService>(EnrichmentService);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
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

    it('should update status to ENRICHED then COMPLETED after success', async () => {
      await processor.handleEnrichOrder({
        data: { orderId: 'order-test-1' },
      } as any);

      expect(repository.updateStatus).toHaveBeenCalledWith(
        'order-test-1',
        OrderStatus.ENRICHED,
        expect.any(Object),
      );
      expect(repository.updateStatus).toHaveBeenCalledWith(
        'order-test-1',
        OrderStatus.COMPLETED,
      );
    });

    it('should handle order not found gracefully', async () => {
      jest.spyOn(repository, 'findById').mockResolvedValue(null);

      const result = await processor.handleEnrichOrder({ data: { orderId: 'invalid' } } as any);
      expect(result).toEqual({ orderId: 'invalid', skipped: true });
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

      expect(result.exchangeRate).toBe(1.1);
      expect(result.convertedTotal).toBe(110);
      expect(result.rateSource).toBe('ExchangeRate-API');
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

    it('should transition from ENRICHED to COMPLETED', async () => {
      await repository.updateStatus('order-test-1', OrderStatus.COMPLETED);
      expect(repository.updateStatus).toHaveBeenCalledWith(
        'order-test-1',
        OrderStatus.COMPLETED,
      );
    });
  });
});