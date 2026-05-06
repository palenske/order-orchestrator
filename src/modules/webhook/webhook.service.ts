import { Injectable } from '@nestjs/common';

@Injectable()
export class WebhookService {
  receiveOrderWebhook(): string {
    return 'Webhook received!';
  }
}
