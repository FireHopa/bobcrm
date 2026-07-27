# PERFORMANCE PHASE 8 — MIGRAÇÃO SEGURA DE DATAS PARA DATETIME(3)

Data: 24/07/2026

## Objetivo

Eliminar funções sobre colunas temporais críticas, principalmente `LEFT(data, 10)`, sem converter destrutivamente os campos legados. A estratégia implementada cria colunas `DATETIME(3)` paralelas, mantém compatibilidade durante o backfill e só ativa os novos filtros depois que 100% dos registros válidos estiverem convertidos.

## Diagnóstico confirmado antes da alteração

Na versão da Fase 7 existiam 11 usos críticos de `LEFT(..., 10)` diretamente em filtros ou agregações temporais, concentrados em:

- tarefas atrasadas;
- tarefas de hoje;
- tarefas futuras;
- reuniões de hoje;
- tarefas concluídas hoje;
- leads sem atividade há mais de 7 dias;
- follow-ups vencidos;
- indicadores do dashboard operacional.

Exemplo anterior:

```sql
LEFT(t.due_at, 10) < DATE_FORMAT(CURDATE(), '%Y-%m-%d')
```

Esse formato aplica uma função sobre a coluna e reduz a possibilidade de o MySQL aproveitar adequadamente índices temporais.

## Estratégia adotada

A migração não altera ou remove as colunas VARCHAR atuais.

Fluxo:

```text
VARCHAR atual
↓
cria coluna DATETIME(3) paralela
↓
triggers mantêm escrita antiga e coluna nova sincronizadas
↓
backfill em batches
↓
validação
↓
pending = 0
↓
backend ativa automaticamente filtros DATETIME
```

Caso o backfill ainda não tenha terminado, o CRM continua usando as consultas legadas.

## Colunas adicionadas

### leads

```text
next_contact_at_dt      DATETIME(3)
expected_close_at_dt    DATETIME(3)
created_at_dt           DATETIME(3)
updated_at_dt           DATETIME(3)
```

### tasks

```text
due_at_dt               DATETIME(3)
completed_at_dt         DATETIME(3)
created_at_dt           DATETIME(3)
updated_at_dt           DATETIME(3)
```

Total: 8 colunas paralelas.

## Bridge de compatibilidade

Foram criados quatro triggers transitórios:

```text
trg_leads_datetime_bridge_bi
trg_leads_datetime_bridge_bu
trg_tasks_datetime_bridge_bi
trg_tasks_datetime_bridge_bu
```

Eles garantem que qualquer código legado que continue escrevendo `updated_at`, `due_at`, `next_contact_at` etc. também mantenha o respectivo campo `*_dt` sincronizado.

Isso é especialmente importante porque o BobCRM possui muitos caminhos de atualização de leads e tarefas. A transição não depende de atualizar dezenas de statements simultaneamente.

## Backfill

Novo comando:

```bash
npm run datetime:backfill -- --batch-size=500 --pause-ms=25
```

Validação:

```bash
npm run datetime:verify
```

O backfill:

- usa keyset por `id`;
- não usa `OFFSET`;
- processa leads e tasks separadamente;
- usa pool máximo de 2 conexões;
- executa commit por batch;
- não carrega a base inteira na RAM;
- identifica valores legados que não puderam ser convertidos;
- não ativa o novo caminho caso existam registros inválidos pendentes.

## Ativação automática

O backend possui um runtime de prontidão.

Enquanto houver qualquer valor legado preenchido sem correspondente `DATETIME(3)`:

```text
modo VARCHAR ativo
```

Quando a validação chega a:

```text
pendingRows = 0
```

o backend passa automaticamente para:

```text
modo DATETIME(3)
```

A checagem padrão ocorre a cada 30 segundos durante o backfill. Depois que o runtime fica pronto, ele não continua fazendo scans periódicos da base.

## Consultas antes/depois

### Tarefa atrasada

Antes:

```sql
LEFT(t.due_at, 10) < DATE_FORMAT(CURDATE(), '%Y-%m-%d')
```

Depois:

```sql
t.due_at_dt < CURDATE()
```

### Tarefas de hoje

Antes:

```sql
LEFT(t.due_at, 10) = DATE_FORMAT(CURDATE(), '%Y-%m-%d')
```

Depois:

```sql
t.due_at_dt >= CURDATE()
AND t.due_at_dt < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
```

### Leads parados há 7 dias

Antes:

```sql
LEFT(l.updated_at, 10) < DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 7 DAY), '%Y-%m-%d')
```

Depois:

```sql
l.updated_at_dt < DATE_SUB(CURDATE(), INTERVAL 7 DAY)
```

### Follow-ups vencidos

Antes:

```sql
LEFT(next_contact_at, 10) <= DATE_FORMAT(CURDATE(), '%Y-%m-%d')
```

Depois:

```sql
next_contact_at_dt < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
```

Nos SQLs gerados com `useDateColumns=true`, os testes confirmam que o caminho crítico não contém `LEFT(...)` nas comparações temporais migradas.

## Índices adicionados

Somente índices ligados a consultas reais já existentes:

```text
leads.idx_leads_next_contact_dt
leads.idx_leads_expected_close_dt
leads.idx_leads_stalled_dt

tasks.idx_tasks_responsible_due_dt
tasks.idx_tasks_status_due_dt
tasks.idx_tasks_completed_dt
```

Não foram removidos os índices antigos nesta fase.

A decisão de remover, combinar ou alterar índices será feita somente na Fase 9 com `EXPLAIN ANALYZE` sobre o MySQL real.

## Migration

Migration versionada:

```text
server/migrations/20260724_10_parallel_datetime_columns.js
```

Rollback manual:

```text
server/migrations/20260724_10_parallel_datetime_columns.rollback.sql
```

O rollback só deve ser executado depois de reverter o código para uma versão que não consulte campos `*_dt`.

## Segurança operacional

Antes de aplicar a Fase 8 em produção:

1. confirmar backup MySQL válido;
2. substituir os arquivos;
3. reiniciar API/worker para aplicar a migration;
4. verificar que o CRM continua funcionando em modo legado;
5. executar o backfill;
6. executar `datetime:verify`;
7. somente considerar a migração concluída quando não houver registros pendentes.

Nenhuma coluna VARCHAR é removida nesta fase.

## Arquivos principais modificados/criados

```text
package.json
server/.env.example
server/index.js
server/schema.mysql.sql
server/taskPolicy.js
server/leadSummarySql.js
server/dashboardSummarySql.js
server/dateColumns.js
server/todayTemporalSql.js
server/dateColumns.test.js
server/phase8DatetimeMigration.test.js
server/migrations/20260724_10_parallel_datetime_columns.js
server/migrations/20260724_10_parallel_datetime_columns.rollback.sql
server/migrations/20260724_10_parallel_datetime_columns.test.js
scripts/backfill-datetime-columns.mjs
PERFORMANCE_PHASE8.md
```

## Testes

### Fase 8 dedicada

```text
9/9 aprovados
```

### Regressão focada

Incluindo arquitetura, dashboards, tarefas e consultas temporais:

```text
24/24 aprovados
```

### Suíte completa

```text
220 testes
216 aprovados
4 falhas ambientais
```

As quatro falhas são as mesmas dependências que não estão instaladas neste ambiente:

```text
fflate  → 2
mysql2  → 1
exceljs → 1
```

Nenhuma falha funcional ou arquitetural da Fase 8 permaneceu.

### Arquitetura

A primeira implementação elevou `server/index.js` acima do limite arquitetural da Fase 6. A correção foi feita por extração para `todayTemporalSql.js`, sem aumentar o limite do teste.

Resultado final:

```text
server/index.js: 5.599 linhas pelo critério do teste arquitetural (< 5.600)
```

### Sintaxe

Todos os arquivos `.js` e `.mjs` de `server/` e `scripts/` passaram em `node --check`.

## Métrica estrutural

Antes da Fase 8:

```text
11 comparações temporais críticas usando LEFT(..., 10)
```

Depois da ativação DATETIME:

```text
0 LEFT(...) nos SQLs temporais críticos migrados
```

Isso é uma melhoria estrutural do plano de consulta. Não representa, por si só, um número de p95.

## Benchmark real

Este ambiente não possui o MySQL de produção nem a base de aproximadamente 133 mil leads. Portanto, não foi inventado tempo de resposta.

Após o deploy, medir com a observabilidade da Fase 0:

```text
GET /api/today
GET /api/leads/summary
GET /api/opportunities/summary
GET /api/tasks?bucket=today
GET /api/tasks?bucket=overdue
```

Na Fase 9, executar `EXPLAIN ANALYZE` para confirmar:

- índice escolhido;
- rows examined;
- actual time;
- filesort;
- temporary tables;
- seletividade dos novos índices.

## Próxima fase

FASE 9 — índices e `EXPLAIN ANALYZE`.

A Fase 8 deixou as consultas temporais em um formato indexável. A Fase 9 deverá usar o banco real para validar os planos de execução e decidir quais índices permanecem, quais precisam ser ajustados e quais índices VARCHAR antigos poderão ser retirados posteriormente.
