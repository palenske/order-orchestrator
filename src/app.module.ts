import { Module } from '@nestjs/common';
import { PrismaModule } from './database/prisma.module';
import { OrderModule } from './modules/order/order.module';
import { WebhookModule } from './modules/webhook/webhook.module';

@Module({
  imports: [PrismaModule, OrderModule, WebhookModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
