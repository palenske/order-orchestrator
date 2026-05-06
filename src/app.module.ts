import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './database/prisma.module';
import { OrderModule } from './modules/order/order.module';
import { QueueModule } from './modules/queue/queue.module';
import { WebhookModule } from './modules/webhook/webhook.module';

@Module({
  imports: [
    BullModule.forRoot('orders', {
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    }),
    PrismaModule,
    OrderModule,
    QueueModule,
    WebhookModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
