import { Module } from '@nestjs/common';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { OrderRepository } from './repositories/order.repository';
import { FailureRepository } from './repositories/failure.repository';

@Module({
  imports: [],
  controllers: [OrderController],
  providers: [OrderService, OrderRepository, FailureRepository],
  exports: [OrderRepository, FailureRepository],
})
export class OrderModule {}
