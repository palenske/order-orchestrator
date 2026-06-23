import http from 'k6/http';
import { check, sleep, group } from 'k6';

export const options = {
  scenarios: {
    browse_orders: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 10 },
        { duration: '20s', target: 30 },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
      tags: { scenario: 'browse' },
    },
    create_orders: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5s', target: 5 },
        { duration: '25s', target: 15 },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
      tags: { scenario: 'create' },
      startTime: '5s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.05'],
    'http_req_duration{scenario:browse}': ['p(95)<1000'],
    'http_req_duration{scenario:create}': ['p(95)<3000'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

function browseOrders() {
  group('browse orders', () => {
    const res = http.get(`${BASE_URL}/orders`, {
      tags: { endpoint: 'list-orders' },
    });
    check(res, {
      'list-orders status 200': (r) => r.status === 200,
      'list-orders returns array': (r) => {
        try {
          return Array.isArray(JSON.parse(r.body));
        } catch {
          return false;
        }
      },
    });
  });
}

function createOrder() {
  group('create order', () => {
    const idempotencyKey = `k6-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const payload = JSON.stringify({
      order_id: `order-${idempotencyKey}`,
      customer: { email: 'k6@test.com', name: 'K6 Load' },
      items: [{ sku: 'LOAD-SKU', qty: 1, unit_price: 10 }],
      currency: 'USD',
      idempotency_key: idempotencyKey,
    });

    const res = http.post(`${BASE_URL}/webhooks/orders`, payload, {
      headers: { 'Content-Type': 'application/json' },
      tags: { endpoint: 'create-order' },
    });

    check(res, {
      'create-order status 201': (r) => r.status === 201,
      'create-order returns success': (r) => {
        try {
          return JSON.parse(r.body).success === true;
        } catch {
          return false;
        }
      },
    });

    if (res.status === 201 && res.body) {
      const body = JSON.parse(res.body);

      const detailRes = http.get(`${BASE_URL}/orders/${body.order_id}`, {
        tags: { endpoint: 'get-order' },
      });
      check(detailRes, {
        'get-order status 200': (r) => r.status === 200,
      });
    }
  });
}

function checkMetrics() {
  group('metrics endpoint', () => {
    const res = http.get(`${BASE_URL}/metrics`, {
      tags: { endpoint: 'metrics' },
    });
    check(res, {
      'metrics status 200': (r) => r.status === 200,
      'metrics has prometheus data': (r) =>
        r.body && r.body.includes('http_requests_total'),
    });
  });
}

export default function () {
  const scenario = __ENV.SCENARIO || 'mixed';

  if (scenario === 'browse') {
    browseOrders();
  } else if (scenario === 'create') {
    createOrder();
  } else {
    checkMetrics();
    browseOrders();
    createOrder();
  }

  sleep(1);
}
