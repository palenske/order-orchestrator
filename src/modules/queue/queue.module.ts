import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OrderProcessor } from './processors/order.processor';
import { EnrichmentService } from './services/enrichment.service';
import { FailureController } from './failure.controller';
import { QueueController } from './queue.controller';
import { OrderModule } from '../order/order.module';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    }),
    BullModule.registerQueue({ name: 'orders' }),
    OrderModule,
  ],
  controllers: [FailureController, QueueController],
  providers: [OrderProcessor, EnrichmentService],
})
export class QueueModule {}
