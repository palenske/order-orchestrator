import { Module } from '@nestjs/common';
import { OrderProcessor } from './processors/order.processor';
import { EnrichmentService } from './services/enrichment.service';

@Module({
  providers: [OrderProcessor, EnrichmentService],
})
export class QueueModule {}