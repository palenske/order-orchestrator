export interface Customer {
  email: string;
  name: string;
}

export interface OrderItem {
  sku: string;
  qty: number;
  unit_price: number;
}

export interface CreateOrderWebhookDto {
  order_id: string;
  customer: Customer;
  items: OrderItem[];
  currency: string;
  idempotency_key: string;
}
