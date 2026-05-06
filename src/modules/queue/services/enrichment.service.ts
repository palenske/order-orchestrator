import { Injectable, Logger } from '@nestjs/common';
import type { Order } from '@prisma/client';

export interface EnrichedData {
  exchangeRate: number;
  convertedTotal: number;
  rateSource: string;
  timestamp: string;
  ipInfo?: {
    ip: string;
    country: string;
    city: string;
    isp: string;
  } | undefined;
}

@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger(EnrichmentService.name);
  private readonly targetCurrency = 'USD';

  async enrich(order: Order): Promise<EnrichedData> {
    this.logger.log(`Enriching order: ${order.id}`);

    const exchangeRate = await this.getExchangeRate(order.currency, this.targetCurrency);

    const items = (order as any).items || [];
    const totalAmount = items.reduce(
      (sum: number, item: any) => sum + item.quantity * item.unitPrice,
      0,
    );

    const convertedTotal = totalAmount * exchangeRate;

    const ipInfo = await this.getIpInfo();

    return {
      exchangeRate,
      convertedTotal: Math.round(convertedTotal * 100) / 100,
      rateSource: 'frankfurter.app',
      timestamp: new Date().toISOString(),
      ipInfo,
    };
  }

  private async getExchangeRate(from: string, to: string): Promise<number> {
    try {
      const response = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}`);
      const data = await response.json() as { rates: Record<string, number> };
      return data.rates[to];
    } catch (error) {
      this.logger.error(`Failed to get exchange rate: ${from} -> ${to}`, error);
      return 1;
    }
  }

  private async getIpInfo(): Promise<EnrichedData['ipInfo']> {
    try {
      const response = await fetch('http://ip-api.com/json/?fields=status,country,city,isp,query');
      const data = await response.json() as { status: string; query?: string; country?: string; city?: string; isp?: string };
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
}