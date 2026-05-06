import { Controller, Get } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Controller('queue')
export class QueueController {
  constructor(
    @InjectQueue('orders') private readonly ordersQueue: Queue,
  ) {}

  @Get('metrics')
  async getMetrics() {
    const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
      this.ordersQueue.getWaitingCount(),
      this.ordersQueue.getActiveCount(),
      this.ordersQueue.getCompletedCount(),
      this.ordersQueue.getFailedCount(),
      this.ordersQueue.getDelayedCount(),
      this.ordersQueue.isPaused(),
    ]);

    return {
      queueName: 'orders',
      waiting,
      active,
      completed,
      failed,
      delayed,
      paused,
      health: failed > 0 ? 'unhealthy' : 'healthy',
    };
  }
}