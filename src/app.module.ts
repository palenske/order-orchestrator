import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './database/prisma.module';
import { OrderModule } from './modules/order/order.module';
import { QueueModule } from './modules/queue/queue.module';
import { WebhookModule } from './modules/webhook/webhook.module';
import { MetricsModule } from './infrastructure/metrics/metrics.module';

@Module({
  imports: [
    BullModule.forRoot({
      connection: process.env.REDIS_URL
        ? { url: process.env.REDIS_URL }
        : {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
          },
    }),
    PrismaModule,
    OrderModule,
    QueueModule,
    WebhookModule,
    MetricsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
