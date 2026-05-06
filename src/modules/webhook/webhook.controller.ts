import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import type { CreateOrderWebhookDto } from './dto/create-order-webhook.dto';

@Controller('webhooks')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post('orders')
  @HttpCode(HttpStatus.CREATED)
  receiveOrderWebhook(@Body() createOrderWebhookDto: CreateOrderWebhookDto) {
    return this.webhookService.receiveOrderWebhook(createOrderWebhookDto);
  }
}
