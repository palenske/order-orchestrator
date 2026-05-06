import { Injectable } from '@nestjs/common';
import { CreateOrderWebhookDto } from './dto/create-order-webhook.dto';

@Injectable()
export class WebhookService {
  receiveOrderWebhook(dto: CreateOrderWebhookDto) {
    return {
      success: true,
      order_id: dto.order_id,
      idempotency_key: dto.idempotency_key,
    };
  }
}
