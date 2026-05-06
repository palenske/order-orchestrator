import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { createHmac } from 'crypto';

@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WebhookSignatureGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const webhookSecret = process.env.WEBHOOK_SECRET;

    if (!webhookSecret) {
      this.logger.warn(
        'WEBHOOK_SECRET not configured, skipping signature verification',
      );
      return true;
    }

    const signature = request.headers['x-webhook-signature'];
    if (!signature || typeof signature !== 'string') {
      throw new UnauthorizedException('Missing webhook signature');
    }

    const body =
      typeof request.body === 'string'
        ? request.body
        : JSON.stringify(request.body);

    const expected = createHmac('sha256', webhookSecret)
      .update(body)
      .digest('hex');

    if (signature !== expected) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return true;
  }
}
