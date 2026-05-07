import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OrderProcessor } from './processors/order.processor';
import { EnrichmentService } from './services/enrichment.service';
import { RecoveryService } from './services/recovery.service';
import { FailureController } from './failure.controller';
import { QueueController } from './queue.controller';
import { OrderModule } from '../order/order.module';
import { MetricsModule } from '../../infrastructure/metrics/metrics.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'orders' }, { name: 'orders-dlq' }),
    OrderModule,
    MetricsModule,
  ],
  controllers: [FailureController, QueueController],
  providers: [OrderProcessor, EnrichmentService, RecoveryService],
  exports: [RecoveryService],
})
export class QueueModule {}
