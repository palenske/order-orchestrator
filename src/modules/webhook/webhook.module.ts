import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { OrderRepository } from '../order/repositories/order.repository';

@Module({
  imports: [],
  controllers: [WebhookController],
  providers: [WebhookService, OrderRepository],
})
export class WebhookModule {}
