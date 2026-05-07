# Order Orchestrator

API de processamento assíncrono de pedidos com enriquecimento via serviços externos, filas com retry e DLQ.

**URL de produção:** https://order-orchestrator.up.railway.app

## Teste rápido

```bash
curl -X POST "https://order-orchestrator.up.railway.app/webhooks/orders" \
  -H "Content-Type: application/json" \
  -d '{
    "order_id": "ext-123",
    "customer": { "email": "user@example.com", "name": "Ana", "cep": "01001000" },
    "items": [{ "sku": "ABC123", "qty": 2, "unit_price": 59.9 }],
    "currency": "USD",
    "idempotency_key": "f390a7b8-406c-4436-958f-9cdcd732c8c1"
  }'
```

## Setup

```bash
pnpm install
docker compose up -d
pnpm db:migrate
```

Variáveis de ambiente (`.env`):

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/order_orch
REDIS_URL=redis://localhost:6379
WEBHOOK_SECRET=          # vazio = verificação desabilitada
```

## Executar

```bash
pnpm start:dev           # desenvolvimento
pnpm start:prod          # produção
```

## Testar

```bash
pnpm test                      # unitários (41 testes)
pnpm test:integration          # integração (22 testes, requer DB e Redis)
```

### Testes de integração

Requer PostgreSQL e Redis rodando (via Docker ou local):

```bash
docker compose up -d
pnpm db:migrate
pnpm test:integration
```

Cobertura dos testes de integração:

| Grupo | Testes | O que valida |
|-------|--------|-------------|
| **Transições de status** | happy path com CEP | RECEIVED → PROCESSING → ENRICHED → COMPLETED, enrichedData com 4 fontes (exchangeRate, ipInfo, productsInfo, cepInfo) |
| | happy path sem CEP | COMPLETED sem cepInfo quando customer não tem CEP |
| | DLQ | Falha em qualquer enriquecimento → FAILED_ENRICHMENT after 3 retries, entrada na DLQ, failure record com mensagem de erro |
| **Idempotência** | payload duplicado | 409 Conflict na segunda requisição |
| **Validação de payload** | campos faltando, email inválido, qty negativo, items vazio | 400 Bad Request |
| **GET /orders** | lista todos | retorna array com pelo menos 2 pedidos |
| | filtra por status | só COMPLETED ou só RECEIVED |
| | status vazio | retorna array vazio para FAILED_ENRICHMENT |
| | paginação | page/limit funcionam |
| **GET /orders/:id** | detalhes completos | enrichedData, items, customer com cep |
| | sem CEP | cepInfo undefined, demais fontes presentes |
| | 404 inexistente | retorna 404 |
| | order com falha | totalAmount/conversionRate/processedAt nulos |
| **GET /queue/metrics** | campos obrigatórios | queueName, waiting, active, completed, failed, delayed, paused, health, dlq |
| | completed >= 1 | após processar pedido |
| | dlq.count >= 1 e health=unhealthy | após falha de enriquecimento |
| **Admin failures** | lista + reprocessa | GET /admin/failures?unresolved=true, POST reprocess |
| | resolve | POST resolve marca como resolvida, some da lista de unresolved |

## API

### Webhook — Receber pedido

```bash
curl -X POST http://localhost:3000/webhooks/orders \
  -H "Content-Type: application/json" \
  -H "x-webhook-signature: <hmac-sha256>" \
  -d '{
    "order_id": "ext-123",
    "customer": { "email": "user@example.com", "name": "Ana", "cep": "01001000" },
    "items": [{ "sku": "ABC123", "qty": 2, "unit_price": 59.9 }],
    "currency": "EUR",
    "idempotency_key": "uuid-unico"
  }'
```

- Payload validado via `class-validator` (campos obrigatórios, tipos, email)
- `customer.cep` é opcional — quando fornecido, consulta ViaCEP
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

### Observabilidade

```
GET /metrics   # métricas Prometheus
```

Métricas disponíveis:

| Métrica | Tipo | Descrição |
|---------|------|-----------|
| `http_requests_total` | Counter | Requests HTTP por método, rota e status |
| `http_request_duration_seconds` | Histogram | Latência HTTP |
| `queue_jobs_processed_total` | Counter | Jobs processados por fila e resultado (completed/failed) |
| `external_api_request_duration_seconds` | Histogram | Latência das APIs externas por serviço e resultado |

## Fluxo de processamento

```
RECEIVED → PROCESSING → ENRICHED → COMPLETED
                                  ↘ FAILED_ENRICHMENT (após 3 tentativas)
```

1. Webhook recebe e persiste o pedido (`RECEIVED`)
2. Job enfileirado no BullMQ (`orders`)
3. Processor consulta APIs externas (câmbio, IP, produtos, CEP), atualiza para `ENRICHED` e `COMPLETED`
4. Em falha: 3 tentativas com backoff exponencial → DLQ (`orders-dlq`) + status `FAILED_ENRICHMENT`
5. `/admin/failures/:id/reprocess` reenfileira

## Enriquecimento

| Serviço | Uso | Falha |
|---------|-----|-------|
| ExchangeRate-API | Conversão de moeda | Retry via fila → FAILED_ENRICHMENT |
| ip-api | Geolocalização do servidor | Retry via fila → FAILED_ENRICHMENT |
| FakeStore API | Validação de produtos por preço | Retry via fila → FAILED_ENRICHMENT |
| ViaCEP | Busca de CEP (quando `customer.cep` fornecido) | Retry via fila → FAILED_ENRICHMENT |

Todos os enriquecimentos são obrigatórios para COMPLETED. Se qualquer um falhar, o job entra em retry (3 tentativas com backoff exponencial) e, se persistir, vai para a DLQ com status `FAILED_ENRICHMENT`. O CEP só é consultado quando o campo `cep` está presente no customer.

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

## Teste de carga

```bash
# Requer k6 (https://k6.io)
BASE_URL=http://localhost:3000 k6 run k6/load-test.js
```

O script envia payloads únicos para `POST /webhooks/orders` com rampa de 20→50→0 VUs.

### Resultados em produção

Teste executado contra https://order-orchestrator.up.railway.app:

- **Duração:** 50s (rampa 10s→20 VUs, 30s→50 VUs, 10s→0 VUs)
- **Requests totais:** 7,183
- **Taxa:** 143.43 req/s
- **Sucesso:** 100% (0 falhas)
- **Latência média:** 191.51ms
- **Latência P95:** 301.93ms
- **Checks:** 14,366 validações (100% sucesso)

Métricas detalhadas:
- **HTTP req duration:** avg=191.51ms, min=157.9ms, med=168.36ms, max=1.22s, p(90)=208.62ms, p(95)=301.93ms
- **VUs:** 1-49 (máximo 50 configurado)
- **Dados transferidos:** 2.1 MB enviados, 2.1 MB recebidos

## CI

Pipeline de CI via GitHub Actions (`.github/workflows/ci.yml`):

- Lint (`pnpm lint`)
- Build (`pnpm build`)
- Testes unitários

## Recuperação automática

Se o processo falhar entre persistir o pedido e enfileirar o job, o pedido fica em `RECEIVED` sem processamento. Na inicialização, o `RecoveryService` busca todos os pedidos com status `RECEIVED` e os reenfileira automaticamente. Isso garante que nenhum pedido fique preso, mesmo após crashes ou reinícios.

## Limitações conhecidas

Todos os enriquecimentos rodam em uma única fila `orders`. Se qualquer serviço externo falhar, o job inteiro é retentado — incluindo os serviços que já haviam respondido com sucesso. Uma evolução natural seria filas dedicadas por step (câmbio, IP, produtos, CEP), cada uma com seu próprio DLQ e política de retry. Isso permitiria retry granular (ex: 5 tentativas para CEP, 3 para câmbio), isolamento de falhas por serviço, e visibilidade individual de saúde por fila no `/queue/metrics`.

## Stack

- **NestJS** — framework
- **BullMQ + Redis** — fila, retry e DLQ
- **Prisma + PostgreSQL** — persistência
- **class-validator** — validação de payload
- **prom-client** — métricas Prometheus
