import { Controller, Get } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Controller('queue')
export class QueueController {
  constructor(
    @InjectQueue('orders') private readonly ordersQueue: Queue,
    @InjectQueue('orders-dlq') private readonly dlqQueue: Queue,
  ) {}

  @Get('metrics')
  async getMetrics() {
    const [waiting, active, completed, failed, delayed, paused] =
      await Promise.all([
        this.ordersQueue.getWaitingCount(),
        this.ordersQueue.getActiveCount(),
        this.ordersQueue.getCompletedCount(),
        this.ordersQueue.getFailedCount(),
        this.ordersQueue.getDelayedCount(),
        this.ordersQueue.isPaused(),
      ]);

    const dlqCount = await this.dlqQueue.count();

    return {
      queueName: 'orders',
      waiting,
      active,
      completed,
      failed,
      delayed,
      paused,
      dlq: {
        queueName: 'orders-dlq',
        count: dlqCount,
      },
      health: failed > 0 ? 'unhealthy' : 'healthy',
    };
  }
}
