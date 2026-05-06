# Order Orchestrator

API de processamento assíncrono de pedidos com enriquecimento via serviços externos, filas com retry e DLQ.

**URL de produção:** https://order-orchestrator.up.railway.app

## Setup

```bash
pnpm install
docker compose up -d
pnpm db:migrate
```

Variáveis de ambiente (`.env`):

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/order_orch
REDIS_HOST=localhost
REDIS_PORT=6379
WEBHOOK_SECRET=          # vazio = verificação desabilitada
```

## Executar

```bash
pnpm start:dev           # desenvolvimento
pnpm start:prod          # produção
```

## Testar

```bash
pnpm test                # unitários
pnpm test:e2e            # e2e (requer serviços rodando)
```

## API

### Webhook — Receber pedido

```bash
curl -X POST http://localhost:3000/webhooks/orders \
  -H "Content-Type: application/json" \
  -H "x-webhook-signature: <hmac-sha256>" \
  -d '{
    "order_id": "ext-123",
    "customer": { "email": "user@example.com", "name": "Ana" },
    "items": [{ "sku": "ABC123", "qty": 2, "unit_price": 59.9 }],
    "currency": "EUR",
    "idempotency_key": "uuid-unico"
  }'
```

- Payload validado via `class-validator` (campos obrigatórios, tipos, email)
- Idempotência: `idempotency_key` impede processamento duplicado
- Status inicial: `RECEIVED`

### Consulta

```
GET /orders?status=RECEIVED&page=1&limit=20   # listar com paginação e filtro
GET /orders/:id                                 # detalhes de um pedido
GET /queue/metrics                               # métricas da fila + DLQ
```

### Administração de falhas

```
GET  /admin/failures?unresolved=true   # listar falhas
POST /admin/failures/:id/resolve       # marcar como resolvida
POST /admin/failures/:id/reprocess     # reenfileirar pedido
```

## Fluxo de processamento

```
RECEIVED → PROCESSING → ENRICHED → COMPLETED
                                  ↘ FAILED_ENRICHMENT (após 3 tentativas)
```

1. Webhook recebe e persiste o pedido (`RECEIVED`)
2. Job enfileirado no BullMQ (`orders`)
3. Processor consulta APIs externas (câmbio, IP, produtos), atualiza para `ENRICHED` e `COMPLETED`
4. Em falha: 3 tentativas com backoff exponencial → DLQ (`orders-dlq`) + status `FAILED_ENRICHMENT`
5. `/admin/failures/:id/reprocess` reenfileira

## Enriquecimento

| Serviço | Uso | Falha |
|---------|-----|-------|
| ExchangeRate-API | Conversão de moeda (obrigatório) | Retry via fila |
| ip-api | Geolocalização do servidor | Degradado, segue sem IP info |
| FakeStore API | Validação de produtos por preço | Degradado, segue sem products info |
| ViaCEP | Busca de CEP (via `enrichWithCep`) | Degradado, segue sem CEP info |

Todas as chamadas possuem timeout de 10s via `AbortController`.

## Assinatura do webhook

Se `WEBHOOK_SECRET` estiver vazio, a verificação é desabilitada e o header não é necessário.

Para habilitar, defina qualquer valor no `.env`:

```
WEBHOOK_SECRET=minha-chave
```

Então envie o header `x-webhook-signature` com o HMAC-SHA256 do body:

```bash
# Exemplo com WEBHOOK_SECRET=minha-chave
SIGNATURE=$(echo -n '{"order_id":"ext-123","customer":{"email":"user@example.com","name":"Ana"},"items":[{"sku":"ABC123","qty":2,"unit_price":59.9}],"currency":"EUR","idempotency_key":"uuid-1"}' | openssl dgst -sha256 -hmac "minha-chave" | awk '{print $NF}')

curl -X POST http://localhost:3000/webhooks/orders \
  -H "Content-Type: application/json" \
  -H "x-webhook-signature: $SIGNATURE" \
  -d '{"order_id":"ext-123","customer":{"email":"user@example.com","name":"Ana"},"items":[{"sku":"ABC123","qty":2,"unit_price":59.9}],"currency":"EUR","idempotency_key":"uuid-1"}'
```

## Stack

- **NestJS** — framework
- **BullMQ + Redis** — fila, retry e DLQ
- **Prisma + PostgreSQL** — persistência
- **class-validator** — validação de payload