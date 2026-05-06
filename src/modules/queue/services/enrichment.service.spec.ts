import { Test, TestingModule } from '@nestjs/testing';
import { EnrichmentService } from './enrichment.service';

describe('EnrichmentService', () => {
  let service: EnrichmentService;

  const mockOrder = {
    id: 'order-1',
    externalId: 'ext-1',
    idempotencyKey: 'key-1',
    currency: 'EUR',
    items: [
      {
        id: 'item-1',
        sku: 'SKU1',
        quantity: 2,
        unitPrice: 50,
        orderId: 'order-1',
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

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      providers: [EnrichmentService],
    }).compile();

    service = app.get<EnrichmentService>(EnrichmentService);
  });

  describe('enrich', () => {
    let fetchSpy: jest.SpiedFunction<typeof globalThis.fetch>;

    beforeEach(() => {
      fetchSpy = jest.spyOn(globalThis, 'fetch');
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('should return enriched data with exchange rate', async () => {
      fetchSpy.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes('exchangerate-api')) {
          return new Response(
            JSON.stringify({
              base_code: 'EUR',
              rates: { USD: 1.1 },
            }),
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

      const result = await service.enrich(mockOrder);

      expect(result.exchangeRate).toBe(1.1);
      expect(result.convertedTotal).toBe(110);
      expect(result.originalTotal).toBe(100);
      expect(result.rateSource).toBe('ExchangeRate-API');
      expect(result.ipInfo).toBeDefined();
      expect(result.ipInfo?.ip).toBe('1.2.3.4');
      expect(result.productsInfo).toBeDefined();
      expect(result.productsInfo?.validated).toBe(true);
    });

    it('should throw when exchange rate API fails', async () => {
      fetchSpy.mockResolvedValue(new Response(null, { status: 500 }));

      await expect(service.enrich(mockOrder)).rejects.toThrow(
        'Exchange rate API returned status 500',
      );
    });

    it('should continue without ipInfo and productsInfo when they fail', async () => {
      fetchSpy.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes('exchangerate-api')) {
          return new Response(
            JSON.stringify({ base_code: 'EUR', rates: { USD: 1.1 } }),
            { status: 200 },
          );
        }
        if (urlStr.includes('ip-api')) {
          throw new Error('IP API down');
        }
        if (urlStr.includes('fakestoreapi')) {
          throw new Error('Products API down');
        }
        return new Response(null, { status: 404 });
      });

      const result = await service.enrich(mockOrder);

      expect(result.exchangeRate).toBe(1.1);
      expect(result.ipInfo).toBeUndefined();
      expect(result.productsInfo).toBeUndefined();
    });

    it('should throw when exchange rate for target currency is missing', async () => {
      fetchSpy.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes('exchangerate-api')) {
          return new Response(
            JSON.stringify({ base_code: 'EUR', rates: {} }),
            { status: 200 },
          );
        }
        return new Response(null, { status: 404 });
      });

      await expect(service.enrich(mockOrder)).rejects.toThrow(
        'Exchange rate not found for EUR -> USD',
      );
    });
  });
});