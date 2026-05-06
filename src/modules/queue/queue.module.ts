import { Module } from '@nestjs/common';
import { OrderProcessor } from './processors/order.processor';
import { EnrichmentService } from './services/enrichment.service';
import { FailureController } from './failure.controller';
import { QueueController } from './queue.controller';

@Module({
  controllers: [FailureController, QueueController],
  providers: [OrderProcessor, EnrichmentService],
})
export class QueueModule {}