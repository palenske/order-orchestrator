import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OrderProcessor } from './processors/order.processor';
import { EnrichmentService } from './services/enrichment.service';
import { FailureController } from './failure.controller';
import { QueueController } from './queue.controller';
import { OrderModule } from '../order/order.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'orders' }, { name: 'orders-dlq' }),
    OrderModule,
  ],
  controllers: [FailureController, QueueController],
  providers: [OrderProcessor, EnrichmentService],
})
export class QueueModule {}
