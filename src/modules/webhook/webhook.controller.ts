import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { CreateOrderWebhookDto } from './dto/create-order-webhook.dto';
import { WebhookSignatureGuard } from './guards/webhook-signature.guard';

@Controller('webhooks')
@UseGuards(WebhookSignatureGuard)
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post('orders')
  @HttpCode(HttpStatus.CREATED)
  receiveOrderWebhook(@Body() createOrderWebhookDto: CreateOrderWebhookDto) {
    return this.webhookService.receiveOrderWebhook(createOrderWebhookDto);
  }
}
