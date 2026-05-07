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
    it('should list orders and filter by status', async () => {
      await request(app.getHttpServer())
        .post('/webhooks/orders')
        .send({
          order_id: uniqueOrderId('list'),
          customer: { email: 'list@test.com', name: 'List' },
          items: [{ sku: 'SKU1', qty: 1, unit_price: 10 }],
          currency: 'USD',
          idempotency_key: uniqueKey('list'),
        })
        .expect(201);

      const order = await prisma.order.findFirst({
        where: { idempotencyKey: uniqueKey('list') },
      });
      await waitForStatus(order!.id, OrderStatus.COMPLETED, 20000);

      const listRes = await request(app.getHttpServer())
        .get('/orders?status=COMPLETED')
        .expect(200);

      expect(Array.isArray(listRes.body)).toBe(true);
      expect(listRes.body.length).toBeGreaterThanOrEqual(1);

      const singleRes = await request(app.getHttpServer())
        .get(`/orders/${listRes.body[0].id}`)
        .expect(200);

      expect(singleRes.body.id).toBe(listRes.body[0].id);
      expect(singleRes.body.status).toBe('COMPLETED');
    });

    it('should return 404 for nonexistent order', async () => {
      await request(app.getHttpServer())
        .get('/orders/00000000-0000-0000-0000-000000000000')
        .expect(404);
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

      const failure = failuresRes.body[0];

      const reprocRes = await request(app.getHttpServer())
        .post(`/admin/failures/${failure.id}/reprocess`)
        .expect(201);

      expect(reprocRes.body.success).toBe(true);
      expect(reprocRes.body.message).toContain('re-enqueued');
    });
  });

  describe('Queue metrics', () => {
    it('should return queue metrics with DLQ info', async () => {
      const res = await request(app.getHttpServer())
        .get('/queue/metrics')
        .expect(200);

      expect(res.body).toHaveProperty('queueName', 'orders');
      expect(res.body).toHaveProperty('waiting');
      expect(res.body).toHaveProperty('active');
      expect(res.body).toHaveProperty('completed');
      expect(res.body).toHaveProperty('failed');
      expect(res.body).toHaveProperty('dlq');
      expect(res.body.dlq).toHaveProperty('queueName', 'orders-dlq');
      expect(res.body.dlq).toHaveProperty('count');
    });
  });
});