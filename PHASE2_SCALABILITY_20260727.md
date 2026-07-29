# Fase 2 — Escalabilidade — 27/07/2026

Esta entrega é cumulativa e pressupõe as correções anteriores de handoff, carteira de consultor e Fase 1 Anti-Queda.

## O que mudou

### 1. Snapshot stale-while-revalidate para métricas
- `LEAD_SUMMARY_CACHE_MS` padrão: 30s.
- `LEAD_SUMMARY_STALE_MS` padrão: 5min.
- Uma alteração em lead marca o snapshot como stale em vez de apagá-lo.
- O próximo leitor recebe o último snapshot imediatamente e uma única atualização roda em background.
- Evita que cada alteração force um novo scan bloqueante de toda a base.

### 2. Tela Hoje reaproveita o snapshot de leads
As métricas `aguardando primeiro contato`, `sem responsável`, `sem próximo passo` e `parados` agora fazem parte do mesmo aggregate do dashboard. `/api/today` deixa de fazer um segundo scan completo de `leads`.

### 3. Tarefas da Tela Hoje consolidadas
As listas `atrasadas`, `hoje` e `próximas` passaram de três SELECTs para um SELECT ranqueado com `ROW_NUMBER()`. A consulta de contadores permanece separada.

### 4. Cursor escalável
O cursor de `/api/leads` agora carrega:
- total da consulta;
- fingerprint dos filtros;
- modo de busca utilizado.

Nas páginas seguintes o backend não repete `COUNT(*)` nem a sondagem do plano FULLTEXT/fallback.

### 5. Filtros de responsável canônicos
`/api/leads/filter-options` agrupa por `responsible_user_id` e resolve nome via `users`, removendo `GROUP BY TRIM(responsible)` do caminho crítico.

### 6. Migration 20260727_14_scalability_phase2
Índices adicionados:
- `idx_leads_active_updated_id`
- `idx_leads_status_updated_id`
- `idx_leads_temperature_updated_id`
- `idx_leads_owner_name_updated_id`
- `idx_leads_priority_score_updated`
- `idx_leads_mapping_score_updated`
- `idx_leads_agency_updated`
- `idx_leads_expansion_updated`
- `idx_tasks_status_due_dt_owner`
- `idx_integration_events_status_updated`

A migration é idempotente via `addIndexIfMissing` e é executada automaticamente no boot da API que gerencia schema.

## Implantação

Na raiz do CRM:

```bash
npm ci
npm run build
pm2 restart crm-casa-ads-api crm-casa-ads-worker --update-env
pm2 logs crm-casa-ads-api --lines 150
```

Se as dependências já estiverem instaladas, `npm ci` pode ser omitido.

## Validação após subir

Confirme a migration:

```sql
SELECT version, applied_at
FROM schema_migrations
WHERE version = '20260727_14_scalability_phase2';
```

Testes funcionais recomendados:
1. Login como administrador.
2. Abrir Leads e usar "Carregar mais" algumas vezes.
3. Buscar por nome/empresa e carregar a segunda página.
4. Alternar filtros Alta prioridade, Outra agência, Mapeamento e Expansão.
5. Abrir Tela Hoje.
6. Login como consultor e validar carteira própria.
7. Encaminhar lead e confirmar atualização normal.

Nos logs, observar principalmente `/api/leads`, `/api/today`, `/api/leads/summary` e pool MySQL.

## Validação desta entrega

Os testes direcionados da Fase 2 e de regressão arquitetural passaram. A suíte de servidor executável sem dependências instaladas passou 273 testes; dois testes não puderam executar porque o projeto extraído não contém `node_modules` (`mysql2` e `exceljs`). Os testes de scripts que exigem `fflate` também dependem da instalação das dependências. A tentativa de `npm ci` não ficou disponível no ambiente de empacotamento.
