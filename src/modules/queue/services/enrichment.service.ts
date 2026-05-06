import { Injectable, Logger } from '@nestjs/common';
import type { Order } from '@prisma/client';

export interface EnrichedData {
  exchangeRate: number;
  convertedTotal: number;
  rateSource: string;
  timestamp: string;
  exchangeRateApi?: {
    base: string;
    target: string;
    rate: number;
  };
  ipInfo?:
    | {
        ip: string;
        country: string;
        city: string;
        isp: string;
      }
    | undefined;
  cepInfo?:
    | {
        cep: string;
        street: string;
        neighborhood: string;
        city: string;
        state: string;
      }
    | undefined;
  productsInfo?:
    | {
        validated: boolean;
        products: Array<{
          sku: string;
          name: string;
          price: number;
          found: boolean;
        }>;
      }
    | undefined;
}

@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger(EnrichmentService.name);
  private readonly targetCurrency = 'USD';

  async enrich(order: Order): Promise<EnrichedData> {
    this.logger.log(`Enriching order: ${order.id}`);

    const items = (order as any).items || [];

    const exchangeResult = await this.getExchangeRateApi(
      order.currency,
      this.targetCurrency,
    );
    const rate = exchangeResult?.rate ?? 1;

    const totalAmount = items.reduce(
      (sum: number, item: any) => sum + item.quantity * item.unitPrice,
      0,
    );

    const convertedTotal = totalAmount * rate;

    const ipInfo = await this.getIpInfo();
    const productsInfo = await this.validateProducts(items);

    return {
      exchangeRate: rate,
      convertedTotal: Math.round(convertedTotal * 100) / 100,
      rateSource: 'ExchangeRate-API',
      timestamp: new Date().toISOString(),
      exchangeRateApi: exchangeResult,
      ipInfo,
      productsInfo,
    };
  }

  private async getExchangeRateApi(
    from: string,
    to: string,
  ): Promise<EnrichedData['exchangeRateApi']> {
    try {
      const response = await fetch(
        `https://api.exchangerate-api.com/v4/latest/${from}`,
      );
      const data = (await response.json()) as {
        base_code: string;
        rates: Record<string, number>;
      };
      return {
        base: data.base_code,
        target: to,
        rate: data.rates[to] || 1,
      };
    } catch (error) {
      this.logger.error(`Failed to get exchange rate: ${from} -> ${to}`, error);
      return { base: from, target: to, rate: 1 };
    }
  }

  async enrichWithCep(order: Order, cep: string): Promise<EnrichedData> {
    const baseData = await this.enrich(order);

    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = (await response.json()) as {
        cep?: string;
        logradouro?: string;
        bairro?: string;
        local?: string;
        uf?: string;
      };

      if (data.cep) {
        return {
          ...baseData,
          cepInfo: {
            cep: data.cep,
            street: data.logradouro ?? '',
            neighborhood: data.bairro ?? '',
            city: data.local ?? '',
            state: data.uf ?? '',
          },
        };
      }
    } catch (error) {
      this.logger.error(`Failed to get CEP info: ${cep}`, error);
    }

    return baseData;
  }

  private async getIpInfo(): Promise<EnrichedData['ipInfo']> {
    try {
      const response = await fetch(
        'http://ip-api.com/json/?fields=status,country,city,isp,query',
      );
      const data = (await response.json()) as {
        status: string;
        query?: string;
        country?: string;
        city?: string;
        isp?: string;
      };
      if (data.status === 'fail') return undefined;
      return {
        ip: data.query ?? '',
        country: data.country ?? '',
        city: data.city ?? '',
        isp: data.isp ?? '',
      };
    } catch (error) {
      this.logger.error('Failed to get IP info', error);
      return undefined;
    }
  }

  private async validateProducts(
    items: any[],
  ): Promise<EnrichedData['productsInfo']> {
    try {
      const response = await fetch('https://fakestoreapi.com/products');
      const products = (await response.json()) as Array<{
        title: string;
        price: number;
      }>;

      const validated = items.map((item) => {
        const product = products.find((p) => p.price === item.unitPrice);
        return {
          sku: item.sku,
          name: product?.title ?? 'Unknown',
          price: item.unitPrice,
          found: !!product,
        };
      });

      return { validated: true, products: validated };
    } catch (error) {
      this.logger.error('Failed to validate products', error);
      return { validated: false, products: [] };
    }
  }
}
