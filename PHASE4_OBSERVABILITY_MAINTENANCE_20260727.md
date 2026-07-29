# Fase 4 — Observabilidade e Manutenção Operacional

Data: 27/07/2026

Esta fase é cumulativa e pressupõe as correções de handoff, Fase 1 (anti-queda), Fase 2 (escalabilidade) e Fase 3 (integridade e concorrência).

## Objetivos

- Detectar degradação antes de virar indisponibilidade.
- Manter rankings de endpoints e operações SQL mais lentos sem registrar SQL completo ou parâmetros sensíveis.
- Alertar sobre saturação do pool MySQL, queries lentas, requests lentos, event loop e memória.
- Registrar snapshots leves de saúde da API/worker para histórico.
- Expor diagnóstico somente para administrador.
- Aplicar retenção segura e limitada em tabelas que crescem continuamente.
- Detectar jobs potencialmente presos.

## Nova migration

`20260727_16_observability_maintenance_phase4`

Cria `operational_health_snapshots` e índices de manutenção em `audit_log` e `mutation_receipts`.

## Endpoint administrativo

`GET /api/admin/observability`

Exige permissão `read_audit` (administrador). Retorna:

- Runtime atual (RSS, heap, CPU, event loop).
- Estado do pool MySQL.
- Top endpoints por P95.
- Top operações SQL por P95.
- Alertas ativos.
- Tamanho estimado das tabelas principais.
- Jobs por status e quantidade de jobs potencialmente presos.
- Estado das integrações em `processing`/`failed`.
- Histórico recente de snapshots.
- Configuração de retenção operacional.

## Alertas PM2

Os logs usam o prefixo `[ops.alert]` e possuem cooldown para evitar spam.

Padrões monitorados:

- SQL acima de `PERF_ALERT_SQL_MS` (padrão 2s).
- Request acima de `PERF_ALERT_REQUEST_MS` (padrão 5s).
- Pool acima de `PERF_ALERT_POOL_UTIL_PCT` (padrão 75%) ou com fila pendente.
- Event loop P95 acima de `PERF_ALERT_EVENT_LOOP_P95_MS` (padrão 100ms).
- RSS acima de `PERF_ALERT_RSS_MB` (padrão 800MB).

Alertas antigos deixam de aparecer como ativos após `PERF_ALERT_ACTIVE_MS`.

## Snapshots operacionais

API e worker registram snapshot leve a cada 5 minutos por padrão.

Retenção padrão: 14 dias.

Com dois processos isso representa poucos milhares de registros, mantendo o histórico pequeno.

## Manutenção automática

Executada pelo processo worker em lotes pequenos.

Padrões conservadores:

- `audit_log`: 730 dias.
- `integration_events` concluídos: 365 dias.
- `mutation_receipts` concluídos: 30 dias.
- `operational_health_snapshots`: 14 dias.
- Máximo por tabela por execução: 1.000 registros.

Registros em processamento não são removidos pela retenção.

## Comandos operacionais

Diagnóstico do banco e histórico recente:

```bash
npm run ops:check
```

Simulação de limpeza, sem excluir dados:

```bash
npm run ops:maintenance
```

Aplicar um lote de retenção manualmente:

```bash
npm run ops:maintenance -- --apply
```

## Instalação

```bash
cd /var/www/crm-casa-ads
npm ci
npm run build
pm2 restart crm-casa-ads-api crm-casa-ads-worker --update-env
```

A migration é aplicada automaticamente pela API no boot.

Confirmação:

```sql
SELECT version, applied_at
FROM schema_migrations
WHERE version = '20260727_16_observability_maintenance_phase4';
```

## Verificação após deploy

```bash
pm2 logs crm-casa-ads-api --lines 150
pm2 logs crm-casa-ads-worker --lines 150
npm run ops:check
```

Procure por `ops.alert` apenas quando houver degradação real. Logs `perf.runtime`, `perf.request` e `perf.sql` continuam disponíveis.

## Validação realizada

- Testes específicos da Fase 4: aprovados.
- Suíte ampla sem testes que dependem de pacotes ausentes no ambiente: 312/312 aprovados.
- A suíte completa identificou somente testes impossibilitados pela ausência local de `fflate`, `mysql2` e `exceljs`.
- `server/index.js` permanece abaixo do limite arquitetural de 5.600 linhas.
