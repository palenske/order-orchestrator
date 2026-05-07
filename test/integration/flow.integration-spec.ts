import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { OrderStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import request from 'supertest';

describe('Integration Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ordersQueue: Queue;
  let dlqQueue: Queue;

  jest.setTimeout(60000);

  const UNIQUE_PREFIX = `itest-${Date.now()}`;

  function uniqueKey(suffix: string) {
    return `${UNIQUE_PREFIX}-${suffix}`;
  }

  function uniqueOrderId(suffix: string) {
    return `${UNIQUE_PREFIX}-${suffix}`;
  }

  async function waitForStatus(
    orderId: string,
    targetStatus: OrderStatus,
    timeoutMs = 15000,
    intervalMs = 300,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (order && order.status === targetStatus) return;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(
      `Timed out waiting for order ${orderId} to reach ${targetStatus}`,
    );
  }

  async function getOrderStatus(orderId: string): Promise<OrderStatus | null> {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    return order?.status ?? null;
  }

  async function waitForDlqCount(
    minCount: number,
    timeoutMs = 15000,
    intervalMs = 500,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const count = await dlqQueue.count();
      if (count >= minCount) return;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error('Timed out waiting for DLQ entries');
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);

    ordersQueue = new Queue('orders', {
      connection: { url: process.env.REDIS_URL || 'redis://localhost:6379' },
    });
    dlqQueue = new Queue('orders-dlq', {
      connection: { url: process.env.REDIS_URL || 'redis://localhost:6379' },
    });
  });

  afterAll(async () => {
    await ordersQueue.close();
    await dlqQueue.close();
    await app.close();
  });

  afterEach(async () => {
    await prisma.orderFailure.deleteMany({});
    await prisma.orderItem.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.customer.deleteMany({});
    await ordersQueue.drain();
    await dlqQueue.drain();
    await ordersQueue.obliterate({ force: true });
    await dlqQueue.obliterate({ force: true });
  });

  describe('Status transitions: RECEIVED → PROCESSING → COMPLETED', () => {
    it('should receive webhook, enrich all 4 sources, and reach COMPLETED', async () => {
      const res = await request(app.getHttpServer())
        .post('/webhooks/orders')
        .send({
          order_id: uniqueOrderId('flow'),
          customer: { email: 'flow@test.com', name: 'Flow', cep: '01001000' },
          items: [{ sku: 'SKU1', qty: 2, unit_price: 50 }],
          currency: 'EUR',
          idempotency_key: uniqueKey('flow'),
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe('RECEIVED');

      const orderId = (
        await prisma.order.findFirst({
          where: { idempotencyKey: uniqueKey('flow') },
        })
      )!.id;

      await waitForStatus(orderId, OrderStatus.COMPLETED, 20000);

      const completed = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true, customer: true },
      });
      expect(completed!.status).toBe(OrderStatus.COMPLETED);
      expect(completed!.processedAt).toBeDefined();
      expect(completed!.conversionRate).toBeDefined();
      expect(completed!.totalAmount).toBeDefined();

      const enriched = completed!.enrichedData as any;
      expect(enriched).toBeDefined();
      expect(enriched.exchangeRateApi).toBeDefined();
      expect(enriched.ipInfo).toBeDefined();
      expect(enriched.productsInfo).toBeDefined();
      expect(enriched.cepInfo).toBeDefined();
    });

    it('should reach COMPLETED without CEP when customer has no cep field', async () => {
      const res = await request(app.getHttpServer())
        .post('/webhooks/orders')
        .send({
          order_id: uniqueOrderId('nocep'),
          customer: { email: 'nocep@test.com', name: 'NoCep' },
          items: [{ sku: 'SKU1', qty: 1, unit_price: 10 }],
          currency: 'USD',
          idempotency_key: uniqueKey('nocep'),
        })
        .expect(201);

      expect(res.body.success).toBe(true);

      const orderId = (
        await prisma.order.findFirst({
          where: { idempotencyKey: uniqueKey('nocep') },
        })
      )!.id;

      await waitForStatus(orderId, OrderStatus.COMPLETED, 20000);

      const completed = await prisma.order.findUnique({
        where: { id: orderId },
      });
      const enriched = completed!.enrichedData as any;
      expect(enriched.exchangeRateApi).toBeDefined();
      expect(enriched.ipInfo).toBeDefined();
      expect(enriched.productsInfo).toBeDefined();
      expect(enriched.cepInfo).toBeUndefined();
    });

    it('should store items and customer correctly from webhook', async () => {
      await request(app.getHttpServer())
        .post('/webhooks/orders')
        .send({
          order_id: uniqueOrderId('items'),
          customer: { email: 'items@test.com', name: 'Items' },
          items: [
            { sku: 'SKU-A', qty: 3, unit_price: 15.5 },
            { sku: 'SKU-B', qty: 1, unit_price: 99.9 },
          ],
          currency: 'USD',
          idempotency_key: uniqueKey('items'),
        })
        .expect(201);

      const order = await prisma.order.findFirst({
        where: { idempotencyKey: uniqueKey('items') },
        include: { items: true, customer: true },
      });

      expect(order!.items).toHaveLength(2);
      expect(order!.items.find((i) => i.sku === 'SKU-A')!.quantity).toBe(3);
      expect(order!.items.find((i) => i.sku === 'SKU-A')!.unitPrice).toBe(
        15.5,
      );
      expect(order!.items.find((i) => i.sku === 'SKU-B')!.quantity).toBe(1);
      expect(order!.customer!.email).toBe('items@test.com');
    });
  });

  describe('Status transition: PROCESSING → FAILED_ENRICHMENT (DLQ)', () => {
    it('should reach FAILED_ENRICHMENT and create DLQ entry on enrichment failure', async () => {
      await request(app.getHttpServer())
        .post('/webhooks/orders')
        .send({
          order_id: uniqueOrderId('fail'),
          customer: { email: 'fail@test.com', name: 'Fail' },
          items: [{ sku: 'FAIL', qty: 1, unit_price: 10 }],
          currency: 'INVALID_CURRENCY_XYZ',
          idempotency_key: uniqueKey('fail'),
        })
        .expect(201);

      const order = await prisma.order.findFirst({
        where: { idempotencyKey: uniqueKey('fail') },
      });

      await waitForStatus(
        order!.id,
        OrderStatus.FAILED_ENRICHMENT,
        30000,
      );

      const failed = await prisma.order.findUnique({
        where: { id: order!.id },
      });
      expect(failed!.status).toBe(OrderStatus.FAILED_ENRICHMENT);

      await waitForDlqCount(1, 15000);

      const failures = await prisma.orderFailure.findMany({
        where: { orderId: order!.id },
      });
      expect(failures.length).toBeGreaterThanOrEqual(1);
      expect(failures[0].error).toContain(
        'Exchange rate API returned status 404',
      );
    });
  });

  describe('Idempotency', () => {
    it('should reject duplicate idempotency_key with 409', async () => {
      const payload = {
        order_id: uniqueOrderId('idem'),
        customer: { email: 'idem@test.com', name: 'Idem' },
        items: [{ sku: 'SKU1', qty: 1, unit_price: 10 }],
        currency: 'USD',
        idempotency_key: uniqueKey('idem'),
      };

      const first = await request(app.getHttpServer())
        .post('/webhooks/orders')
        .send(payload)
        .expect(201);

      expect(first.body.success).toBe(true);

      const second = await request(app.getHttpServer())
        .post('/webhooks/orders')
        .send(payload)
        .expect(409);

      expect(second.body.message).toContain('already processed');
    });
  });

  describe('Webhook payload validation', () => {
    it('should reject payload missing required fields', async () => {
      await request(app.getHttpServer())
        .post('/webhooks/orders')
        .send({})
        .expect(400);
    });

    it('should reject payload with invalid email', async () => {
      await request(app.getHttpServer())
        .post('/webhooks/orders')
        .send({
          order_id: uniqueOrderId('val'),
          customer: { email: 'not-an-email', name: 'Test' },
          items: [{ sku: 'SKU1', qty: 1, unit_price: 10 }],
          currency: 'USD',
          idempotency_key: uniqueKey('val'),
        })
        .expect(400);
    });

    it('should reject payload with negative qty', async () => {
      await request(app.getHttpServer())
        .post('/webhooks/orders')
        .send({
          order_id: uniqueOrderId('val2'),
          customer: { email: 'val@test.com', name: 'Test' },
          items: [{ sku: 'SKU1', qty: -1, unit_price: 10 }],
          currency: 'USD',
          idempotency_key: uniqueKey('val2'),
        })
        .expect(400);
    });

    it('should reject payload with empty items array', async () => {
      await request(app.getHttpServer())
        .post('/webhooks/orders')
        .send({
          order_id: uniqueOrderId('val3'),
          customer: { email: 'val@test.com', name: 'Test' },
          items: [],
          currency: 'USD',
          idempotency_key: uniqueKey('val3'),
        })
        .expect(400);
    });
  });

  describe('GET /orders', () => {
    it('should list all orders when no filter is provided', async () => {
      await request(app.getHttpServer())
        .post('/webhooks/orders')
        .send({
          order_id: uniqueOrderId('list-all-1'),
          customer: { email: 'list1@test.com', name: 'List1' },
          items: [{ sku: 'SKU1', qty: 1, unit_price: 10 }],
          currency: 'USD',
          idempotency_key: uniqueKey('list-all-1'),
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/webhooks/orders')
        .send({
          order_id: uniqueOrderId('list-all-2'),
          customer: { email: 'list2@test.com', name: 'List2' },
          items: [{ sku: 'SKU2', qty: 2, unit_price: 20 }],
          currency: 'USD',
          idempotency_key: uniqueKey('list-all-2'),
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/orders')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter orders by status', async () => {
      await request(app.getHttpServer())
        .post('/webhooks/orders')
        .send({
          order_id: uniqueOrderId('list-status'),
          customer: { email: 'status@test.com', name: 'Status' },
          items: [{ sku: 'SKU1', qty: 1, unit_price: 10 }],
          currency: 'USD',
          idempotency_key: uniqueKey('list-status'),
        })
        .expect(201);

      const order = await prisma.order.findFirst({
        where: { idempotencyKey: uniqueKey('list-status') },
      });
      await waitForStatus(order!.id, OrderStatus.COMPLETED, 20000);

      const completedRes = await request(app.getHttpServer())
        .get('/orders?status=COMPLETED')
        .expect(200);

      expect(Array.isArray(completedRes.body)).toBe(true);
      expect(completedRes.body.length).toBeGreaterThanOrEqual(1);
      expect(completedRes.body.every((o: any) => o.status === 'COMPLETED')).toBe(true);

      const receivedRes = await request(app.getHttpServer())
        .get('/orders?status=RECEIVED')
        .expect(200);

      expect(Array.isArray(receivedRes.body)).toBe(true);
      expect(receivedRes.body.every((o: any) => o.status === 'RECEIVED')).toBe(true);
    });

    it('should return empty array for status with no orders', async () => {
      const res = await request(app.getHttpServer())
        .get('/orders?status=FAILED_ENRICHMENT')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });

    it('should paginate results with page and limit', async () => {
      await request(app.getHttpServer())
        .post('/webhooks/orders')
        .send({
          order_id: uniqueOrderId('pag'),
          customer: { email: 'pag@test.com', name: 'Pag' },
          items: [{ sku: 'SKU1', qty: 1, unit_price: 10 }],
          currency: 'USD',
          idempotency_key: uniqueKey('pag'),
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/orders?page=1&limit=1')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeLessThanOrEqual(1);
    });
  });

  describe('GET /orders/:id', () => {
    it('should return full order details with items and customer', async () => {
      await request(app.getHttpServer())
        .post('/webhooks/orders')
        .send({
          order_id: uniqueOrderId('detail'),
          customer: { email: 'detail@test.com', name: 'Detail', cep: '01001000' },
          items: [
            { sku: 'SKU-A', qty: 3, unit_price: 15.5 },
            { sku: 'SKU-B', qty: 1, unit_price: 99.9 },
          ],
          currency: 'EUR',
          idempotency_key: uniqueKey('detail'),
        })
        .expect(201);

      const order = await prisma.order.findFirst({
        where: { idempotencyKey: uniqueKey('detail') },
      });
      await waitForStatus(order!.id, OrderStatus.COMPLETED, 20000);

      const res = await request(app.getHttpServer())
        .get(`/orders/${order!.id}`)
        .expect(200);

      expect(res.body.id).toBe(order!.id);
      expect(res.body.externalId).toBe(uniqueOrderId('detail'));
      expect(res.body.status).toBe('COMPLETED');
      expect(res.body.currency).toBe('EUR');
      expect(res.body.totalAmount).toBeDefined();
      expect(res.body.conversionRate).toBeDefined();
      expect(res.body.processedAt).toBeDefined();
      expect(res.body.enrichedData).toBeDefined();

      const enriched = res.body.enrichedData;
      expect(enriched.exchangeRateApi).toBeDefined();
      expect(enriched.ipInfo).toBeDefined();
      expect(enriched.productsInfo).toBeDefined();
      expect(enriched.cepInfo).toBeDefined();

      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items).toHaveLength(2);

      expect(res.body.customer).toBeDefined();
      expect(res.body.customer.email).toBe('detail@test.com');
      expect(res.body.customer.name).toBe('Detail');
      expect(res.body.customer.cep).toBe('01001000');
    });

    it('should return order without CEP enrichment when customer has no cep', async () => {
      await request(app.getHttpServer())
        .post('/webhooks/orders')
        .send({
          order_id: uniqueOrderId('nocep-detail'),
          customer: { email: 'nocep2@test.com', name: 'NoCepDetail' },
          items: [{ sku: 'SKU1', qty: 1, unit_price: 10 }],
          currency: 'USD',
          idempotency_key: uniqueKey('nocep-detail'),
        })
        .expect(201);

      const order = await prisma.order.findFirst({
        where: { idempotencyKey: uniqueKey('nocep-detail') },
      });
      await waitForStatus(order!.id, OrderStatus.COMPLETED, 20000);

      const res = await request(app.getHttpServer())
        .get(`/orders/${order!.id}`)
        .expect(200);

      expect(res.body.enrichedData.cepInfo).toBeUndefined();
      expect(res.body.enrichedData.ipInfo).toBeDefined();
      expect(res.body.enrichedData.exchangeRateApi).toBeDefined();
      expect(res.body.enrichedData.productsInfo).toBeDefined();
    });

    it('should return 404 for nonexistent order', async () => {
      await request(app.getHttpServer())
        .get('/orders/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });

    it('should return FAILED_ENRICHMENT order with failure details', async () => {
      await request(app.getHttpServer())
        .post('/webhooks/orders')
        .send({
          order_id: uniqueOrderId('fail-detail'),
          customer: { email: 'faild@test.com', name: 'FailDetail' },
          items: [{ sku: 'FAIL', qty: 1, unit_price: 10 }],
          currency: 'INVALID_CURRENCY_XYZ',
          idempotency_key: uniqueKey('fail-detail'),
        })
        .expect(201);

      const order = await prisma.order.findFirst({
        where: { idempotencyKey: uniqueKey('fail-detail') },
      });
      await waitForStatus(order!.id, OrderStatus.FAILED_ENRICHMENT, 30000);

      const res = await request(app.getHttpServer())
        .get(`/orders/${order!.id}`)
        .expect(200);

      expect(res.body.status).toBe('FAILED_ENRICHMENT');
      expect(res.body.totalAmount).toBeNull();
      expect(res.body.conversionRate).toBeNull();
      expect(res.body.processedAt).toBeNull();
    });
  });

  describe('GET /queue/metrics', () => {
    it('should return queue metrics with all required fields', async () => {
      const res = await request(app.getHttpServer())
        .get('/queue/metrics')
        .expect(200);

      expect(res.body).toHaveProperty('queueName', 'orders');
      expect(typeof res.body.waiting).toBe('number');
      expect(typeof res.body.active).toBe('number');
      expect(typeof res.body.completed).toBe('number');
      expect(typeof res.body.failed).toBe('number');
      expect(typeof res.body.delayed).toBe('number');
      expect(typeof res.body.paused).toBe('boolean');
      expect(res.body).toHaveProperty('health');
      expect(['healthy', 'unhealthy']).toContain(res.body.health);
      expect(res.body.dlq).toHaveProperty('queueName', 'orders-dlq');
      expect(typeof res.body.dlq.count).toBe('number');
    });

    it('should reflect completed jobs after processing an order', async () => {
      await request(app.getHttpServer())
        .post('/webhooks/orders')
        .send({
          order_id: uniqueOrderId('metrics'),
          customer: { email: 'metrics@test.com', name: 'Metrics' },
          items: [{ sku: 'SKU1', qty: 1, unit_price: 10 }],
          currency: 'USD',
          idempotency_key: uniqueKey('metrics'),
        })
        .expect(201);

      const order = await prisma.order.findFirst({
        where: { idempotencyKey: uniqueKey('metrics') },
      });
      await waitForStatus(order!.id, OrderStatus.COMPLETED, 20000);

      const res = await request(app.getHttpServer())
        .get('/queue/metrics')
        .expect(200);

      expect(res.body.completed).toBeGreaterThanOrEqual(1);
    });

    it('should reflect DLQ entries after enrichment failure', async () => {
      await request(app.getHttpServer())
        .post('/webhooks/orders')
        .send({
          order_id: uniqueOrderId('metrics-dlq'),
          customer: { email: 'mdq@test.com', name: 'MetricsDLQ' },
          items: [{ sku: 'FAIL', qty: 1, unit_price: 10 }],
          currency: 'INVALID_CURRENCY_XYZ',
          idempotency_key: uniqueKey('metrics-dlq'),
        })
        .expect(201);

      const order = await prisma.order.findFirst({
        where: { idempotencyKey: uniqueKey('metrics-dlq') },
      });
      await waitForStatus(order!.id, OrderStatus.FAILED_ENRICHMENT, 30000);
      await waitForDlqCount(1, 15000);

      const res = await request(app.getHttpServer())
        .get('/queue/metrics')
        .expect(200);

      expect(res.body.dlq.count).toBeGreaterThanOrEqual(1);
      expect(res.body.health).toBe('unhealthy');
    });
  });

  describe('Admin failures endpoint', () => {
    it('should list failures and support reprocess', async () => {
      await request(app.getHttpServer())
        .post('/webhooks/orders')
        .send({
          order_id: uniqueOrderId('reproc'),
          customer: { email: 'reproc@test.com', name: 'Reproc' },
          items: [{ sku: 'FAIL', qty: 1, unit_price: 10 }],
          currency: 'INVALID_CURRENCY_XYZ',
          idempotency_key: uniqueKey('reproc'),
        })
        .expect(201);

      const order = await prisma.order.findFirst({
        where: { idempotencyKey: uniqueKey('reproc') },
      });
      await waitForStatus(
        order!.id,
        OrderStatus.FAILED_ENRICHMENT,
        30000,
      );

      const failuresRes = await request(app.getHttpServer())
        .get('/admin/failures?unresolved=true')
        .expect(200);

      expect(Array.isArray(failuresRes.body)).toBe(true);
      expect(failuresRes.body.length).toBeGreaterThanOrEqual(1);
      expect(failuresRes.body[0].orderId).toBe(order!.id);
      expect(failuresRes.body[0].resolved).toBe(false);

      const failure = failuresRes.body[0];

      const reprocRes = await request(app.getHttpServer())
        .post(`/admin/failures/${failure.id}/reprocess`)
        .expect(201);

      expect(reprocRes.body.success).toBe(true);
      expect(reprocRes.body.message).toContain('re-enqueued');
    });

    it('should resolve a failure', async () => {
      await request(app.getHttpServer())
        .post('/webhooks/orders')
        .send({
          order_id: uniqueOrderId('resolve'),
          customer: { email: 'resolve@test.com', name: 'Resolve' },
          items: [{ sku: 'FAIL', qty: 1, unit_price: 10 }],
          currency: 'INVALID_CURRENCY_XYZ',
          idempotency_key: uniqueKey('resolve'),
        })
        .expect(201);

      const order = await prisma.order.findFirst({
        where: { idempotencyKey: uniqueKey('resolve') },
      });
      await waitForStatus(order!.id, OrderStatus.FAILED_ENRICHMENT, 30000);

      const failuresRes = await request(app.getHttpServer())
        .get('/admin/failures?unresolved=true')
        .expect(200);

      const failure = failuresRes.body[0];

      const resolveRes = await request(app.getHttpServer())
        .post(`/admin/failures/${failure.id}/resolve`)
        .expect(201);

      expect(resolveRes.body.success).toBe(true);

      const resolvedRes = await request(app.getHttpServer())
        .get('/admin/failures?unresolved=true')
        .expect(200);

      expect(resolvedRes.body.find((f: any) => f.id === failure.id)).toBeUndefined();
    });
  });
});