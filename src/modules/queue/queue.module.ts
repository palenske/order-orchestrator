import { Module } from '@nestjs/common';
import { OrderProcessor } from './processors/order.processor';
import { EnrichmentService } from './services/enrichment.service';
import { FailureController } from './failure.controller';

@Module({
  controllers: [FailureController],
  providers: [OrderProcessor, EnrichmentService],
})
export class QueueModule {}