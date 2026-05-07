import { Test, TestingModule } from '@nestjs/testing';
import { EnrichmentService } from './enrichment.service';
import { MetricsService } from '../../../infrastructure/metrics/metrics.service';

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

  const mockOrderWithCep = {
    ...mockOrder,
    customer: {
      id: 'cust-1',
      email: 'test@test.com',
      name: 'Test',
      cep: '01001000',
      externalId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  } as any;

  const mockMetricsService = {
    httpRequestsTotal: { inc: jest.fn() } as any,
    httpRequestDurationSeconds: {
      labels: jest.fn().mockReturnValue({ observe: jest.fn() }),
    } as any,
    queueJobsProcessedTotal: { inc: jest.fn() } as any,
    externalApiRequestDurationSeconds: {
      labels: jest.fn().mockReturnValue({ observe: jest.fn() }),
    } as any,
    getMetrics: jest.fn(),
    getContentType: jest.fn(),
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      providers: [
        EnrichmentService,
        { provide: MetricsService, useValue: mockMetricsService },
      ],
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

    function mockAllApis(overrides?: {
      exchangeRates?: Record<string, number>;
      cep?: boolean;
    }) {
      fetchSpy.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes('exchangerate-api')) {
          return new Response(
            JSON.stringify({
              base_code: 'EUR',
              rates: overrides?.exchangeRates ?? { USD: 1.1 },
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
        if (overrides?.cep && urlStr.includes('viacep')) {
          return new Response(
            JSON.stringify({
              cep: '01001-000',
              logradouro: 'Praça da Sé',
              bairro: 'Sé',
              localidade: 'São Paulo',
              uf: 'SP',
            }),
            { status: 200 },
          );
        }
        return new Response(null, { status: 404 });
      });
    }

    it('should return enriched data with all 4 sources', async () => {
      mockAllApis();

      const result = await service.enrich(mockOrder);

      expect(result.exchangeRate).toBe(1.1);
      expect(result.convertedTotal).toBe(110);
      expect(result.originalTotal).toBe(100);
      expect(result.rateSource).toBe('ExchangeRate-API');
      expect(result.ipInfo).toBeDefined();
      expect(result.ipInfo!.ip).toBe('1.2.3.4');
      expect(result.productsInfo).toBeDefined();
      expect(result.productsInfo!.validated).toBe(true);
      expect(result.cepInfo).toBeUndefined();
    });

    it('should include cepInfo when customer has cep', async () => {
      mockAllApis({ cep: true });

      const result = await service.enrich(mockOrderWithCep);

      expect(result.cepInfo).toBeDefined();
      expect(result.cepInfo!.cep).toBe('01001-000');
      expect(result.cepInfo!.city).toBe('São Paulo');
    });

    it('should throw when exchange rate API fails', async () => {
      fetchSpy.mockResolvedValue(new Response(null, { status: 500 }));

      await expect(service.enrich(mockOrder)).rejects.toThrow(
        'Exchange rate API returned status 500',
      );
    });

    it('should throw when IP info API fails', async () => {
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
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response(null, { status: 404 });
      });

      await expect(service.enrich(mockOrder)).rejects.toThrow('IP API down');
    });

    it('should throw when products API fails', async () => {
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
          return new Response(null, { status: 500 });
        }
        return new Response(null, { status: 404 });
      });

      await expect(service.enrich(mockOrder)).rejects.toThrow(
        'Products API returned status 500',
      );
    });

    it('should throw when CEP API fails for customer with cep', async () => {
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
        if (urlStr.includes('viacep')) {
          return new Response(null, { status: 404 });
        }
        return new Response(null, { status: 404 });
      });

      await expect(service.enrich(mockOrderWithCep)).rejects.toThrow(
        'CEP API returned status 404',
      );
    });

    it('should throw when exchange rate for target currency is missing', async () => {
      fetchSpy.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes('exchangerate-api')) {
          return new Response(JSON.stringify({ base_code: 'EUR', rates: {} }), {
            status: 200,
          });
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

      await expect(service.enrich(mockOrder)).rejects.toThrow(
        'Exchange rate not found for EUR -> USD',
      );
    });
  });
});
