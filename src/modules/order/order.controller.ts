import { Controller, Get } from '@nestjs/common';
import { OrderService } from './order.service';

@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get()
  getOrders(): { id: string; status: string }[] {
    return this.orderService.getOrders();
  }
}
