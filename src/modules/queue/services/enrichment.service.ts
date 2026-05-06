import { Injectable, Logger } from '@nestjs/common';
import type { OrderWithRelations } from '../../order/repositories/order.repository';

export interface ExchangeRateResult {
  base: string;
  target: string;
  rate: number;
}

export interface IpInfoResult {
  ip: string;
  country: string;
  city: string;
  isp: string;
}

export interface CepInfoResult {
  cep: string;
  street: string;
  neighborhood: string;
  city: string;
  state: string;
}

export interface ProductsInfoResult {
  validated: boolean;
  products: Array<{
    sku: string;
    name: string;
    price: number;
    found: boolean;
  }>;
}

export interface EnrichedData {
  exchangeRate: number;
  convertedTotal: number;
  originalTotal: number;
  rateSource: string;
  timestamp: string;
  exchangeRateApi: ExchangeRateResult;
  ipInfo?: IpInfoResult;
  cepInfo?: CepInfoResult;
  productsInfo?: ProductsInfoResult;
}

const FETCH_TIMEOUT_MS = 10_000;

@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger(EnrichmentService.name);
  private readonly targetCurrency = 'USD';

  async enrich(order: OrderWithRelations): Promise<EnrichedData> {
    this.logger.log(`Enriching order: ${order.id}`);

    const items = order.items;

    const exchangeResult = await this.getExchangeRateApi(
      order.currency,
      this.targetCurrency,
    );
    const rate = exchangeResult.rate;

    const originalTotal = items.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0,
    );

    const convertedTotal = originalTotal * rate;

    const ipInfo = await this.getIpInfo().catch((error) => {
      this.logger.warn(
        'IP info enrichment failed, continuing without it',
        error,
      );
      return undefined;
    });

    const productsInfo = await this.validateProducts(items).catch((error) => {
      this.logger.warn(
        'Product validation enrichment failed, continuing without it',
        error,
      );
      return undefined;
    });

    return {
      exchangeRate: rate,
      convertedTotal: Math.round(convertedTotal * 100) / 100,
      originalTotal,
      rateSource: 'ExchangeRate-API',
      timestamp: new Date().toISOString(),
      exchangeRateApi: exchangeResult,
      ipInfo,
      productsInfo,
    };
  }

  async enrichWithCep(
    order: OrderWithRelations,
    cep: string,
  ): Promise<EnrichedData> {
    const baseData = await this.enrich(order);

    const cepInfo = await this.getCepInfo(cep).catch((error) => {
      this.logger.error(`Failed to get CEP info: ${cep}`, error);
      return undefined;
    });

    if (cepInfo) {
      return { ...baseData, cepInfo };
    }

    return baseData;
  }

  private async fetchWithTimeout(
    url: string,
    timeoutMs: number = FETCH_TIMEOUT_MS,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getExchangeRateApi(
    from: string,
    to: string,
  ): Promise<ExchangeRateResult> {
    const response = await this.fetchWithTimeout(
      `https://api.exchangerate-api.com/v4/latest/${from}`,
    );

    if (!response.ok) {
      throw new Error(
        `Exchange rate API returned status ${response.status} for ${from}`,
      );
    }

    const data = (await response.json()) as {
      base_code: string;
      rates: Record<string, number>;
    };

    const rate = data.rates[to];
    if (rate === undefined) {
      throw new Error(`Exchange rate not found for ${from} -> ${to}`);
    }

    return {
      base: data.base_code,
      target: to,
      rate,
    };
  }

  private async getIpInfo(): Promise<IpInfoResult> {
    const response = await this.fetchWithTimeout(
      'http://ip-api.com/json/?fields=status,country,city,isp,query',
    );

    const data = (await response.json()) as {
      status: string;
      query?: string;
      country?: string;
      city?: string;
      isp?: string;
    };
    if (data.status === 'fail') {
      throw new Error('IP info API returned fail status');
    }
    return {
      ip: data.query ?? '',
      country: data.country ?? '',
      city: data.city ?? '',
      isp: data.isp ?? '',
    };
  }

  private async getCepInfo(cep: string): Promise<CepInfoResult> {
    const response = await this.fetchWithTimeout(
      `https://viacep.com.br/ws/${cep}/json/`,
    );

    if (!response.ok) {
      throw new Error(`CEP API returned status ${response.status}`);
    }

    const data = (await response.json()) as {
      cep?: string;
      logradouro?: string;
      bairro?: string;
      localidade?: string;
      uf?: string;
      erro?: boolean;
    };

    if (data.erro || !data.cep) {
      throw new Error(`CEP not found: ${cep}`);
    }

    return {
      cep: data.cep,
      street: data.logradouro ?? '',
      neighborhood: data.bairro ?? '',
      city: data.localidade ?? '',
      state: data.uf ?? '',
    };
  }

  private async validateProducts(
    items: OrderWithRelations['items'],
  ): Promise<ProductsInfoResult> {
    const response = await this.fetchWithTimeout(
      'https://fakestoreapi.com/products',
    );

    if (!response.ok) {
      throw new Error(`Products API returned status ${response.status}`);
    }

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
  }
}
