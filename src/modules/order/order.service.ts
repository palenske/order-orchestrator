import { Injectable } from '@nestjs/common';

@Injectable()
export class OrderService {
  getOrders(): { id: string; status: string }[] {
    return [{ id: '1', status: 'pending' }];
  }
}
