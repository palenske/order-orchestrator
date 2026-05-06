import { Module } from '@nestjs/common';
import { OrderModule } from './modules/order/order.module';
import { WebhookModule } from './modules/webhook/webhook.module';

@Module({
  imports: [OrderModule, WebhookModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
