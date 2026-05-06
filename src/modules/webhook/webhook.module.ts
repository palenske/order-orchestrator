import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { WebhookSignatureGuard } from './guards/webhook-signature.guard';
import { OrderModule } from '../order/order.module';

@Module({
  imports: [BullModule.registerQueue({ name: 'orders' }), OrderModule],
  controllers: [WebhookController],
  providers: [WebhookService, WebhookSignatureGuard],
})
export class WebhookModule {}
