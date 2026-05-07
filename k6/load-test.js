import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 20 },
    { duration: '30s', target: 50 },
    { duration: '10s', target: 0 },
  ],
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const uniqueKey = `k6-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const payload = JSON.stringify({
    order_id: `k6-${uniqueKey}`,
    customer: { email: 'k6@test.com', name: 'K6 Load' },
    items: [{ sku: 'LOAD-SKU', qty: 1, unit_price: 10 }],
    currency: 'USD',
    idempotency_key: uniqueKey,
  });

  const res = http.post(`${BASE_URL}/webhooks/orders`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });

  check(res, {
    'status is 201': (r) => r.status === 201,
    'has success': (r) => JSON.parse(r.body).success === true,
  });
}